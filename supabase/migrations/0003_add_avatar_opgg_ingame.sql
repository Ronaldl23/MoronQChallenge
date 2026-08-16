-- MoronQChallenge: avatar manual opcional + link de OP.GG + estado en vivo

alter table participants
  add column if not exists avatar_url text,
  add column if not exists opgg_url text,
  add column if not exists in_game boolean not null default false;
