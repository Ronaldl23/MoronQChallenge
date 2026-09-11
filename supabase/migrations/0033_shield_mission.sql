-- Misión Escudo: ganar SHIELD_STREAK_TARGET (3, ver src/lib/penalty.ts)
-- partidas de castigo SEGUIDAS otorga un Escudo. shield_streak_count es la
-- racha actual (privada, nadie más la ve); shield_count es cuántos Escudos
-- sin usar tiene guardados AHORA MISMO — acumulable a propósito (pedido
-- explícito del usuario), visible solo en el propio inventario de quien lo
-- tiene.
alter table participants
  add column shield_streak_count integer not null default 0,
  add column shield_count integer not null default 0;

-- Mango redirigido por el Escudo de quien iba a recibirlo — mismo mecanismo
-- que is_bounce_back (fila nueva, sent_by_participant_id = quien reflejó),
-- pero con su propio mensaje/ícono/sonido en vez del genérico de rebote
-- (ver /api/jugador/mangos/launch, /api/jugador/mangos/reveal y
-- /api/jugador/notifications).
alter table mangos
  add column is_shield_reflection boolean not null default false;
