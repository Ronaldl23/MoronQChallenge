/**
 * Cálculo puro de "cuántas posiciones subió/bajó cada quien" — extraído de
 * getLeaderboard() (src/lib/leaderboard.ts) para poder testearlo con
 * secuencias simuladas (ver scripts/test-rank-change.mjs) sin depender de
 * Supabase.
 */

export interface RankChangeInput {
  id: string;
  currentEloScore: number;
  /** null = sin snapshot anterior con qué comparar (recién apareció en el ranking). */
  previousEloScore: number | null;
}

/**
 * Devuelve, por id, cuántas posiciones subió (positivo) o bajó (negativo)
 * cada entrada entre el ranking "anterior" y el "actual" — 0 si se mantuvo
 * igual, null si no tenía un previousEloScore con qué comparar. El ranking
 * anterior se arma SOLO entre quienes sí tienen previousEloScore (no se
 * mezcla a quien recién apareció con el resto), así que ambos rankings
 * comparan posiciones dentro de un grupo consistente entre sí.
 */
export function computeRankChanges(
  entries: RankChangeInput[],
): Map<string, number | null> {
  const currentRankById = new Map<string, number>();
  [...entries]
    .sort((a, b) => b.currentEloScore - a.currentEloScore)
    .forEach((e, i) => currentRankById.set(e.id, i + 1));

  const previousRankById = new Map<string, number>();
  entries
    .filter((e): e is RankChangeInput & { previousEloScore: number } =>
      e.previousEloScore !== null,
    )
    .sort((a, b) => b.previousEloScore - a.previousEloScore)
    .forEach((e, i) => previousRankById.set(e.id, i + 1));

  const result = new Map<string, number | null>();
  for (const entry of entries) {
    const previousRank = previousRankById.get(entry.id);
    result.set(
      entry.id,
      previousRank !== undefined
        ? previousRank - currentRankById.get(entry.id)!
        : null,
    );
  }
  return result;
}
