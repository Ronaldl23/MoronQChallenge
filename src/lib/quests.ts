import type { QuestType } from "@/types/database";

/**
 * Lógica pura del motor de misiones — sin Riot ni Supabase acá a propósito,
 * para poder testearla con secuencias de partidas simuladas (ver
 * scripts/test-quests.mjs) sin depender de red ni base de datos.
 */

/**
 * Categoría de dificultad de misiones según la posición ACTUAL del
 * participante en el ranking (1 = mejor) — regla confirmada por el
 * usuario: cuanto mejor rankeado, más exigente. Se recalcula en cada
 * corrida del cron (ver tierForRank y processParticipantQuests en
 * /api/update-rankings/route.ts), no queda fijo desde que se creó la fila
 * de quest_progress — si alguien sube o baja de categoría, sus próximas
 * partidas se evalúan contra el target/umbral de la categoría nueva.
 */
export type MissionTier = "top1_3" | "top4_10" | "top11_20" | "top21_plus";

export interface TierConfig {
  /** Victorias ranked seguidas para completar win_streak. */
  winStreakTarget: number;
  /** Partidas (no necesariamente seguidas) que hace falta acumular con KDA >= kdaThreshold para completar kda_streak. */
  kdaGames: number;
  kdaThreshold: number;
  /** Kills mínimos en una sola partida para completar high_kills. */
  killsThreshold: number;
  /** Si high_kills exige además ganar esa partida (top1_3/top4_10 sí para el "Win con kills", el resto no). */
  killsRequireWin: boolean;
  /** Partidas (no necesariamente seguidas) con menos de lowDeathsMaxDeaths muertes para completar deathless_win — 1 partida con lowDeathsMaxDeaths=1 (o sea, 0 muertes exactas) en top1_3/top4_10/top11_20; 3 partidas con menos de 3 muertes en top21_plus. */
  lowDeathsGames: number;
  /** Tope EXCLUSIVO de muertes — deaths < lowDeathsMaxDeaths. 1 = exactamente 0 muertes. */
  lowDeathsMaxDeaths: number;
  /** Si deathless_win exige además ganar esa partida (solo top1_3). */
  lowDeathsRequireWin: boolean;
}

export const MISSION_TIERS: Record<MissionTier, TierConfig> = {
  top1_3: {
    winStreakTarget: 5,
    kdaGames: 5,
    kdaThreshold: 6,
    killsThreshold: 20,
    killsRequireWin: true,
    lowDeathsGames: 1,
    lowDeathsMaxDeaths: 1,
    lowDeathsRequireWin: true,
  },
  top4_10: {
    winStreakTarget: 5,
    kdaGames: 5,
    kdaThreshold: 5,
    killsThreshold: 20,
    killsRequireWin: false,
    lowDeathsGames: 1,
    lowDeathsMaxDeaths: 1,
    lowDeathsRequireWin: false,
  },
  top11_20: {
    winStreakTarget: 4,
    kdaGames: 4,
    kdaThreshold: 4,
    killsThreshold: 15,
    killsRequireWin: false,
    lowDeathsGames: 1,
    lowDeathsMaxDeaths: 1,
    lowDeathsRequireWin: false,
  },
  top21_plus: {
    winStreakTarget: 3,
    kdaGames: 3,
    kdaThreshold: 3,
    killsThreshold: 10,
    killsRequireWin: false,
    lowDeathsGames: 3,
    lowDeathsMaxDeaths: 3,
    lowDeathsRequireWin: false,
  },
};

/**
 * rank = posición 1-based en el ranking público (1 = mejor), mismo cálculo
 * que el leaderboard (ver computeRankOrder en src/lib/ranking.ts). null
 * (todavía sin ninguna partida ranked jugada esta temporada — en
 * placements) usa la categoría más floja: no hay forma de ubicarlo en el
 * ranking todavía, y no tiene sentido exigirle de más antes de que
 * arranque.
 */
export function tierForRank(rank: number | null): MissionTier {
  if (rank === null) return "top21_plus";
  if (rank <= 3) return "top1_3";
  if (rank <= 10) return "top4_10";
  if (rank <= 20) return "top11_20";
  return "top21_plus";
}

