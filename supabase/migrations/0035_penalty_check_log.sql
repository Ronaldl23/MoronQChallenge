-- Historial de diagnóstico de checkPenaltyCompliance — hasta ahora,
-- participants.penalty_check_debug (0025_penalty_check_debug.sql) se pisaba
-- en CADA corrida, así que para cuando alguien reportaba un castigo raro
-- (caso real: Juan Ruiz con un Veigar por incumplimiento que parecía haber
-- cumplido con partidas anteriores) el mensaje exacto de la corrida que lo
-- otorgó ya se había perdido, sobrescrito por corridas posteriores — no
-- había forma de probar qué pasó de verdad, solo reconstruirlo a ciegas.
--
-- Esta tabla guarda CADA mensaje como una fila nueva en vez de pisar uno
-- solo, para poder reconstruir la secuencia completa de un caso puntual con
-- una simple consulta por participant_id y rango de fechas. No reemplaza a
-- penalty_check_debug (se sigue escribiendo igual, por compatibilidad con
-- consultas ya usadas) — esto es un historial ADICIONAL, sin cambiar
-- ninguna regla real del sistema de castigos.
--
-- Sin RLS policies a propósito, mismo criterio que cron_locks
-- (0034_cron_lock.sql): solo lo escribe/lee el cron vía service role.
create table if not exists penalty_check_log (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  created_at timestamptz not null default now(),
  message text not null
);

create index if not exists penalty_check_log_participant_created_idx
  on penalty_check_log (participant_id, created_at desc);

alter table penalty_check_log enable row level security;
