-- MoronQChallenge: contador PRIVADO (nunca expuesto por ninguna API ni UI,
-- a propósito — pedido explícito del usuario) de cuántos castigos por
-- incumplimiento acumuló un participante EN EL DÍA (UTC) actual (ver
-- nonComplianceGrants en src/lib/penalty.ts, NONCOMPLIANCE_BAN_THRESHOLD
-- ahí mismo — máximo 2 tolerados por día, el 3ro banea). Se reinicia solo
-- al cambiar de día, comparando contra noncompliance_penalty_last_date. Al
-- llegar al umbral se lo descalifica automáticamente
-- (participants.manually_disqualified) — mismo mecanismo que ya usa un
-- admin para banear a mano desde /admin, solo que acá lo dispara el propio
-- cron.

alter table participants
  add column if not exists noncompliance_penalty_count integer not null default 0;

alter table participants
  add column if not exists noncompliance_penalty_last_date date;
