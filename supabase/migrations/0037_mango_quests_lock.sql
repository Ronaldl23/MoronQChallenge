-- Bloqueo temporal de misiones/mangos por partida para un participante
-- puntual (pedido explícito del usuario: Eduardo reinició su cuenta/torneo
-- y no debería poder ganar mangos por misión ni avanzar progreso hasta
-- haber jugado un mínimo de partidas ranked reales DESPUÉS del reinicio —
-- pero SÍ debe poder seguir recibiendo castigos de otros jugadores
-- normalmente, eso es un sistema totalmente aparte, sin relación con esto).
--
-- null (default) = sin bloqueo, comportamiento normal para todo el mundo.
-- Un número > 0 = cuántas partidas ranked reales (no remakes) le faltan
-- todavía para desbloquearse — se descuenta sola en cada corrida del cron a
-- medida que juega, y al llegar a 0 se limpia sola (vuelve a null) sin
-- intervención manual.
alter table participants
  add column if not exists mango_quests_locked_games_remaining integer;
