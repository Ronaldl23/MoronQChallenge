-- MoronQChallenge: modo "For Fun" desde /admin
--
-- Pedido explícito del usuario: hay jugadores que no cumplen las reglas del
-- torneo, y es injusto para el resto que sigan compitiendo por premios o
-- participando del sistema de Mangos con normalidad. A diferencia de
-- manually_disqualified (que lo empuja al último lugar del ranking, como si
-- hubiera perdido por trampa/incumplimiento puntual), "For Fun" es un modo
-- aparte: el jugador sigue viéndose en su posición REAL del ranking (no se
-- le toca el elo_score efectivo para nada), pero queda afuera de la
-- consideración de podio/premios, y completamente afuera del sistema de
-- Mangos — no puede lanzarle a nadie NI que le lancen a él.
--
-- Independiente de manually_disqualified a propósito (no lo reemplaza ni se
-- mezcla con él): un jugador puede estar en cualquiera de los dos estados,
-- ambos, o ninguno.
alter table participants
  add column if not exists for_fun boolean not null default false;

-- Ver el aviso en 0005_mango_system_phase1.sql / 0019_manual_disqualification.sql:
-- toda columna nueva de participants que deba ser públicamente legible hay
-- que sumarla al GRANT column-level (la policy de SELECT es a nivel de
-- fila, no alcanza sola). for_fun sí es pública — alimenta la exclusión de
-- podio y el badge en el leaderboard público, igual que manually_disqualified.
grant select (for_fun) on participants to anon, authenticated;
