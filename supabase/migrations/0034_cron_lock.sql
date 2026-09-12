-- Traba para que /api/update-rankings nunca corra dos veces en paralelo.
--
-- Bug real reportado: el mismo evento de rango (ej. "Jonas ascendió a
-- Platino IV") apareció repetido varias veces seguidas en el chat. La causa
-- es que el cron de cron-job.org dispara esta ruta cada 10 minutos, pero
-- procesar a todo el roster (una llamada a Riot por paso, con sleeps entre
-- medio para no pegarle al rate limit, ver RIOT_REQUEST_DELAY_MS/maxDuration
-- en src/app/api/update-rankings/route.ts) puede tardar varios minutos —
-- si una corrida todavía sigue procesando cuando el cron dispara la
-- siguiente, las dos terminan leyendo el mismo snapshot "anterior" antes de
-- que ninguna de las dos guarde el suyo nuevo, así que ambas detectan el
-- mismo cambio de rango, publican el mismo mensaje en el chat, e insertan
-- CADA UNA su propio snapshot duplicado (ensuciando LP/tendencias, no solo
-- el chat).
--
-- Sin RLS policies a propósito: nadie necesita leer/escribir esto excepto
-- el propio cron vía service role (createAdminClient, que igual ignora RLS)
-- — mismo criterio que cualquier tabla puramente operacional sin cara
-- pública.
create table if not exists cron_locks (
  name text primary key,
  locked_until timestamptz not null
);

alter table cron_locks enable row level security;
