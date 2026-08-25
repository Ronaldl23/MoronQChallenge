-- MoronQChallenge: cuarta misión del sistema de Mangos — beat_participant
--
-- Se cumple con UNA partida ranked solo/duo ganada contra CUALQUIER otro
-- participante registrado del torneo (target=1, se resetea a 0 después de
-- otorgar el mango — mismo patrón que deathless_win, ver src/lib/quests.ts).
-- A diferencia de las otras tres, no depende solo del resultado propio: el
-- caller (src/app/api/update-rankings/route.ts) cruza los 10 jugadores de
-- cada partida contra la tabla participants por puuid para determinar si
-- alguno del equipo rival también está en el torneo.
--
-- El CHECK de quest_type se declaró inline en 0005 (sin nombre explícito),
-- así que Postgres le puso el nombre por default: <tabla>_<columna>_check.
-- No se puede ALTER un CHECK existente, hay que dropearlo y crearlo de nuevo
-- (mismo patrón que 0007_deathless_win_quest.sql).

alter table quest_progress
  drop constraint if exists quest_progress_quest_type_check;

alter table quest_progress
  add constraint quest_progress_quest_type_check
  check (quest_type in ('win_streak', 'kda_streak', 'deathless_win', 'beat_participant'));
