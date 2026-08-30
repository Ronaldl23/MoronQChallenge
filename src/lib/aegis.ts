/**
 * Lógica pura del sistema "Aegis" — sin Riot ni Supabase acá a propósito,
 * mismo criterio que src/lib/quests.ts y src/lib/penalty.ts (testeable con
 * casos simulados, ver scripts/test-aegis.mjs).
 *
 * Riot da doble LP en una victoria ranked cuando el jugador fue autofilleado
 * a un rol no preferido ("Aegis of Valor"). La API no expone si esto pasó
 * en una partida puntual, así que se ESTIMA: por cada partida ranked SoloQ
 * nueva que el caller pueda aislar sin ambigüedad contra el historial de
 * snapshots (ver correlateLpChanges en src/lib/lp-correlation.ts — puede
 * ser más de una por corrida, no solo "la más reciente"), si esa partida
 * fue una victoria y el LP ganado en ella es >= AEGIS_LP_MULTIPLIER veces
 * el promedio histórico de LP por victoria de ese jugador ANTES de esa
 * partida, se cuenta como un "probable Aegis".
 *
 * La aislación (cuál partida cae en qué hueco entre snapshots, y cuándo dos
 * partidas comparten el mismo hueco sin forma de repartir el LP entre
 * ellas) es responsabilidad del caller vía correlateLpChanges — este módulo
 * solo evalúa el umbral una vez que ya se resolvió el LP de una partida
 * puntual.
 */

export const AEGIS_LP_MULTIPLIER = 1.7;

export interface AegisCheckInput {
  /**
   * true si esta partida fue una victoria que no es remake. null/false si
   * fue derrota, remake, o no se pudo bajar su detalle — nunca proc.
   */
  isNonRemakeWin: boolean | null;
  /**
   * LP ganado en esta partida puntual, ya aislado por el caller (vía
   * calculateEloScore, ver src/lib/lp-correlation.ts — así un
   * ascenso/descenso de tier/división de por medio sigue dando el LP real
   * ganado en esa partida, no lo descarta). null si no se pudo aislar sin
   * ambigüedad (comparte hueco de snapshots con otra partida, o no hay
   * snapshot "antes" todavía).
   */
  lpGained: number | null;
  /**
   * Promedio histórico de LP ganado por victoria de este participante,
   * calculado ANTES de esta partida (computeLpStats sobre su historial
   * previo, ver lp-stats.ts). 0 si no hay historial suficiente todavía.
   */
  historicalAvgLpGained: number;
}

/**
 * true si esta partida puntual corresponde a un "probable Aegis" para el
 * participante — el caller es responsable de incrementar aegis_count (una
 * vez por cada partida que dé true, si evalúa varias de la misma corrida).
 */
export function isProbableAegisProc({
  isNonRemakeWin,
  lpGained,
  historicalAvgLpGained,
}: AegisCheckInput): boolean {
  if (!isNonRemakeWin) return false; // derrota, remake, o desconocido.
  if (lpGained === null || lpGained <= 0) return false;
  // Sin promedio histórico todavía (menos de una victoria previa con cambio
  // de LP detectado en la ventana) no hay con qué comparar — de lo
  // contrario CUALQUIER LP ganado pasaría el umbral (1.7 * 0 = 0),
  // disparando falsos positivos en la primera partida de cada jugador.
  if (historicalAvgLpGained <= 0) return false;

  return lpGained >= historicalAvgLpGained * AEGIS_LP_MULTIPLIER;
}
