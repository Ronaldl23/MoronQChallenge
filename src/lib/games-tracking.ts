/**
 * Tope de partidas rastreadas por jugador (pedido explícito del usuario,
 * ver 0040_games_tracking_limit.sql) — lógica pura, sin Riot ni Supabase
 * acá a propósito, mismo criterio que src/lib/aegis.ts.
 */
export const GAMES_TRACKING_LIMIT = 200;

/**
 * true si a este participante ya no hay que seguir rastreándolo: llegó a
 * GAMES_TRACKING_LIMIT partidas ranked reales procesadas desde que entró
 * al torneo, y no tiene la excepción manual del admin
 * (unlimited_games_tracking) activa. El caller decide qué hacer con esto —
 * ver isTrackingFrozen usado en /api/update-rankings (congela rango +
 * misiones) y /api/jugador/mangos/launch (bloquea lanzar/recibir Mangos).
 */
export function isTrackingFrozen(
  trackedGamesPlayed: number,
  unlimitedGamesTracking: boolean,
): boolean {
  return !unlimitedGamesTracking && trackedGamesPlayed >= GAMES_TRACKING_LIMIT;
}
