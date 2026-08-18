-- MoronQChallenge: Sistema de Mangos — Fase 4 (detección de cumplimiento +
-- cola de revisión manual para descalificar)
--
-- `games_without_compliance` ya existía desde la Fase 1 (sin usar hasta
-- ahora). `status` reemplaza a `disqualified` como fuente de verdad del
-- ciclo de vida de un castigo — `disqualified` queda en la tabla sin uso
-- (nunca se escribió true en ningún lado del código todavía) por si alguna
-- fase futura lo necesita, pero el código nuevo lee/escribe `status`.
--
-- Ciclo de vida: 'pending' (dentro de las 3 partidas, puede cumplir) ->
-- 'completed' (lo cumplió) | 'flagged_for_review' (se pasó de las 3
-- partidas sin cumplir, esperando revisión manual en /admin) -> desde
-- 'flagged_for_review', el admin decide: 'disqualified' (confirmado) o
-- 'pardoned' (perdonado, deja de contar en contra).

alter table penalty_progress
  add column if not exists status text not null default 'pending' check (
    status in ('pending', 'completed', 'flagged_for_review', 'disqualified', 'pardoned')
  ),
  add column if not exists completed boolean not null default false,
  -- Igual que `seen` (Fase 3, toast de "te llegó un Mango") pero para el
  -- aviso separado de "no cumpliste a tiempo, está en revisión" — son dos
  -- eventos distintos que pueden pasar en momentos distintos para el mismo
  -- castigo, así que necesitan su propio flag de "ya se lo mostré".
  add column if not exists flagged_seen boolean not null default false;

create index if not exists penalty_progress_status_idx on penalty_progress (status);
create index if not exists penalty_progress_flagged_seen_idx on penalty_progress (participant_id, flagged_seen);
