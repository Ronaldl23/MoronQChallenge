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
const MIN_MATCH_DURATION_SECONDS = 300;

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
 *   para los que queden).
 * - Si no cumple ninguno, el contador sube en 1.
 * - Si el contador llega al límite sin ninguna coincidencia, TODOS los
 *   castigos que sigan pendientes en ese momento pasan a
 *   'flagged_for_review' juntos, y el contador vuelve a 0 (sin castigos
 *   pendientes no hay contador corriendo — regla 5).
 * - Remakes (gameDurationSeconds < MIN_MATCH_DURATION_SECONDS) se ignoran
 *   por completo: no cumplen ningún castigo NI gastan una de las 3
 *   partidas de la ventana — es como si no se hubieran jugado.
 */

/** Partidas ranked que tiene un jugador para cumplir ALGUNO de sus castigos pendientes antes de que el grupo entero pase a revisión manual (regla confirmada por el usuario). */
export const PENALTY_GAME_LIMIT = 3;

export interface PenaltyMatchOutcome {
  matchId: string;
  /**
   * ISO 8601 completo (ej. `new Date(x).toISOString()`) — se compara contra
   * el `createdAt` más viejo entre los castigos pendientes, para no contar
   * partidas jugadas ANTES de que existiera NINGÚN castigo. La comparación
   * es lexicográfica (string < string), así que el caller DEBE normalizar
   * ambos con el mismo formato — un timestamptz de Postgres tal cual no
   * siempre coincide (offset "+00:00" en vez de "Z", distinta cantidad de
   * dígitos decimales).
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
}

export interface PendingPenalty {
  id: string;
  /** champion_assigned tal cual está en `mangos` — SUPPORT_ASSIGNMENT, NO_FLASH_ASSIGNMENT, un id de hechizo (ej. "SummonerHaste"), o un id de campeón puntual. */
  championAssigned: string;
  /** Mismo formato normalizado que `playedAt` de PenaltyMatchOutcome — ver esa nota. */
  createdAt: string;
}

export type PenaltyStatus = "pending" | "completed" | "flagged_for_review";

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
}: {
  penalties: PendingPenalty[];
  matches: PenaltyMatchOutcome[];
  /** Contador compartido actual del participante (participants.penalty_games_without_compliance). */
  gamesWithoutCompliance: number;
}): ProcessPenaltyMatchesResult {
  // Regla 5: sin castigos pendientes no hay contador corriendo — no-op total,
  // y el contador vuelve a 0 (por si quedó un resto de un grupo anterior).
  if (penalties.length === 0) {
    return { updates: [], gamesWithoutCompliance: 0 };
  }

  const state = new Map<string, { status: PenaltyStatus; completedOnMatchId: string | null }>(
    penalties.map((p) => [p.id, { status: "pending", completedOnMatchId: null }]),
  );
  const earliestCreatedAt = penalties.reduce(
    (min, p) => (p.createdAt < min ? p.createdAt : min),
    penalties[0].createdAt,
  );
  let counter = gamesWithoutCompliance;

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
      for (const p of compliant) {
        state.set(p.id, { status: "completed", completedOnMatchId: match.matchId });
      }
      counter = 0; // Ventana fresca para los castigos que queden pendientes.
    } else {
      counter += 1;
      if (counter >= PENALTY_GAME_LIMIT) {
        // Se agotó la ventana compartida: TODO el grupo que siga pendiente pasa a revisión junto.
        for (const p of stillPending) {
          state.set(p.id, { status: "flagged_for_review", completedOnMatchId: null });
        }
        counter = 0; // Sin pendientes → sin contador corriendo (regla 5), listo para el próximo grupo.
      }
    }
  }

  return {
    updates: penalties.map((p) => {
      const s = state.get(p.id)!;
      return { id: p.id, status: s.status, completedOnMatchId: s.completedOnMatchId };
    }),
    gamesWithoutCompliance: counter,
  };
}