/** Targets efectivos de las 5 quests para una categoría dada — lo que se persiste en quest_progress.target y lo que usa tryGrant en processNewMatches. */
export function questTargetsForTier(tier: MissionTier): Record<QuestType, number> {
  const cfg = MISSION_TIERS[tier];
  return {
    win_streak: cfg.winStreakTarget,
    kda_streak: cfg.kdaGames,
    deathless_win: cfg.lowDeathsGames,
    /** No es racha — target=1: se otorga en la partida misma que la cumple. */
    high_kills: 1,
    /** Igual que high_kills: target=1, se otorga en la partida misma. Sin cambios por categoría (regla confirmada por el usuario). */
    beat_participant: 1,
  };
}

export const MAX_MANGO_INVENTORY = 3;

/**
 * Partidas más cortas que esto (remakes: alguien se desconectó al arranque,
 * 0/0/0) no cuentan para NINGUNA quest — ni suman progreso ni cortan una
 * racha existente, quedan totalmente ignoradas (confirmado por el usuario).
 * penalty.ts duplica este mismo valor a propósito (ver comentario ahí,
 * mismo patrón que SUPPORT_ASSIGNMENT en mango-launch.ts) —
 * scripts/test-quests.mjs y scripts/test-penalty.mjs verifican que ambos
 * sigan sincronizados.
 */
/** 4 minutos — antes de eso, se considera remake (regla confirmada por el usuario). */
export const MIN_MATCH_DURATION_SECONDS = 240;

/**
 * Si una quest resetea a 0 al toparse con una partida que NO cumple su
 * criterio (una racha de verdad, corte incluido) o si simplemente ignora
 * esa partida y sigue esperando la próxima que sí cumpla, sin importar el
 * orden ni lo que pasó en el medio. win_streak es la única racha de verdad
 * — el resto (kda_streak, deathless_win, high_kills, beat_participant) son
 * acumulación: no hace falta que las partidas que cumplen sean
 * consecutivas (regla confirmada por el usuario), así que una que no
 * cumple simplemente se ignora en vez de cortar nada. Para las quests con
 * target=1 (high_kills, beat_participant) este valor no cambia nada en la
 * práctica: current siempre está en 0 o recién se otorgó, nunca hay nada
 * "a mitad de camino" que cortar — queda en false por consistencia con el
 * resto de las quests que no son win_streak.
 */
const QUEST_RESETS_ON_FAIL: Record<QuestType, boolean> = {
  win_streak: true,
  kda_streak: false,
  deathless_win: false,
  high_kills: false,
  beat_participant: false,
};

/** Todas las quests conocidas, en el orden en que se evalúan por partida (no afecta el resultado, solo el orden de los grants cuando varias se completan en la misma partida). */
export const QUEST_TYPES: QuestType[] = [
  "win_streak",
  "kda_streak",
  "deathless_win",
  "high_kills",
  "beat_participant",
];

export interface MatchOutcome {
  matchId: string;
  win: boolean;
  /** (kills + assists) / max(deaths, 1) — ya calculado por el caller. */
  kda: number;
  /** Kills crudos — high_kills necesita el número real de asesinatos, no lo captura el KDA (un KDA alto puede venir de assists, no de kills). */
  kills: number;
  /** Muertes crudas — deathless_win necesita la cifra real (0, o menos de lowDeathsMaxDeaths), no alcanza con "KDA alto" (calculateKda ya clampea deaths a 1 como mínimo, perdiendo la distinción 0 vs 1). */
  deaths: number;
  /** gameDuration crudo de match-v5, en segundos. Menos de MIN_MATCH_DURATION_SECONDS = remake, se ignora por completo (ver processNewMatches). */
  gameDurationSeconds: number;
  /**
   * true si en esta partida había, del lado rival, al menos otro
   * participante REGISTRADO del torneo (cualquiera, no solo su misma
   * línea) — lo calcula el caller (el motor acá es puro, no conoce la
   * tabla participants) cruzando los 10 puuids de la partida contra el
   * roster. beat_participant lo combina con match.win.
   */
  beatTrackedParticipant: boolean;
}

