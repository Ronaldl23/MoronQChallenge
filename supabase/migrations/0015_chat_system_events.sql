-- MoronQChallenge: chat global — Fase B (notificaciones de sistema)
--
-- Además de los mensajes que escriben los jugadores ('user', el default),
-- el chat ahora también recibe filas generadas automáticamente por el
-- servidor cuando: (a) se revela un mango (/api/jugador/mangos/reveal) o
-- (b) un participante cambia de tier/división en /api/update-rankings.
-- `type` es lo que le dice a ChatWidget que pinte esa fila distinto (ícono
-- de evento en vez de avatar, sin el tratamiento de burbuja mía/ajena) —
-- se queda en la MISMA tabla que los mensajes normales (no una tabla
-- aparte) para que aparezcan intercalados en el mismo salón, en el mismo
-- orden cronológico, sin tener que hacer un merge de dos fuentes en el
-- cliente.
alter table chat_messages
  add column if not exists type text not null default 'user'
    check (type in ('user', 'mango_event', 'rank_event'));

-- Solo se usa cuando type = 'rank_event' — le dice al cliente si pintar la
-- flecha verde (ascenso) o roja (descenso) sin tener que parsear el texto
-- del mensaje. Null para 'user' y 'mango_event'.
alter table chat_messages
  add column if not exists rank_direction text
    check (rank_direction in ('up', 'down'));

create index if not exists chat_messages_type_idx on chat_messages (type);
