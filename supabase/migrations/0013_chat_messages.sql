-- MoronQChallenge: chat global en tiempo real (Fase A — sin notificaciones
-- de sistema todavía, eso es Fase B)
--
-- Un solo salón compartido entre todos los jugadores registrados, sin
-- conversaciones privadas. La identidad del remitente (nombre, avatar) se
-- guarda DENORMALIZADA en cada mensaje en el momento de enviarlo, en vez de
-- hacer join contra participants al leer: los eventos de Realtime
-- (postgres_changes) entregan solo la fila insertada tal cual, sin joins, así
-- que el mensaje tiene que ser autocontenido para que aparezca completo al
-- instante en las pantallas de los demás. Efecto secundario aceptado: si
-- alguien cambia su nombre/avatar más tarde, los mensajes viejos conservan
-- la identidad de cuando los mandó — comportamiento común en chats simples.

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants (id) on delete cascade,
  sender_name text not null,
  sender_avatar_url text,
  sender_profile_icon_id integer,
  message text not null check (char_length(message) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_created_at_idx on chat_messages (created_at desc);

alter table chat_messages enable row level security;

-- Igual que participants/snapshots/mangos: lectura pública, escritura solo
-- por el service role desde /api/chat/send (que valida la cookie de sesión
-- firmada de /jugador antes de insertar) — este proyecto no usa Supabase
-- Auth, así que no hay auth.uid() al que atarle una policy de INSERT por
-- usuario. SELECT público es además un REQUISITO técnico para que Realtime
-- pueda transmitir los INSERTs a los clientes conectados con la clave
-- anon (evaluación de RLS del lado de Realtime).
create policy "chat_messages are publicly readable"
  on chat_messages for select
  using (true);

-- Habilita este publication para que Supabase Realtime transmita los
-- INSERTs por postgres_changes. Sin esto, ChatWidget nunca recibe mensajes
-- nuevos en vivo aunque la tabla y las policies estén bien.
alter publication supabase_realtime add table chat_messages;
