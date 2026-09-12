/**
 * Mismo valor que SUPPORT_ASSIGNMENT en src/lib/mango-launch.ts — duplicado
 * a propósito (no importado) para que este módulo se mantenga sin
 * dependencias locales, igual que quests.ts: así se puede correr directo con
 * Node (--experimental-strip-types, ver scripts/test-penalty.mjs) sin que el
 * alias "@/" ni la resolución de imports relativos entre archivos .ts se
 * interpongan. scripts/test-penalty.mjs importa AMBOS módulos y verifica que
 * este valor siga sincronizado con el original.
 */
const SUPPORT_ASSIGNMENT = "SUPPORT";

/**
 * Mismo valor que MIN_MATCH_DURATION_SECONDS en src/lib/quests.ts —
 * duplicado a propósito, mismo motivo que SUPPORT_ASSIGNMENT arriba.
 * scripts/test-penalty.mjs verifica que no se desincronice.
 */
const MIN_MATCH_DURATION_SECONDS = 240;

/**
 * Mismo valor que NO_FLASH_ASSIGNMENT en src/lib/mango-launch.ts —
 * duplicado a propósito, mismo motivo que SUPPORT_ASSIGNMENT arriba.
 */
const NO_FLASH_ASSIGNMENT = "NO_FLASH";

/**
 * Id numérico de Riot (summoner1Id/summoner2Id de match-v5) para cada
 * hechizo de invocador del pool de castigo, más Flash — estos números son
 * estables desde hace años en la API de Riot (no vienen de Data Dragon,
 * que solo expone el id de texto tipo "SummonerHaste"; el número es lo que
 * de verdad trae cada partida). Duplicado a propósito, mismo motivo que
 * SUPPORT_ASSIGNMENT/MIN_MATCH_DURATION_SECONDS arriba — mantiene este
 * módulo sin imports para poder correrlo directo con Node.
 */
const SPELL_KEY_BY_ASSIGNMENT: Record<string, number> = {
  SummonerHaste: 6, // Fantasma
  SummonerHeal: 7, // Curar
  SummonerBarrier: 21, // Barrera
  SummonerBoost: 1, // Purificar
  SummonerExhaust: 3, // Debilitar
  SummonerTeleport: 12, // Teletransporte
  SummonerDot: 14, // Incendiar
  SummonerSmite: 11, // Hoz
};
const FLASH_SPELL_KEY = 4;

/**
 * Lógica pura de cumplimiento de castigos — sin Riot ni Supabase acá a
 * propósito, mismo criterio que src/lib/quests.ts (testeable con secuencias
 * simuladas, ver scripts/test-penalty.mjs).
 *
 * Contador COMPARTIDO (rediseño): en vez de que cada castigo pendiente
 * tenga su propio contador de 3 partidas — lo que en la práctica le daba a
 * un jugador con N castigos activos solo 3 partidas EN TOTAL para
 * resolverlos todos, no 3 intentos por cada uno — hay UN SOLO contador por
 * jugador que aplica a todo el grupo de castigos pendientes:
 * - Cada partida ranked: si cumple CUALQUIERA de los castigos pendientes,
 *   ese/esos se marcan 'completed' y el contador vuelve a 0 (ventana fresca
 *   para los que queden). Si dos castigos pendientes tienen la MISMA
 *   asignación (p.ej. dos veces Hoz), esa partida cumple uno solo — el más
 *   viejo de los dos — nunca ambos a la vez; el otro necesita su propia
 *   partida.
 * - Si no cumple ninguno, el contador sube en 1.
 * - Si el contador llega al límite sin ninguna coincidencia, YA NO se
 *   descalifica a nadie automáticamente: los castigos que sigan pendientes
 *   quedan tal cual (pending), el contador vuelve a 0 (ventana fresca) y se
 *   suma 1 a `nonComplianceGrants` — el caller (update-rankings) lo lee y
 *   por cada uno rollea y otorga UN castigo más (sin balde de rebote, ver
 *   rollPenaltyOutcome en mango-launch.ts), sin techo: si el jugador sigue
 *   sin cumplir, el grupo de pendientes solo sigue creciendo. Una corrida
 *   que procesa muchas partidas atrasadas de golpe puede agotar la ventana
 *   más de una vez, de ahí que sea un contador y no un booleano.
 * - Remakes (gameDurationSeconds < MIN_MATCH_DURATION_SECONDS) se ignoran
 *   por completo: no cumplen ningún castigo NI gastan una de las 3
 *   partidas de la ventana — es como si no se hubieran jugado.
 */

