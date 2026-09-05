-- MoronQChallenge: se elimina la descalificación automática por no cumplir
-- un castigo a tiempo (ver src/lib/penalty.ts, nonComplianceGrants) — en su
-- lugar, agotar la ventana compartida sin cumplir NINGÚN castigo pendiente
-- otorga un castigo MÁS (sin techo), autoinfligido, igual que un mango con
-- hongos (ver 0022_moldy_mango_discard.sql) pero sin balde de rebote.

alter table mangos
  add column if not exists is_noncompliance_penalty boolean not null default false;
  -- true solo en la fila que resulta de no cumplir un castigo a tiempo —
  -- distingue este caso (autoinfligido, sin remitente real, sin rebote) del
  -- lanzamiento/rebote/hongo normal para el mensaje de chat, el toast de
  -- aviso y el ícono global de alerta (ver src/lib/chat-system-messages.ts,
  -- /api/jugador/notifications y GlobalPenaltyAlert).

alter table chat_messages
  drop constraint if exists chat_messages_type_check;

alter table chat_messages
  add constraint chat_messages_type_check
  check (type in ('user', 'mango_event', 'rank_event', 'mango_moldy_event', 'mango_noncompliance_event'));
