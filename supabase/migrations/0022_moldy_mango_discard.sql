-- MoronQChallenge: mangos podridos que nadie lanza a tiempo se pueden
-- tirar a la basura — ver MOLDY_TRASH_UNLOCK_HOURS/MOLDY_PROBABILITY_PERCENT
-- en src/lib/mango-launch.ts y /api/jugador/mangos/discard.
--
-- A las MANGO_EXPIRY_HOURS + MOLDY_TRASH_UNLOCK_HOURS (24 + 5 = 29h) de
-- estar sin lanzarse, un mango ya no se puede lanzar — el botón pasa a ser
-- "tirar a la basura". Al tirarlo, 50% de probabilidad de que tenga hongos:
-- si toca, se le asigna un castigo a quien lo tiró (misma ruleta/reveal que
-- cualquier otro mango) y se anuncia en el chat con un mensaje distinto al
-- de siempre; si no toca, el mango simplemente desaparece del inventario
-- sin castigo, con un aviso que solo ve quien lo tiró.

alter table mangos
  add column if not exists is_moldy_trash boolean not null default false;
  -- true solo en la fila que resulta de tirar un mango podrido a la
  -- basura y que le tocó hongo — distingue este caso (autoinfligido, sin
  -- remitente real) del lanzamiento/rebote normal para el mensaje de chat
  -- y el toast de aviso (ver src/lib/chat-system-messages.ts y
  -- /api/jugador/notifications).

alter table mangos
  drop constraint if exists mangos_status_check;

alter table mangos
  add constraint mangos_status_check
  check (status in ('in_inventory', 'pending_reveal', 'sent', 'returned', 'discarded'));
  -- 'discarded': se tiró a la basura y NO tenía hongos — sale del
  -- inventario sin generar ningún castigo (a diferencia de 'returned',
  -- que sí es un rebote real con su propio penalty_progress).

alter table chat_messages
  drop constraint if exists chat_messages_type_check;

alter table chat_messages
  add constraint chat_messages_type_check
  check (type in ('user', 'mango_event', 'rank_event', 'mango_moldy_event'));
