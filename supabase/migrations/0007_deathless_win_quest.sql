-- MoronQChallenge: tercera misión del sistema de Mangos — deathless_win
--
-- Se cumple con UNA sola partida ranked solo/duo ganada con 0 muertes (no es
-- una racha, target=1, se resetea a 0 después de otorgar el mango — mismo
-- patrón que win_streak/kda_streak, ver src/lib/quests.ts).
--
-- El CHECK de quest_type se declaró inline en 0005 (sin nombre explícito),
-- así que Postgres le puso el nombre por default: <tabla>_<columna>_check.
-- No se puede ALTER un CHECK existente, hay que dropearlo y crearlo de nuevo.

alter table quest_progress
  drop constraint if exists quest_progress_quest_type_check;

alter table quest_progress
  add constraint quest_progress_quest_type_check
  check (quest_type in ('win_streak', 'kda_streak', 'deathless_win'));