/** Partidas ranked que tiene un jugador para cumplir ALGUNO de sus castigos pendientes antes de que el grupo entero pase a revisión manual (regla confirmada por el usuario). */
export const PENALTY_GAME_LIMIT = 3;

/**
 * Máximo de castigos por incumplimiento (ver nonComplianceGrants más
 * abajo) TOLERADOS POR DÍA (UTC) antes de descalificar automáticamente al
 * jugador — el 3ro en el mismo día banea (2 se toleran). Se reinicia solo
 * al cambiar de día (ver noncompliance_penalty_last_date), nunca queda
 * pegado de un día para el otro. Pedido explícito del usuario, a propósito
 * SIN mostrarse en ninguna UI ni exponerse por ninguna API: el contador
 * real vive en participants.noncompliance_penalty_count (ver
 * 0029_noncompliance_ban_counter.sql), que ningún endpoint de cara al
 * jugador lee. La idea es que nadie sepa que esta regla existe de
 * antemano — solo se entera quien la termina gatillando, con la
 * descalificación resultante (mismo mecanismo que un ban manual desde
 * /admin, ver participants.manually_disqualified).
 */
export const NONCOMPLIANCE_BAN_THRESHOLD = 3;

/**
 * "Misión Escudo": ganar SHIELD_STREAK_TARGET partidas de castigo SEGUIDAS
 * (jugar la partida que cumple un castigo pendiente, y ganarla) otorga un
 * Escudo. Una partida que NO cumple ningún castigo pendiente no cuenta para
 * nada acá (ni suma ni corta la racha) — solo importan las partidas que sí
 * cumplieron uno (`compliant.length > 0` en el loop de abajo). Perder una de
 * esas SÍ corta la racha a 0, aunque el castigo igual se marque cumplido
 * (compliance ≠ ganar: se cumple jugando el campeón/rol/hechizo asignado,
 * sin importar el resultado). Pedido explícito del usuario.
 */
export const SHIELD_STREAK_TARGET = 3;

export interface PenaltyMatchOutcome {
  matchId: string;
  /**
   * ISO 8601 completo (ej. `new Date(x).toISOString()`) — DEBE ser cuándo
   * ARRANCÓ la partida (gameStartTimestamp de match-v5), no cuándo
   * terminó: se compara contra el `createdAt` más viejo entre los
   * castigos pendientes para no contar partidas ANTES de que existiera
   * NINGÚN castigo, y una partida que ya estaba en curso cuando se asignó
   * el castigo no le dio al jugador ninguna chance real de cumplirlo —
   * usar el fin de la partida ahí contaba una intentona fallida que el
   * jugador no tuvo forma de evitar (bug real reportado: jugadores que
   * creían ir 2/3 en realidad ya iban 3/3 por una partida arrancada antes
   * de que les cayera el castigo). La comparación es lexicográfica (string
   * < string), así que el caller DEBE normalizar ambos con el mismo
   * formato — un timestamptz de Postgres tal cual no siempre coincide
   * (offset "+00:00" en vez de "Z", distinta cantidad de dígitos
   * decimales).
   */
  playedAt: string;
  /** Id de campeón (Data Dragon, ej. "Ahri") jugado en esa partida. */
  championPlayed: string;
  /** teamPosition crudo de match-v5 ("TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY", puede venir vacío en casos raros). */
  teamPosition: string;
  /** summoner1Id/summoner2Id crudos de match-v5 (ids NUMÉRICOS de Riot, no el id de texto de Data Dragon) — para el castigo de hechizo de invocador obligatorio (o "sin Flash"). */
  summoner1Id: number;
  summoner2Id: number;
  /** gameDuration crudo de match-v5, en segundos. Menos de MIN_MATCH_DURATION_SECONDS = remake, se ignora por completo (no gasta ventana ni cumple nada). */
  gameDurationSeconds: number;
  /** Si el jugador ganó ESTA partida — para la racha de Misión Escudo (ver SHIELD_STREAK_TARGET más abajo), que solo mira partidas que cumplieron un castigo. */
  win: boolean;
}

