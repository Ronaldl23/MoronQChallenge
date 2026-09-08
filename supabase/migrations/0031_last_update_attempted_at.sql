-- MoronQChallenge: rotación justa del cron de /api/update-rankings.
--
-- El cron procesa a TODO el roster en una sola corrida, con varias
-- llamadas a Riot (espaciadas) por participante — con maxDuration=60 en
-- Vercel, si el roster creció o Riot responde lento/con 429s, la función
-- puede quedarse sin tiempo antes de llegar a todos. Sin ningún orden
-- explícito en la consulta, el orden real de Postgres no está garantizado
-- ni es parejo — en la práctica algunos participantes quedaban SIEMPRE
-- rezagados corrida tras corrida (bug real reportado: Juan Ruiz sin
-- actualizarse 18+ horas mientras otros se actualizaban cada pocos
-- minutos).
--
-- last_update_attempted_at guarda cuándo el cron empezó a procesar a cada
-- participante (no cuándo terminó ni si tuvo éxito) — la próxima corrida
-- ordena por esta columna ascendente (null primero, para quien nunca se
-- procesó), así que quien lleva más tiempo sin que el cron siquiera lo
-- intente pasa a ser el PRIMERO de la fila la próxima vez. Se marca al
-- principio del procesamiento de cada uno (no al final) a propósito: así
-- la rotación es justa incluso si ese participante puntual falla o tarda
-- mucho, en vez de que un fallo repetido lo deje trabado siempre primero
-- (o siempre último) y le robe el turno a los demás.

alter table participants
  add column if not exists last_update_attempted_at timestamptz;
