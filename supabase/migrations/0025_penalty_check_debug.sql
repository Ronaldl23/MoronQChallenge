-- MoronQChallenge: rastro de diagnóstico para el chequeo de cumplimiento de
-- castigos (checkPenaltyCompliance en /api/update-rankings/route.ts).
--
-- Hasta ahora, si esta función se salía temprano sin evaluar nada (falla al
-- pedirle a Riot, sin partidas nuevas, etc.) no quedaba ningún rastro visible
-- para el usuario — solo un console.error en los logs de Vercel, que no
-- revisa. Este campo se pisa en CADA corrida con una descripción corta de
-- qué pasó, consultable con SQL directo en vez de tener que ir a buscar
-- logs.

alter table participants
  add column if not exists penalty_check_debug text;
  -- Última corrida de checkPenaltyCompliance para este participante: qué
  -- pasó (ok, sin castigos pendientes, falla de Riot con su status, etc.) y
  -- cuándo, como texto plano. Se pisa cada corrida, no es un historial.
