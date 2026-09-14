-- Bug real reportado: el mensaje de chat del reflejo de Escudo ("X le lanzó
-- un mango a Y, pero fue reflejado...") nunca se publicaba, en silencio,
-- desde que existe la Misión Escudo (0033_shield_mission.sql). Causa: cada
-- tipo nuevo de mensaje de sistema necesita agregarse a la restricción
-- chat_messages_type_check (ver el patrón ya usado en
-- 0022_moldy_mango_discard.sql y 0028_noncompliance_penalty.sql) — al armar
-- el Escudo se agregó 'mango_shield_event' al tipo TypeScript
-- (ChatMessageType) y al código que inserta el mensaje, pero se olvidó
-- actualizar esta restricción de la base. Cada INSERT con
-- type='mango_shield_event' quedaba rechazado por Postgres, y como el
-- código que publica mensajes de sistema es best-effort (atrapa el error y
-- solo lo loguea, para no romper la revelación real del mango), nadie vio
-- nunca el error — el reflejo funcionaba bien (el castigo SÍ se redirigía y
-- se podía cumplir), solo el anuncio en el chat se perdía siempre.
alter table chat_messages
  drop constraint if exists chat_messages_type_check;

alter table chat_messages
  add constraint chat_messages_type_check
  check (type in (
    'user',
    'mango_event',
    'rank_event',
    'mango_moldy_event',
    'mango_noncompliance_event',
    'mango_shield_event'
  ));
