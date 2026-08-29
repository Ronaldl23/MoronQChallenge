import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Mismo valor que TREND_WINDOW_DAYS en src/lib/lp-stats.ts — duplicado a
 * propósito (no importado) para que este módulo se mantenga sin
 * dependencias locales en tiempo de ejecución y pueda correr directo con
 * Node (--experimental-strip-types, ver scripts/test-ranking.mjs), mismo
 * criterio que MIN_MATCH_DURATION_SECONDS en src/lib/penalty.ts.
 */
const TREND_WINDOW_DAYS = 7;

/**
 * Cálculo puro de "quién está en qué puesto del ranking" — mismo criterio
 * en todos lados que necesiten esto: el leaderboard público (ver
 * getLeaderboard en src/lib/leaderboard.ts, que reusa
 * effectiveEloScoreForRanking/computeRankOrder de acá) y el bono
 * anti-bullying del sistema de mangos (ver fetchRankOrder más abajo y
 * /api/jugador/mangos/launch).
 */

export interface RankableParticipant {
  id: string;
  eloScore: number;
  isDisqualified: boolean;
}

// MIN_SAFE_INTEGER en vez de -Infinity: con dos descalificados a la vez,
// "-Infinity - -Infinity" da NaN (comparador de sort inválido, orden sin
// garantías) — un número finito bien por debajo de cualquier elo_score
// real evita eso y sigue ordenándolos entre sí por su elo real.
export function effectiveEloScoreForRanking(eloScore: number, isDisqualified: boolean): number {
  return isDisqualified ? Number.MIN_SAFE_INTEGER : eloScore;
}

/**
 * Un descalificado siempre ordena al final, sin importar su elo_score real
 * — mismo criterio que la fila roja/último lugar del leaderboard. Devuelve
 * el rank (1 = mejor) de cada participante que se le pasó; no filtra a
 * nadie (a diferencia de fetchRankOrder, que solo trae a quienes tienen
 * snapshot).
 */
export function computeRankOrder(participants: RankableParticipant[]): Map<string, number> {
  const sorted = [...participants].sort(
    (a, b) =>
      effectiveEloScoreForRanking(b.eloScore, b.isDisqualified) -
      effectiveEloScoreForRanking(a.eloScore, a.isDisqualified),
  );
  return new Map(sorted.map((p, i) => [p.id, i + 1] as const));
}

/**
 * Trae el rank actual (1 = mejor) de cada participante con al menos un
 * snapshot en la ventana de TREND_WINDOW_DAYS — mismo criterio y mismo
 * orden que el leaderboard público. Más liviana que getLeaderboard(): no
 * trae LP stats, castigos pendientes, ni resuelve campeones/hechizos —
 * solo lo necesario para saber quién está arriba de quién (ver el bono
 * anti-bullying en /api/jugador/mangos/launch). Un participante sin ningún
 * snapshot en la ventana no tiene rank todavía y no aparece en el mapa
 * devuelto (mismo criterio que unrankedEntries en getLeaderboard).
 */
export async function fetchRankOrder(
  supabase: SupabaseClient<Database>,
): Promise<Map<string, number>> {
  const { data: participants } = await supabase
    .from("participants")
    .select("id, manually_disqualified");
  if (!participants || participants.length === 0) return new Map();

  const participantIds = participants.map((p) => p.id);
  const windowStart = new Date(
    Date.now() - TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Mismo problema/solución que getLeaderboard (ver el comentario ahí):
  // PostgREST corta en 1000 filas por default, así que se pagina con
  // .range() ordenando ascendente — el último valor que pisa cada
  // participant_id en el Map es el más reciente.
  const PAGE_SIZE = 1000;
  const latestEloByParticipant = new Map<string, number>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await supabase
      .from("snapshots")
      .select("participant_id, elo_score")
      .in("participant_id", participantIds)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error || !page) break;
    for (const row of page) latestEloByParticipant.set(row.participant_id, row.elo_score);
    if (page.length < PAGE_SIZE) break;
  }

  const { data: disqualifiedRows } = await supabase
    .from("penalty_progress")
    .select("participant_id")
    .in("participant_id", participantIds)
    .eq("status", "disqualified");
  const penaltyDisqualifiedIds = new Set((disqualifiedRows ?? []).map((r) => r.participant_id));

  const rankable: RankableParticipant[] = participants
    .filter((p) => latestEloByParticipant.has(p.id))
    .map((p) => ({
      id: p.id,
      eloScore: latestEloByParticipant.get(p.id)!,
      isDisqualified: p.manually_disqualified || penaltyDisqualifiedIds.has(p.id),
    }));

  return computeRankOrder(rankable);
}