/** Criterio "esta partida cuenta para la racha/objetivo" de cada quest, para una categoría dada — kda_streak, deathless_win y high_kills varían según la categoría (ver MISSION_TIERS). */
function questCriteriaForTier(tier: MissionTier): Record<QuestType, (match: MatchOutcome) => boolean> {
  const cfg = MISSION_TIERS[tier];
  return {
    win_streak: (match) => match.win,
    kda_streak: (match) => match.kda >= cfg.kdaThreshold,
    deathless_win: (match) =>
      (!cfg.lowDeathsRequireWin || match.win) && match.deaths < cfg.lowDeathsMaxDeaths,
    high_kills: (match) => (!cfg.killsRequireWin || match.win) && match.kills >= cfg.killsThreshold,
    beat_participant: (match) => match.win && match.beatTrackedParticipant,
  };
}

export type QuestProgressState = Record<QuestType, number>;

export interface MangoGrantEvent {
  /** null cuando el otorgamiento corresponde a una racha que ya estaba completa de una corrida anterior (esperando cupo), no a una partida de esta corrida. */
  matchId: string | null;
  quest_type: QuestType;
}

export interface ProcessMatchesResult {
  progress: QuestProgressState;
  grants: MangoGrantEvent[];
  /** Cantidad de mangos en inventario al final (para persistir/verificar, no para insertar). */
  mangoCount: number;
  /** Id de la última partida de la lista recibida, o null si no había ninguna nueva. */
  lastProcessedMatchId: string | null;
}

/**
 * Procesa, en orden cronológico (más vieja primero), las partidas nuevas de
 * un participante y devuelve el progreso final de todas las quests + qué
 * mangos se ganaron. No toca Supabase — el caller es responsable de
 * persistir `progress`/`lastProcessedMatchId` en quest_progress y de
 * insertar una fila en `mangos` por cada evento en `grants`.
 *
 * Reglas (confirmadas por el usuario — ver MISSION_TIERS para los números
 * exactos de cada categoría):
 * - win_streak: partidas ranked solo/duo ganadas seguidas: winStreakTarget
 *   de la categoría consecutivas sin cortes -> mango. Una derrota en el
 *   medio vuelve el contador a 0. Es la ÚNICA racha de verdad.
 * - kda_streak: acumular kdaGames partidas (no necesariamente seguidas) con
 *   KDA >= kdaThreshold de la categoría; una partida por debajo no corta
 *   nada, se ignora y el contador sigue esperando la próxima que sí cumpla.
 * - deathless_win: acumular lowDeathsGames partidas (no necesariamente
 *   seguidas) con menos de lowDeathsMaxDeaths muertes — 1 partida con 0
 *   muertes exactas en top1_3/top4_10/top11_20 (target=1, se otorga en la
 *   partida misma), 3 partidas con menos de 3 muertes en top21_plus. Exige
 *   ganar esa partida SOLO en top1_3 (lowDeathsRequireWin).
 * - high_kills: UNA sola partida (target=1) con >= killsThreshold kills de
 *   la categoría. Exige ganar esa partida en top1_3/top4_10
 *   (killsRequireWin), el resto no.
 * - beat_participant: UNA sola partida ganada con al menos un participante
 *   REGISTRADO del torneo del lado rival (target=1) — se otorga cada vez
 *   que se cumple, no una sola vez en toda la temporada. Sin cambios por
 *   categoría.
 * - Remakes (gameDurationSeconds < MIN_MATCH_DURATION_SECONDS) se ignoran
 *   por completo para las CINCO quests — ni suman progreso ni cortan una
 *   racha existente (win_streak es la única que resetea con una partida
 *   que no cumple: un remake NO es "una partida que no cumple", es como si
 *   no se hubiera jugado).
 * - Al completar una quest (progress === target), el progreso de ESA quest
 *   vuelve a 0 SIEMPRE, haya o no cupo. Cupo máximo de MAX_MANGO_INVENTORY
 *   mangos 'in_inventory' simultáneos: si hay lugar, se otorga el Mango; si
 *   el inventario ya está lleno, el mango se PIERDE (confirmado por el
 *   usuario) — no se guarda "esperando cupo" para una corrida futura.
 *   Completar una misión sin haber lanzado/vaciado el inventario a tiempo
 *   no da una segunda oportunidad: hay que tener lugar libre en el momento
 *   exacto en que se cumple.
 */
