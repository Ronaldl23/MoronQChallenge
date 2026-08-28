-- MoronQChallenge: descalificación manual desde /admin
--
-- Hasta ahora `isDisqualified` (leaderboard, badge, fila roja/último
-- lugar) salía únicamente de si el participante tenía algún
-- penalty_progress en status='disqualified' (no cumplió un castigo de
-- mango a tiempo — ver src/lib/penalty.ts). Esto agrega una segunda vía,
-- independiente: un admin puede descalificar a un jugador directamente
-- por otros motivos (trampa, conducta, etc.), sin que exista ningún mango
-- ni castigo de por medio.
--
-- Las dos vías son independientes entre sí — perdonar una no toca la otra
-- (ver /api/admin/penalties/resolve, que ahora limpia ambas para el mismo
-- jugador al perdonarlo).

alter table participants
  add column if not exists manually_disqualified boolean not null default false,
  add column if not exists disqualification_reason text;

-- Ver el aviso en 0005_mango_system_phase1.sql: toda columna nueva de
-- participants que deba ser públicamente legible hay que sumarla al GRANT
-- column-level (la policy de SELECT es a nivel de fila, no alcanza sola).
-- manually_disqualified sí es pública (alimenta el badge/fila roja del
-- leaderboard, igual que aegis_count). disqualification_reason NO se
-- otorga a propósito — es solo para uso interno del admin, no se muestra
-- en el leaderboard público.
grant select (manually_disqualified) on participants to anon, authenticated;
