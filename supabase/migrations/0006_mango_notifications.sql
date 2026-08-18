-- MoronQChallenge: notificaciones de "te llegó un Mango"
--
-- `seen` marca si el jugador ya vio el toast de "te llegó un Mango" para
-- ese castigo — distinto de `disqualified` (Fase 4, si cumplió o no el
-- castigo en sí). Por default false: cualquier penalty_progress ya
-- existente antes de esta migración se va a notificar la próxima vez que
-- el jugador entre a /jugador, lo cual está bien (no se le informó todavía).

alter table penalty_progress
  add column if not exists seen boolean not null default false;

create index if not exists penalty_progress_seen_idx on penalty_progress (participant_id, seen);
