-- MoronQChallenge: sistema "Pick'em" — sección nueva e independiente del
-- sistema de Mangos. Cada jugador (sesión de /jugador) o invitado externo
-- (código propio, ver pickem_guests) predice el orden final 1..N del
-- roster público (showcase_participants). Se guarda hasta que arranca el
-- torneo (TOURNAMENT_START_DATE, ver src/lib/config.ts); a partir de ahí
-- queda de solo lectura para todos. Los resultados (verde/rojo por
-- posición) se revelan a mano desde /admin cuando el torneo termina de
-- verdad — nunca automático por fecha.

-- Invitados externos: acceso EXCLUSIVO a Pick'em, sin relación con
-- participants (no son necesariamente jugadores) ni con el inventario de
-- Mangos. El nombre lo tipea el admin a mano (no viene de ninguna otra
-- tabla) y el código se genera igual que participants.login_code.
create table pickem_guests (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  access_code text not null unique,
  created_at timestamptz not null default now()
);

alter table pickem_guests enable row level security;
-- Sin policies públicas a propósito: access_code funciona como contraseña
-- (mismo criterio que participants.login_code, revocado de anon/authenticated
-- vía GRANT en 0005) — toda lectura pasa por rutas server-side con el
-- service role (createAdminClient), nunca por el cliente público.

-- Un pick guardado por persona (jugador O invitado, nunca ambos ni
-- ninguno). predicted_order es el array ORDENADO de
-- showcase_participants.id (posición 1 primero) — sin FK por elemento
-- (Postgres no soporta FK sobre elementos de un array); se valida en la
-- API al guardar que todos los ids existan en showcase_participants, sin
-- duplicados, y que la cuenta coincida exacto con el roster actual.
create table pickem_picks (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid references participants (id) on delete cascade,
  guest_id uuid references pickem_guests (id) on delete cascade,
  predicted_order uuid[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pickem_picks_owner_xor check (
    (participant_id is not null) <> (guest_id is not null)
  ),
  constraint pickem_picks_participant_unique unique (participant_id),
  constraint pickem_picks_guest_unique unique (guest_id)
);

alter table pickem_picks enable row level security;
-- Sin policies públicas tampoco: "Pick'em de la comunidad" es pública en
-- el sentido de "cualquiera la ve sin sesión", pero se sirve desde un
-- Server Component con el service role (mismo patrón que /jugador) — no
-- hace falta abrir RLS para que esa página funcione.

-- Fila única — el switch manual de "resultados revelados". El admin lo
-- prende a mano desde /admin cuando el torneo termina de verdad; nunca se
-- calcula automático por fecha (a diferencia del bloqueo de edición, que
-- sí es por TOURNAMENT_START_DATE).
create table pickem_settings (
  id boolean primary key default true check (id),
  results_revealed boolean not null default false,
  revealed_at timestamptz
);

insert into pickem_settings (id) values (true);

alter table pickem_settings enable row level security;
-- Sin policies públicas: se lee desde el Server Component de /pickem con
-- el service role, igual que pickem_picks/pickem_guests arriba.
