/**
 * Lógica pura del sistema "Aegis" — sin Riot ni Supabase acá a propósito,
 * mismo criterio que src/lib/quests.ts y src/lib/penalty.ts (testeable con
 * casos simulados, ver scripts/test-aegis.mjs).
 *
 * Riot da doble LP en una victoria ranked cuando el jugador fue autofilleado
 * a un rol no preferido ("Aegis of Valor"). La API no expone si esto pasó
 * en una partida puntual, así que se ESTIMA con DOS criterios independientes
 * (cualquiera de los dos alcanza):
 *
 * 1. Umbral ABSOLUTO (pedido explícito del usuario, caso real: Benimaru ganó
 *    38 LP y no se detectó porque su promedio histórico ya era alto — 1.7x
 *    ese promedio quedaba por encima de 38): más de
 *    AEGIS_ABSOLUTE_LP_THRESHOLD LP ganados en una victoria real es Aegis
 *    SIEMPRE, sin importar el promedio histórico del jugador. No aplica
 *    mientras el jugador esté en placements (inPlacements) — ahí los
 *    saltos de LP son erráticos por la calibración en sí, no por Aegis.
 * 2. Umbral RELATIVO (el original): el LP ganado en ella es >=
 *    AEGIS_LP_MULTIPLIER veces el promedio histórico de LP por victoria de
 *    ese jugador ANTES de esa partida — sigue activo para jugadores con
 *    promedio bajo, donde ganar de más no llega a cruzar el umbral absoluto
 *    pero igual es una desviación clara contra SU propio historial.
 *
 * La aislación (cuál partida cae en qué hueco entre snapshots, y cuándo dos
 * partidas comparten el mismo hueco sin forma de repartir el LP entre
 * ellas) es responsabilidad del caller vía correlateLpChanges en
 * src/lib/lp-correlation.ts (puede ser más de una por corrida, no solo "la
 * más reciente") — este módulo solo evalúa el umbral una vez que ya se
 * resolvió el LP de una partida puntual.
 */

export const AEGIS_LP_MULTIPLIER = 1.7;

/**
 * Más de esta cantidad de LP ganados en una victoria real es Aegis SIEMPRE
 * (fuera de placements), sin importar el promedio histórico — pedido
 * explícito del usuario: una victoria normal en SoloQ da como mucho ~25-30
 * LP, así que cruzar esto de por sí ya confirma el doble LP de Aegis. 31 en
 * vez de 30 a propósito (pedido del usuario): "más de 30" generaba
 * ambigüedad justo en el filo, así que el umbral real que se compara es 31
 * (o sea, 32 LP o más).
 */
export const AEGIS_ABSOLUTE_LP_THRESHOLD = 31;

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
  /**
   * true si el participante todavía estaba en placements (sin rango
   * asignado) en el momento de esta partida — desactiva el umbral ABSOLUTO
   * (ver AEGIS_ABSOLUTE_LP_THRESHOLD): los saltos grandes de LP durante la
   * calibración inicial no son Aegis, son el propio sistema de placements.
   * El umbral relativo sigue activo igual (aunque en la práctica casi nunca
   * dispara acá, al no haber promedio histórico todavía). false por
   * default — el caller lo pasa explícito solo cuando puede saberlo con
   * certeza (ver fetchRankOrder en update-rankings/route.ts).
   */
  inPlacements?: boolean;
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
  inPlacements = false,
}: AegisCheckInput): boolean {
  if (!isNonRemakeWin) return false; // derrota, remake, o desconocido.
  if (lpGained === null || lpGained <= 0) return false;

  if (!inPlacements && lpGained > AEGIS_ABSOLUTE_LP_THRESHOLD) return true;

  // Sin promedio histórico todavía (menos de una victoria previa con cambio
  // de LP detectado en la ventana) no hay con qué comparar — de lo
  // contrario CUALQUIER LP ganado pasaría el umbral (1.7 * 0 = 0),
  // disparando falsos positivos en la primera partida de cada jugador.
  if (historicalAvgLpGained <= 0) return false;

  return lpGained >= historicalAvgLpGained * AEGIS_LP_MULTIPLIER;
}
