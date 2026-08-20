-- MoronQChallenge: roster público "Participantes"
--
-- Independiente de la tabla `participants` del sistema de ranking (esa
-- requiere Riot ID/puuid resuelto contra la API de Riot). Esta es un simple
-- roster visual — nombre + foto — para poder mostrar quién participa desde
-- ya, sin depender de tener todas las cuentas de Riot cargadas todavía.

create table if not exists showcase_participants (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  photo_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists showcase_participants_created_at_idx
  on showcase_participants (created_at asc);

alter table showcase_participants enable row level security;

-- Público: cualquiera puede leer el roster. Los escribe solo /admin, vía el
-- service-role key (createAdminClient) — mismo patrón que participants.
create policy "showcase_participants are publicly readable"
  on showcase_participants for select
  using (true);
