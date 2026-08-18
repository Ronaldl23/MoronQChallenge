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
 * Lógica pura de cumplimiento de castigos — sin Riot ni Supabase acá a
 * propósito, mismo criterio que src/lib/quests.ts (testeable con secuencias
 * simuladas, ver scripts/test-penalty.mjs).
 */

/** Partidas ranked que tiene un jugador para cumplir un castigo antes de pasar a revisión manual (Fase 4, regla confirmada por el usuario). */
export const PENALTY_GAME_LIMIT = 3;

export interface PenaltyMatchOutcome {
  matchId: string;
  /**
   * ISO 8601 completo (ej. `new Date(x).toISOString()`) — se compara contra
   * `createdAt` del castigo para no contar partidas jugadas ANTES de que se
   * asignara. La comparación es lexicográfica (string < string), así que el
   * caller DEBE normalizar ambos con el mismo formato — un timestamptz de
   * Postgres tal cual no siempre coincide (offset "+00:00" en vez de "Z",
   * distinta cantidad de dígitos decimales).
   */
  playedAt: string;
  /** Id de campeón (Data Dragon, ej. "Ahri") jugado en esa partida. */
  championPlayed: string;
  /** teamPosition crudo de match-v5 ("TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY", puede venir vacío en casos raros). */
  teamPosition: string;
}

export interface PendingPenalty {
  id: string;
  /** champion_assigned tal cual está en `mangos` — SUPPORT_ASSIGNMENT o un id de campeón puntual. */
  championAssigned: string;
  gamesWithoutCompliance: number;
  /** Mismo formato normalizado que `playedAt` de PenaltyMatchOutcome — ver esa nota. */
  createdAt: string;
}

export type PenaltyStatus = "pending" | "completed" | "flagged_for_review";

export interface PenaltyUpdate {
  id: string;
  gamesWithoutCompliance: number;
  /** 'pending' si no cambió nada esta corrida (igual puede haber subido gamesWithoutCompliance sin llegar al límite). */
  status: PenaltyStatus;
  /** Solo si status pasó a 'completed' en esta corrida — qué partida lo cumplió. */
  completedOnMatchId: string | null;
}

/**
 * Si el castigo es SUPPORT_ASSIGNMENT, se cumple con CUALQUIER campeón
 * siempre que teamPosition sea UTILITY; si es un campeón puntual, se cumple
 * jugando exactamente ese campeón (sin importar la línea).
 */
function isCompliant(championAssigned: string, match: PenaltyMatchOutcome): boolean {
  if (championAssigned === SUPPORT_ASSIGNMENT) return match.teamPosition === "UTILITY";
  return match.championPlayed === championAssigned;
}

/**
 * Procesa, en orden cronológico (más vieja primero), las partidas ranked
 * nuevas de un participante contra TODOS sus castigos en estado 'pending' —
 * cada partida cuenta simultáneamente para todos los castigos pendientes
 * (regla confirmada: no hay que elegir uno solo, y una partida puede cumplir
 * más de un castigo a la vez). No toca Supabase — el caller persiste el
 * resultado y dispara la notificación de "pasó a revisión" si corresponde.
 */
export function processPenaltyMatches({
  penalties,
  matches,
}: {
  penalties: PendingPenalty[];
  matches: PenaltyMatchOutcome[];
}): PenaltyUpdate[] {
  const state = new Map<
    string,
    { gamesWithoutCompliance: number; status: PenaltyStatus; completedOnMatchId: string | null }
  >(
    penalties.map((p) => [
      p.id,
      { gamesWithoutCompliance: p.gamesWithoutCompliance, status: "pending", completedOnMatchId: null },
    ]),
  );

  for (const match of matches) {
    for (const penalty of penalties) {
      const s = state.get(penalty.id)!;
      if (s.status !== "pending") continue;
      // Partidas jugadas ANTES de que se asignara el castigo no cuentan ni a favor ni en contra.
      if (match.playedAt < penalty.createdAt) continue;

      if (isCompliant(penalty.championAssigned, match)) {
        s.status = "completed";
        s.completedOnMatchId = match.matchId;
      } else {
        s.gamesWithoutCompliance += 1;
        if (s.gamesWithoutCompliance >= PENALTY_GAME_LIMIT) {
          s.status = "flagged_for_review";
        }
      }
    }
  }

  return penalties.map((p) => {
    const s = state.get(p.id)!;
    return {
      id: p.id,
      gamesWithoutCompliance: s.gamesWithoutCompliance,
      status: s.status,
      completedOnMatchId: s.completedOnMatchId,
    };
  });
}
