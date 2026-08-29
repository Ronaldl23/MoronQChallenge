/**
 * Lógica pura del sistema "Aegis" — sin Riot ni Supabase acá a propósito,
 * mismo criterio que src/lib/quests.ts y src/lib/penalty.ts (testeable con
 * casos simulados, ver scripts/test-aegis.mjs).
 *
 * Riot da doble LP en una victoria ranked cuando el jugador fue autofilleado
 * a un rol no preferido ("Aegis of Valor"). La API no expone si esto pasó
 * en una partida puntual, así que se ESTIMA: cuando en una corrida de
 * /api/update-rankings se puede aislar el LP ganado por UNA sola partida
 * nueva (ver detectMatchDeltaWindow más abajo — exactamente 1 partida ranked
 * SoloQ nueva desde la corrida anterior, no un remake), si esa partida fue
 * una victoria y el LP ganado en ella es >= AEGIS_LP_MULTIPLIER veces el
 * promedio histórico de LP por victoria de ese jugador, se cuenta como un
 * "probable Aegis".
 *
 * Con 2+ partidas nuevas en la misma corrida no se puede saber cuál de
 * ellas dio cuánto LP (el LP crudo de league-v4 es un acumulado, no viene
 * partida por partida) — se salta por completo, ni cuenta ni descarta nada,
 * mismo criterio que un remake para las quests (ver MIN_MATCH_DURATION_SECONDS
 * en quests.ts).
 */

export const AEGIS_LP_MULTIPLIER = 1.7;

export interface AegisCheckInput {
  /**
   * Partidas ranked SoloQ nuevas detectadas esta corrida (mismo conteo que
   * usa el motor de misiones, ver findNewMatchIds en update-rankings/route.ts).
   * null cuando no se pudo determinar (falla de Riot al pedir el historial).
   */
  newMatchCount: number | null;
  /**
   * true si esa ÚNICA partida nueva fue una victoria que no es remake.
   * Solo tiene sentido cuando newMatchCount === 1; se ignora en cualquier
   * otro caso. null si no se pudo bajar el detalle de esa partida.
   */
  singleNewMatchIsNonRemakeWin: boolean | null;
  /**
   * LP ganado en esa única partida nueva: delta entre el snapshot de esta
   * corrida y el snapshot inmediatamente anterior (vía calculateEloScore,
   * ver src/lib/lp-correlation.ts — así un ascenso/descenso de
   * tier/división de por medio sigue dando el LP real ganado en esa
   * partida, no lo descarta). null solo si no existe un snapshot anterior
   * con el que comparar.
   */
  lpGainedThisMatch: number | null;
  /**
   * Promedio histórico de LP ganado por victoria de este participante,
   * calculado ANTES de esta partida nueva (computeLpStats sobre su
   * historial previo, ver lp-stats.ts). 0 si no hay historial suficiente
   * todavía.
   */
  historicalAvgLpGained: number;
}

/**
 * true si esta corrida corresponde a un "probable Aegis" para el
 * participante — el caller es responsable de incrementar aegis_count.
 */
export function isProbableAegisProc({
  newMatchCount,
  singleNewMatchIsNonRemakeWin,
  lpGainedThisMatch,
  historicalAvgLpGained,
}: AegisCheckInput): boolean {
  if (newMatchCount !== 1) return false; // 0, 2+, o desconocido: no aislable.
  if (!singleNewMatchIsNonRemakeWin) return false; // derrota, remake, o desconocido.
  if (lpGainedThisMatch === null || lpGainedThisMatch <= 0) return false;
  // Sin promedio histórico todavía (menos de una victoria previa con cambio
  // de LP detectado en la ventana) no hay con qué comparar — de lo
  // contrario CUALQUIER LP ganado pasaría el umbral (1.7 * 0 = 0),
  // disparando falsos positivos en la primera partida de cada jugador.
  if (historicalAvgLpGained <= 0) return false;

  return lpGainedThisMatch >= historicalAvgLpGained * AEGIS_LP_MULTIPLIER;
}