export interface PendingPenalty {
  id: string;
  /** champion_assigned tal cual está en `mangos` — SUPPORT_ASSIGNMENT, NO_FLASH_ASSIGNMENT, un id de hechizo (ej. "SummonerHaste"), o un id de campeón puntual. */
  championAssigned: string;
  /** Mismo formato normalizado que `playedAt` de PenaltyMatchOutcome — ver esa nota. */
  createdAt: string;
  /**
   * true si este castigo es autoinfligido (rebote, hongo, o el que se
   * otorga por no cumplir otro a tiempo — is_bounce_back/is_moldy_trash/
   * is_noncompliance_penalty en `mangos`). Cumplirlo/ganarlo NO debe sumar
   * a la racha de Misión Escudo: si contara igual, ignorar a propósito los
   * castigos reales para forzar que el sistema otorgue uno autoinfligido
   * en su lugar (mismo exploit ya reportado una vez — caso Benimaru, ver
   * noncompliancePenaltyIds en /api/update-rankings) dejaría fabricar
   * "partidas de castigo" propias sin depender de que alguien más ataque
   * de verdad, en vez de depender de un ataque real.
   */
  isSelfInflicted: boolean;
}

/** "disqualified" queda solo por compatibilidad con filas viejas de antes de este cambio — processPenaltyMatches ya no lo produce (ver nonComplianceGrants). */
export type PenaltyStatus = "pending" | "completed" | "disqualified";

export interface PenaltyUpdate {
  id: string;
  /** 'pending' si no cambió nada esta corrida. */
  status: PenaltyStatus;
  /** Solo si status pasó a 'completed' en esta corrida — qué partida lo cumplió. */
  completedOnMatchId: string | null;
}

export interface ProcessPenaltyMatchesResult {
  /** Uno por cada castigo recibido en `penalties`, en el mismo orden. */
  updates: PenaltyUpdate[];
  /** Contador compartido final — el caller lo persiste en participants.penalty_games_without_compliance. */
  gamesWithoutCompliance: number;
  /** Cuántas veces se agotó la ventana compartida sin cumplir NINGÚN castigo pendiente durante esta corrida — el caller debe otorgar un castigo nuevo por cada una (sin techo, ver comentario de processPenaltyMatches). */
  nonComplianceGrants: number;
  /** Racha final de partidas de castigo ganadas seguidas — el caller lo persiste en participants.shield_streak_count (ver SHIELD_STREAK_TARGET). */
  shieldStreakCount: number;
  /** Cuántas veces la racha llegó a SHIELD_STREAK_TARGET durante esta corrida — el caller suma esto a participants.shield_count (acumulable, sin techo). */
  shieldsGranted: number;
}

/**
 * Si el castigo es SUPPORT_ASSIGNMENT, se cumple con CUALQUIER campeón
 * siempre que teamPosition sea UTILITY. Si es NO_FLASH_ASSIGNMENT, se
 * cumple si NINGUNO de los dos slots de hechizo fue Flash (cualquier otra
 * combinación de los dos hechizos restantes vale). Si es un hechizo
 * puntual del pool (ver SPELL_KEY_BY_ASSIGNMENT), se cumple si ese hechizo
 * está en CUALQUIERA de los dos slots. Si no, es un campeón puntual: se
 * cumple jugando exactamente ese campeón (sin importar la línea).
 */
