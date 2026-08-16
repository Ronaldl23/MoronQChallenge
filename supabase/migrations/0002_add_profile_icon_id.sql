-- MoronQChallenge: profile_icon_id for real summoner icons (Data Dragon)

alter table participants
  add column if not exists profile_icon_id integer;
