/**
 * Correlación de LP ganado/perdido por partida contra el historial de
 * snapshots — el LP no viene por partida en ningún campo de match-v5 (ver
 * el comentario en src/app/api/match-history/route.ts), así que se estima
 * cruzando la hora de fin de cada partida contra los snapshots que la
 * bracketean (uno justo antes, uno justo después). Extraído de ahí para
 * poder reusarlo también en /api/update-rankings (sistema Aegis, ver
 * src/lib/aegis.ts) — antes ese archivo calculaba el LP de la partida
 * comparando contra "el snapshot de la corrida anterior", que asume que
 * el cron detecta la partida (vía match-v5) en la MISMA corrida en la que
 * el LP nuevo aparece en league-v4. Esos dos endpoints de Riot no
 * propagan siempre al mismo ritmo — cuando match-v5 se atrasa un par de
 * corridas respecto a league-v4, el snapshot "anterior" ya tenía el LP
 * nuevo cargado, y la resta daba 0 (partida real, Aegis incluido, sin
 * detectar). Anclar la comparación a la hora REAL de la partida en vez de
 * a qué corrida del cron la detectó primero arregla eso sin importar
 * cuánto se haya atrasado la detección.
 */

export interface SnapshotPoint {
  tier: string;
  division: string | null;
  lp: number;
  created_at: string;
}

export interface MatchTimestamp {
  matchId: string;
  gameEndTimestamp: number;
}

/**
 * `snapshots` debe venir ordenado por created_at ascendente (más viejo
 * primero). Devuelve un Map matchId -> LP ganado/perdido, solo para las
 * partidas que se pudieron aislar sin ambigüedad.
 */
export function correlateLpChanges(
  matches: MatchTimestamp[],
  snapshots: SnapshotPoint[],
): Map<string, number> {
  const result = new Map<string, number>();
  if (snapshots.length < 2) return result;

  // Comparar como epoch numérico, no como string: Postgres puede devolver
  // created_at con offset "+00:00" en vez del "Z" que arma toISOString(),
  // y una comparación de strings entre esos dos formatos no es confiable.
  const snapshotTimes = snapshots.map((s) => new Date(s.created_at).getTime());

  // matchId -> índice del primer snapshot tomado en o después de que terminó esa partida.
  const bracketOf = new Map<string, number>();
  for (const { matchId, gameEndTimestamp } of matches) {
    const nextIdx = snapshotTimes.findIndex((t) => t >= gameEndTimestamp);
    if (nextIdx <= 0) continue; // sin snapshot "antes" o "después" disponible todavía
    bracketOf.set(matchId, nextIdx);
  }

  // Si dos o más partidas caen en el mismo hueco entre snapshots, no hay
  // forma de repartir el delta entre ellas — se descartan todas del grupo.
  const countByBracket = new Map<number, number>();
  for (const idx of bracketOf.values()) {
    countByBracket.set(idx, (countByBracket.get(idx) ?? 0) + 1);
  }

  for (const [matchId, idx] of bracketOf) {
    if (countByBracket.get(idx) !== 1) continue;

    const next = snapshots[idx];
    const prev = snapshots[idx - 1];
    if (prev.tier !== next.tier || prev.division !== next.division) continue;

    result.set(matchId, next.lp - prev.lp);
  }

  return result;
}

export interface SingleMatchLpResult<T> {
  /** null si no se pudo aislar (sin snapshot "antes" todavía, o cambió de tier/división en el medio). */
  lpGained: number | null;
  /**
   * Los snapshots estrictamente ANTERIORES al bracket de esta partida —
   * para que el caller calcule el promedio histórico (computeLpStats, ver
   * src/lib/lp-stats.ts) sin que se contamine con el delta de la propia
   * partida evaluada (importa para Aegis: si esta partida quedó
   * "atrapada" en el historial por varias corridas antes de poder
   * aislarla, ese hueco grande no debe colarse en el promedio con el que
   * se la compara). No se llama a computeLpStats directamente ACÁ para
   * que este módulo siga sin depender en tiempo de ejecución de otro
   * módulo "puro" — mismo criterio que el resto de src/lib, ver
   * scripts/test-lp-correlation.mjs.
   */
  priorSnapshots: T[];
}

/**
 * Caso particular de correlateLpChanges para UNA sola partida (el caso de
 * Aegis: newMatchCount === 1) — además del LP ganado, devuelve el slice
 * de snapshots correcto para el promedio histórico, en vez de pedirle al
 * caller que arme ese índice a mano.
 */
export function correlateSingleMatchLp<T extends SnapshotPoint>({
  gameEndTimestamp,
  snapshots,
}: {
  gameEndTimestamp: number;
  /** Ascendente por created_at — igual que correlateLpChanges. */
  snapshots: T[];
}): SingleMatchLpResult<T> {
  const afterIdx = snapshots.findIndex(
    (s) => new Date(s.created_at).getTime() >= gameEndTimestamp,
  );

  if (afterIdx <= 0) {
    return { lpGained: null, priorSnapshots: [] };
  }

  const before = snapshots[afterIdx - 1];
  const after = snapshots[afterIdx];
  const lpGained =
    before.tier === after.tier && before.division === after.division
      ? after.lp - before.lp
      : null;

  return { lpGained, priorSnapshots: snapshots.slice(0, afterIdx) };
}
