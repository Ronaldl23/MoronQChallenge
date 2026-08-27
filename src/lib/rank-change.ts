/**
 * Cálculo puro de "cuántas posiciones subió/bajó cada quien" — extraído de
 * getLeaderboard() (src/lib/leaderboard.ts) para poder testearlo con
 * secuencias simuladas (ver scripts/test-rank-change.mjs) sin depender de
 * Supabase.
 */

/**
 * Antes, `previousEloScore` era siempre el snapshot INMEDIATAMENTE anterior
 * (la corrida previa del cron, cada ~15min) — la flecha ▲▼ cambiaba de
 * valor en cada corrida, así que en la práctica duraba muy poco visible
 * antes de recalcularse contra un punto de comparación distinto. Ahora se
 * ancla a "el snapshot más reciente de hace AL MENOS esto" en vez de "la
 * corrida anterior", para que la flecha se mantenga estable un rato
 * (mínimo RANK_CHANGE_MIN_AGE_MS) en vez de parpadear cada 15 minutos.
 */
export const RANK_CHANGE_MIN_AGE_MS = 60 * 60 * 1000;

export interface EloHistoryPoint {
  eloScore: number;
  /** ISO 8601 — mismo criterio que el resto de comparaciones de timestamps del proyecto (ver src/lib/lp-correlation.ts). */
  createdAt: string;
}

/**
 * Busca el elo_score del snapshot más RECIENTE cuyo `createdAt` sea <=
 * `cutoffIso` (osea, con al menos esa antigüedad) — `history` debe venir
 * ordenado por createdAt ascendente (más viejo primero), mismo criterio que
 * el resto de los módulos de src/lib que recorren historial de snapshots.
 * null si TODOS los snapshots son más nuevos que el cutoff (el participante
 * no tiene suficiente antigüedad todavía como para tener un punto de
 * comparación válido) — en ese caso rankChange queda null (recién apareció
 * en el ranking), mismo comportamiento que antes.
 */
export function findEloScoreAtOrBefore(
  history: EloHistoryPoint[],
  cutoffIso: string,
): number | null {
  let result: number | null = null;
  for (const point of history) {
    if (point.createdAt > cutoffIso) break;
    result = point.eloScore;
  }
  return result;
}

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