export function processNewMatches({
  progress,
  matches,
  mangoCount: initialMangoCount,
  tier,
  maxMangoInventory = MAX_MANGO_INVENTORY,
}: {
  progress: QuestProgressState;
  /** Solo las partidas NUEVAS (no vistas todavía), de la más vieja a la más nueva. */
  matches: MatchOutcome[];
  /** Cuántos mangos 'in_inventory' tiene el participante al arrancar esta corrida. */
  mangoCount: number;
  /** Categoría de dificultad ACTUAL del participante (ver tierForRank) — decide los targets/umbral de esta corrida, ver questTargetsForTier/questCriteriaForTier. */
  tier: MissionTier;
  maxMangoInventory?: number;
}): ProcessMatchesResult {
  const targets = questTargetsForTier(tier);
  const criteria = questCriteriaForTier(tier);
  const current: QuestProgressState = { ...progress };
  let mangoCount = initialMangoCount;
  const grants: MangoGrantEvent[] = [];
  let lastProcessedMatchId: string | null = null;

  function tryGrant(questType: QuestType, matchId: string | null) {
    if (current[questType] < targets[questType]) return;
    // Se cumplió la misión: el progreso vuelve a 0 sí o sí. Con cupo libre
    // se otorga el mango; sin cupo, se pierde — no queda "pendiente" para
    // más adelante (ver el comentario de la función de arriba).
    if (mangoCount < maxMangoInventory) {
      grants.push({ matchId, quest_type: questType });
      mangoCount += 1;
    }
    current[questType] = 0;
  }

  // En operación normal esto no debería encontrar nada (una quest nunca
  // debería persistir a mitad de corrida ya en el target, ver tryGrant):
  // sirve de red de seguridad por si un progreso quedó pegado en el target
  // por datos viejos (de antes de este comportamiento) — lo resuelve una
  // sola vez, antes de tocar ninguna partida nueva.
  for (const questType of QUEST_TYPES) tryGrant(questType, null);

  for (const match of matches) {
    // lastProcessedMatchId avanza SIEMPRE, remake o no — si no, un remake
    // que sea la partida más nueva de la corrida dejaría el cursor pegado
    // ahí, y la próxima corrida lo volvería a traer como "nuevo" para
    // siempre (ver comentario de gameDurationSeconds arriba).
    lastProcessedMatchId = match.matchId;

    if (match.gameDurationSeconds < MIN_MATCH_DURATION_SECONDS) continue; // remake: no cuenta para nada

    for (const questType of QUEST_TYPES) {
      // En operación normal current[questType] siempre entra acá por debajo
      // del target: tryGrant ya lo resetea a 0 apenas se cumple, haya o no
      // mango de por medio (ver más arriba) — este chequeo es solo para no
      // sumarle de más a una quest que, por datos viejos, todavía esté
      // pegada en el target de antes de este fix.
      if (current[questType] < targets[questType]) {
        if (criteria[questType](match)) {
          current[questType] += 1;
        } else if (QUEST_RESETS_ON_FAIL[questType]) {
          current[questType] = 0;
        }
        // else: kda_streak con esta partida por debajo del umbral — se
        // ignora, no resetea (no es una racha consecutiva de verdad).
      }
      tryGrant(questType, match.matchId);
    }
  }

  return {
    progress: current,
    grants,
    mangoCount,
    lastProcessedMatchId,
  };
}

export function calculateKda({
  kills,
  deaths,
  assists,
}: {
  kills: number;
  deaths: number;
  assists: number;
}): number {
  return (kills + assists) / Math.max(deaths, 1);
}
