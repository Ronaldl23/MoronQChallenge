-- Tope de partidas rastreadas por jugador (pedido explícito del usuario):
-- al llegar a GAMES_TRACKING_LIMIT (200, ver src/lib/games-tracking.ts)
-- partidas ranked reales procesadas desde que el jugador entró al torneo,
-- /api/update-rankings deja de tocarlo por completo — no le actualiza más
-- el rango/LP (queda fijo en su última posición), no le procesa más
-- misiones, y tampoco puede lanzar ni recibir Mangos (ver
-- /api/jugador/mangos/launch) — hasta que un admin lo habilite de nuevo
-- desde /admin.
--
-- tracked_games_played arranca en 0 para participantes nuevos (se suma sola
-- en cada corrida, ver realMatchesProcessed en update-rankings/route.ts).
-- Para el roster YA existente al momento de esta migración, hace falta
-- correr /api/admin/games-tracking-backfill una vez para calcular su valor
-- real retroactivo (cuántas partidas ranked ya jugaron desde que se los
-- agregó, participants.created_at) — sin eso, todos arrancarían en 0 como
-- si recién empezaran, aunque ya tengan cientos de partidas jugadas.
--
-- unlimited_games_tracking es la excepción manual del admin (mismo patrón
-- que receives_penalties_while_in_placements/mango_quests_locked_games_remaining):
-- true = este jugador nunca se congela, sin importar cuántas partidas
-- acumule.
--
-- Ninguna de las dos se agrega al GRANT público de participants a
-- propósito (ver el comentario largo en 0005_mango_system_phase1.sql) —
-- ambas quedan admin-only, mismo criterio que mango_quests_locked_games_remaining.
alter table participants
  add column if not exists tracked_games_played integer not null default 0,
  add column if not exists unlimited_games_tracking boolean not null default false;
