-- MoronQChallenge: nueva misión "loss_streak" — 3 derrotas ranked SEGUIDAS
-- (mismo criterio de racha que win_streak, corte con cualquier victoria en
-- el medio) otorgan un Mango, IGUAL para todos los participantes sin
-- importar su categoría de ranking (a diferencia del resto de las
-- misiones, que varían por tier — ver MISSION_TIERS en src/lib/quests.ts).
--
-- Arranca a contar solo desde que se despliega esto en adelante: todas las
-- misiones de un participante comparten el mismo cursor de partidas
-- (quest_progress.last_processed_match_id, ver grantCompletedQuests en
-- /api/update-rankings) — para un participante YA existente ese cursor ya
-- está avanzado (no en null), así que la fila nueva de loss_streak que se
-- le crea la primera vez arranca evaluando solo partidas NUEVAS desde ahí,
-- nunca un backfill de derrotas viejas de antes de este cambio.

alter table quest_progress
  drop constraint if exists quest_progress_quest_type_check;

alter table quest_progress
  add constraint quest_progress_quest_type_check
  check (quest_type in ('win_streak', 'kda_streak', 'deathless_win', 'high_kills', 'beat_participant', 'loss_streak'));
