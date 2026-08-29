import type { QuestType } from "@/types/database";

/**
 * Lógica pura del motor de misiones — sin Riot ni Supabase acá a propósito,
 * para poder testearla con secuencias de partidas simuladas (ver
 * scripts/test-quests.mjs) sin depender de red ni base de datos.
 */

export const QUEST_TARGETS: Record<QuestType, number> = {
  win_streak: 5,
  kda_streak: 5,
  /** No es racha — target=1: se otorga en la partida misma que la cumple. */
  deathless_win: 1,
  /** Igual que deathless_win: target=1, se otorga en la partida misma. */
  beat_participant: 1,
};

export const KDA_STREAK_THRESHOLD = 5;
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
export const MIN_MATCH_DURATION_SECONDS = 300;

/**
 * Si una quest resetea a 0 al toparse con una partida que NO cumple su
 * criterio (una racha de verdad, corte incluido) o si simplemente ignora
 * esa partida y sigue esperando la próxima que sí cumpla, sin importar el
 * orden ni lo que pasó en el medio. kda_streak es la única así — el resto
 * son rachas consecutivas de verdad.
 */
const QUEST_RESETS_ON_FAIL: Record<QuestType, boolean> = {
  win_streak: true,
  kda_streak: false,
  deathless_win: true,
  beat_participant: true,
};

/** Todas las quests conocidas, en el orden en que se evalúan por partida (no afecta el resultado, solo el orden de los grants cuando varias se completan en la misma partida). */
export const QUEST_TYPES = Object.keys(QUEST_TARGETS) as QuestType[];

export interface MatchOutcome {
  matchId: string;
  win: boolean;
  /** (kills + assists) / max(deaths, 1) — ya calculado por el caller. */
  kda: number;
  /** Muertes crudas — deathless_win necesita el 0 exacto, no alcanza con "KDA alto" (calculateKda ya clampea deaths a 1 como mínimo, perdiendo la distinción 0 vs 1). */
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

/** Criterio "esta partida cuenta para la racha/objetivo" de cada quest. */
const QUEST_CRITERIA: Record<QuestType, (match: MatchOutcome) => boolean> = {
  win_streak: (match) => match.win,
  kda_streak: (match) => match.kda >= KDA_STREAK_THRESHOLD,
  deathless_win: (match) => match.win && match.deaths === 0,
  beat_participant: (match) => match.win && match.beatTrackedParticipant,
};

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
 * Reglas (confirmadas por el usuario):
 * - win_streak: partidas ranked solo/duo ganadas seguidas: target consecutivas
 *   sin cortes -> mango. Una derrota en el medio vuelve el contador a 0.
 * - kda_streak: NO es una racha de verdad (a diferencia de las otras dos) —
 *   basta con acumular target partidas con KDA >= KDA_STREAK_THRESHOLD en
 *   cualquier orden; una partida con KDA bajo en el medio no corta nada, se
 *   ignora y el contador sigue esperando la próxima que sí cumpla (ver
 *   QUEST_RESETS_ON_FAIL).
 * - deathless_win: UNA sola partida ganada con 0 muertes (target=1) — no es
 *   racha, se otorga en la partida misma que la cumple.
 * - beat_participant: UNA sola partida ganada con al menos un participante
 *   REGISTRADO del torneo del lado rival (target=1, igual que
 *   deathless_win) — se otorga cada vez que se cumple, no una sola vez en
 *   toda la temporada.
 * - Remakes (gameDurationSeconds < MIN_MATCH_DURATION_SECONDS) se ignoran
 *   por completo para las TRES quests — ni suman progreso ni cortan una
 *   racha existente (para win_streak/deathless_win, que sí resetean con una
 *   partida que no cumple: un remake NO es "una partida que no cumple", es
 *   como si no se hubiera jugado).
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
  maxMangoInventory = MAX_MANGO_INVENTORY,
}: {
  progress: QuestProgressState;
  /** Solo las partidas NUEVAS (no vistas todavía), de la más vieja a la más nueva. */
  matches: MatchOutcome[];
  /** Cuántos mangos 'in_inventory' tiene el participante al arrancar esta corrida. */
  mangoCount: number;
  maxMangoInventory?: number;
}): ProcessMatchesResult {
  const current: QuestProgressState = { ...progress };
  let mangoCount = initialMangoCount;
  const grants: MangoGrantEvent[] = [];
  let lastProcessedMatchId: string | null = null;

  function tryGrant(questType: QuestType, matchId: string | null) {
    if (current[questType] < QUEST_TARGETS[questType]) return;
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
      if (current[questType] < QUEST_TARGETS[questType]) {
        if (QUEST_CRITERIA[questType](match)) {
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
