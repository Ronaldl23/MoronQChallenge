/**
 * "Online" para el sistema de Mangos — usado en la lista de objetivos al
 * lanzar un mango (LaunchModal), para que quien lanza vea quién está
 * conectado ahora mismo. `last_seen_at` se actualiza como efecto
 * secundario del poll de 20s de MangoNotifications (GET
 * /api/jugador/notifications) — 45s da margen de sobra sobre ese intervalo
 * sin quedar desactualizado mucho tiempo si alguien se va.
 */
export const ONLINE_WINDOW_MS = 45_000;

export function isOnline(lastSeenAt: string | null, now: number = Date.now()): boolean {
  if (!lastSeenAt) return false;
  const lastSeenMs = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(lastSeenMs)) return false;
  return now - lastSeenMs < ONLINE_WINDOW_MS;
}
