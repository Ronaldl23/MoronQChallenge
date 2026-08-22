import type { RankDivision, RankTier } from "@/types/database";

/**
 * Cálculo puro de estadísticas de LP a partir de una secuencia de snapshots
 * — extraído de getLeaderboard() (src/lib/leaderboard.ts) para poder
 * reusarlo también en /api/update-rankings (sistema "Aegis", ver
 * src/lib/aegis.ts): ahí se necesita el promedio histórico de LP ganado por
 * victoria de un participante ANTES de la partida nueva de esta corrida,
 * mismo cálculo, distinto caller.
 */

/** Ventana de días hacia atrás usada tanto para ±LP/trend en el leaderboard como para el promedio histórico que consume el chequeo de Aegis. */
export const TREND_WINDOW_DAYS = 7;

export interface LpHistoryPoint {
  tier: RankTier;
  division: RankDivision | null;
  lp: number;
}

export interface LpStats {
  /** Promedio de LP ganado POR VICTORIA (0 si no hubo ninguna subida de LP detectada). */
  avgLpGained: number;
  /** Promedio de LP perdido POR DERROTA, número positivo (0 si no hubo ninguna). */
  avgLpLost: number;
  /** Promedio neto de LP por partida jugada (0 si no hubo ninguna partida con cambio de LP detectado). */
  netAvgLp: number;
  /** Deltas de LP (positivos y negativos) de cada partida detectada, más vieja primero. */
  gameDeltas: number[];
}

/**
 * `history` debe venir ordenado por fecha ascendente (más viejo primero).
 * Los pares de snapshots consecutivos con tier/división distintos se
 * ignoran: el LP se resetea al cambiar de tier/división, así que esa
 * diferencia no representa una partida ganada/perdida real.
 */
export function computeLpStats(history: LpHistoryPoint[]): LpStats {
  let lpGainedTotal = 0;
  let lpLostTotal = 0;
  let winsWithLpChange = 0;
  let lossesWithLpChange = 0;
  const gameDeltas: number[] = [];

  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    if (prev.tier !== curr.tier || prev.division !== curr.division) {
      continue; // El LP se resetea al cambiar de tier/división: no es comparable.
    }
    const delta = curr.lp - prev.lp;
    if (delta > 0) {
      lpGainedTotal += delta;
      winsWithLpChange++;
    } else if (delta < 0) {
      lpLostTotal += Math.abs(delta);
      lossesWithLpChange++;
    }
    if (delta !== 0) gameDeltas.push(delta);
  }

  const avgLpGained =
    winsWithLpChange > 0 ? Math.round(lpGainedTotal / winsWithLpChange) : 0;
  const avgLpLost =
    lossesWithLpChange > 0 ? Math.round(lpLostTotal / lossesWithLpChange) : 0;
  const gamesWithLpChange = winsWithLpChange + lossesWithLpChange;
  const netAvgLp =
    gamesWithLpChange > 0
      ? Math.round((lpGainedTotal - lpLostTotal) / gamesWithLpChange)
      : 0;

  return { avgLpGained, avgLpLost, netAvgLp, gameDeltas };
}
