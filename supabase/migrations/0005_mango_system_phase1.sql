-- MoronQChallenge: Sistema de Mangos — Fase 1 (login personal + estructura de datos)
--
-- Deliberadamente NO incluye lógica de ganar/lanzar mangos, castigos, ni
-- descalificación — eso viene en fases siguientes. Esta migración solo
-- crea las tablas y el login_code; nada las llena ni las procesa todavía.

alter table participants
  add column if not exists login_code text unique;

create table if not exists mangos (
  id uuid primary key default gen_random_uuid(),
  owner_participant_id uuid not null references participants (id) on delete cascade,
  status text not null default 'in_inventory' check (
    status in ('in_inventory', 'sent', 'returned')
  ),
  sent_by_participant_id uuid references participants (id) on delete set null,
  champion_assigned text,
  created_at timestamptz not null default now()
);

create index if not exists mangos_owner_participant_id_idx on mangos (owner_participant_id);
create index if not exists mangos_sent_by_participant_id_idx on mangos (sent_by_participant_id);

create table if not exists quest_progress (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants (id) on delete cascade,
  quest_type text not null check (quest_type in ('win_streak', 'kda_streak')),
  current_progress integer not null default 0 check (current_progress >= 0),
  target integer not null check (target > 0),
  -- match id de Riot (match-v5), no un uuid interno — evita reprocesar la
  -- misma partida dos veces cuando la lógica de quests corra en fases
  -- futuras. Nullable: todavía no se procesó ninguna partida.
  last_processed_match_id text,
  updated_at timestamptz not null default now(),

  unique (participant_id, quest_type)
);

create index if not exists quest_progress_participant_id_idx on quest_progress (participant_id);

create table if not exists penalty_progress (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants (id) on delete cascade,
  mango_id uuid not null references mangos (id) on delete cascade,
  games_without_compliance integer not null default 0 check (games_without_compliance >= 0),
  disqualified boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists penalty_progress_participant_id_idx on penalty_progress (participant_id);
create index if not exists penalty_progress_mango_id_idx on penalty_progress (mango_id);

alter table mangos enable row level security;
alter table quest_progress enable row level security;
alter table penalty_progress enable row level security;

-- Fase 1: sin policies de lectura/escritura pública todavía — no hay UI que
-- las necesite hasta que la lógica real del juego exista. Todo el acceso
-- por ahora pasa por rutas server-side con el service role (bypassa RLS,
-- ver src/lib/supabase/admin.ts). Se agregan policies concretas cuando una
-- fase futura defina qué necesita ver/tocar cada jugador desde /jugador.

-- ---------------------------------------------------------------------
-- login_code es un secreto personal (funciona como password de /jugador):
-- la policy pública existente en participants ("using (true)" de
-- 0001_init.sql) es a nivel de FILA, no de columna, así que sin esto
-- cualquiera con la publishable key podría leer login_code de todos los
-- participantes pegándole directo a la REST API de Supabase (sin pasar
-- por la app). Se bloquea la columna específica en vez de tocar esa
-- policy, para no romper el select(*) público que ya depende de leer el
-- resto de columnas.
--
-- IMPORTANTE: si en el futuro agregás una columna nueva a participants y
-- necesitás que sea públicamente legible, hay que sumarla también a este
-- GRANT — quedó documentado acá porque es fácil de olvidar.
revoke select on participants from anon, authenticated;
grant select (
  id, nombre_display, riot_game_name, riot_tag, puuid, region_platform,
  profile_icon_id, avatar_url, opgg_url, in_game, main_role, created_at
) on participants to anon, authenticated;

-- ---------------------------------------------------------------------
-- OPCIONAL — backfill de login_code para los participantes que ya existen
-- hoy. Sin esto, los ~20 participantes actuales no van a poder loguearse
-- en /jugador hasta que se les asigne uno a mano (vía SQL o recreándolos).
-- Corré este bloque manualmente si querés que el roster actual también
-- pueda usar el sistema de Mangos desde ya; si preferís asignarlos vos
-- mismo más despacio (por ejemplo al confirmar la identidad de cada
-- jugador), no lo corras.
--
-- do $$
-- declare
--   participant record;
--   new_code text;
--   alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- sin 0/O/1/I/L
-- begin
--   for participant in select id from participants where login_code is null loop
--     loop
--       new_code := '';
--       for i in 1..8 loop
--         new_code := new_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
--       end loop;
--       exit when not exists (select 1 from participants where login_code = new_code);
--     end loop;
--     update participants set login_code = new_code where id = participant.id;
--   end loop;
-- end $$;
