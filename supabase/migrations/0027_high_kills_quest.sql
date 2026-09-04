-- MoronQChallenge: agrega la quest "high_kills" (partida con N+ kills, ver
-- MISSION_TIERS en src/lib/quests.ts) al CHECK de quest_progress.quest_type.
-- Mismo patrón que 0007_deathless_win_quest.sql y 0018_beat_participant_quest.sql.

alter table quest_progress
  drop constraint if exists quest_progress_quest_type_check;

alter table quest_progress
  add constraint quest_progress_quest_type_check
  check (quest_type in ('win_streak', 'kda_streak', 'deathless_win', 'high_kills', 'beat_participant'));
