-- MoronQChallenge: participants + ranked snapshots

create extension if not exists "pgcrypto";

create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  nombre_display text not null,
  riot_game_name text not null,
  riot_tag text not null,
  puuid text not null unique,
  region_platform text not null,
  created_at timestamptz not null default now(),

  unique (riot_game_name, riot_tag)
);

create table if not exists snapshots (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants (id) on delete cascade,
  tier text not null check (
    tier in (
      'IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD',
      'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'
    )
  ),
  division text check (division in ('I', 'II', 'III', 'IV')),
  lp integer not null check (lp >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  elo_score integer not null,
  created_at timestamptz not null default now()
);

create index if not exists snapshots_participant_id_idx on snapshots (participant_id);
create index if not exists snapshots_created_at_idx on snapshots (created_at desc);
create index if not exists snapshots_elo_score_idx on snapshots (elo_score desc);

alter table participants enable row level security;
alter table snapshots enable row level security;

-- Public leaderboard: anyone can read. Writes happen only through the
-- service-role key from the Riot API ingestion job (see src/lib/supabase/admin.ts).
create policy "participants are publicly readable"
  on participants for select
  using (true);

create policy "snapshots are publicly readable"
  on snapshots for select
  using (true);