function isCompliant(championAssigned: string, match: PenaltyMatchOutcome): boolean {
  if (championAssigned === SUPPORT_ASSIGNMENT) return match.teamPosition === "UTILITY";
  if (championAssigned === NO_FLASH_ASSIGNMENT) {
    return match.summoner1Id !== FLASH_SPELL_KEY && match.summoner2Id !== FLASH_SPELL_KEY;
  }
  const requiredSpellKey = SPELL_KEY_BY_ASSIGNMENT[championAssigned];
  if (requiredSpellKey !== undefined) {
    return match.summoner1Id === requiredSpellKey || match.summoner2Id === requiredSpellKey;
  }
  return match.championPlayed === championAssigned;
}

/**
 * Procesa, en orden cronológico (más vieja primero), las partidas ranked
 * nuevas de un participante contra TODOS sus castigos en estado 'pending' a
 * la vez, usando el contador compartido `gamesWithoutCompliance` (estado
 * actual del participante, no de un castigo puntual). No toca Supabase — el
 * caller persiste `updates` en penalty_progress.status y el contador
 * resultante en participants.penalty_games_without_compliance.
 */
export function processPenaltyMatches({
  penalties,
  matches,
  gamesWithoutCompliance,
  shieldStreakCount,
}: {
  penalties: PendingPenalty[];
  matches: PenaltyMatchOutcome[];
  /** Contador compartido actual del participante (participants.penalty_games_without_compliance). */
  gamesWithoutCompliance: number;
  /** Racha actual de partidas de castigo ganadas seguidas (participants.shield_streak_count) — ver SHIELD_STREAK_TARGET. */
  shieldStreakCount: number;
}): ProcessPenaltyMatchesResult {
  // Regla 5: sin castigos pendientes no hay contador corriendo — no-op total,
  // y el contador vuelve a 0 (por si quedó un resto de un grupo anterior).
  // La racha de Misión Escudo NO se toca acá: a diferencia del contador de
  // incumplimiento (que solo tiene sentido mientras haya un grupo activo),
  // la racha de castigos ganados debe sobrevivir entre un castigo y el
  // siguiente (el ejemplo del propio pedido: ganás un castigo, no tenés
  // ningún otro pendiente por un rato, te llega uno nuevo y lo ganás — la
  // racha sigue en 1, no se resetea por quedarte sin pendientes en el medio).
  if (penalties.length === 0) {
    return {
      updates: [],
      gamesWithoutCompliance: 0,
      nonComplianceGrants: 0,
      shieldStreakCount,
      shieldsGranted: 0,
    };
  }

  const state = new Map<string, { status: PenaltyStatus; completedOnMatchId: string | null }>(
    penalties.map((p) => [p.id, { status: "pending", completedOnMatchId: null }]),
  );
  const earliestCreatedAt = penalties.reduce(
    (min, p) => (p.createdAt < min ? p.createdAt : min),
    penalties[0].createdAt,
  );
  let counter = gamesWithoutCompliance;
  let nonComplianceGrants = 0;
  let shieldStreak = shieldStreakCount;
  let shieldsGranted = 0;

  for (const match of matches) {
    const stillPending = penalties.filter((p) => state.get(p.id)!.status === "pending");
    if (stillPending.length === 0) break; // Ya se resolvió todo el grupo esta corrida — nada más que evaluar.

    // Remake (gameDurationSeconds < MIN_MATCH_DURATION_SECONDS): no cuenta
    // para nada — ni cumple un castigo, ni gasta una de las 3 partidas de
    // la ventana del contador compartido.
    if (match.gameDurationSeconds < MIN_MATCH_DURATION_SECONDS) continue;

    // Partida jugada antes de que existiera NINGÚN castigo pendiente: no cuenta ni a favor ni en contra.
    if (match.playedAt < earliestCreatedAt) continue;

    const compliant = stillPending.filter((p) => isCompliant(p.championAssigned, match));

    if (compliant.length > 0) {
      // Si hay más de un castigo pendiente con el MISMO championAssigned
      // (p.ej. dos castigos de Hoz/SummonerSmite a la vez), esta partida
      // cumple UNO SOLO — el más viejo de esa asignación — no los dos
      // juntos: cada instancia repetida necesita su propia partida que la
      // cumpla, igual que si fueran dos castigos distintos que hay que
      // resolver de a uno. Bug real reportado por el usuario (Juan Ruiz:
      // dos Hoz + un Vayne, jugó Hoz una vez y se le quitaron los dos Hoz
      // juntos). Asignaciones DISTINTAS sí pueden cumplirse juntas en la
      // misma partida (p.ej. iba de soporte Y sin Flash a la vez) — el
      // filtro es por championAssigned, no un límite de uno por partida.
      const oldestByAssignment = new Map<string, PendingPenalty>();
      for (const p of compliant) {
        const current = oldestByAssignment.get(p.championAssigned);
        if (!current || p.createdAt < current.createdAt) {
          oldestByAssignment.set(p.championAssigned, p);
        }
      }
      for (const p of oldestByAssignment.values()) {
        state.set(p.id, { status: "completed", completedOnMatchId: match.matchId });
      }
      counter = 0; // Ventana fresca para los castigos que queden pendientes.

      // Misión Escudo: esta partida SÍ fue "de castigo" (cumplió al menos
      // uno) — pero solo cuenta si ALGUNO de los cumplidos ACÁ es un
      // castigo REAL (isSelfInflicted=false, alguien te lo mandó de
      // verdad). Si TODOS los cumplidos en esta partida son autoinfligidos
      // (rebote/hongo/incumplimiento), no toca la racha para nada — mismo
      // motivo que excluye estos tres del contador de protección
      // (noncompliancePenaltyIds en /api/update-rankings, caso Benimaru):
      // sin este chequeo, alguien podría ignorar a propósito sus castigos
      // reales para que el sistema le otorgue uno autoinfligido y así
      // fabricar "partidas de castigo" propias a demanda, en vez de
      // depender de que alguien más lo ataque de verdad. Cuenta como si
      // fuera una partida cualquiera (no toca la racha, ni suma ni corta),
      // igual que el `else` de abajo — nunca antes.
      const hasRealCompletion = [...oldestByAssignment.values()].some(
        (p) => !p.isSelfInflicted,
      );
      if (hasRealCompletion) {
        if (match.win) {
          shieldStreak += 1;
          if (shieldStreak >= SHIELD_STREAK_TARGET) {
            shieldsGranted += 1;
            shieldStreak = 0;
          }
        } else {
          shieldStreak = 0;
        }
      }
    } else {
      counter += 1;
      if (counter >= PENALTY_GAME_LIMIT) {
        // Se agotó la ventana compartida sin cumplir ninguno: ya no se
        // descalifica — el grupo pendiente queda tal cual, y se le suma un
        // castigo más (lo rollea y lo otorga el caller). Ventana fresca
        // para lo que quede pendiente (incluido el nuevo, una vez que el
        // caller lo agregue).
        nonComplianceGrants += 1;
        counter = 0;
      }
    }
  }

  return {
    updates: penalties.map((p) => {
      const s = state.get(p.id)!;
      return { id: p.id, status: s.status, completedOnMatchId: s.completedOnMatchId };
    }),
    gamesWithoutCompliance: counter,
    nonComplianceGrants,
    shieldStreakCount: shieldStreak,
    shieldsGranted,
  };
}
