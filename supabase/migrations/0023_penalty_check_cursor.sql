-- MoronQChallenge: cursor propio para el chequeo de cumplimiento de
-- castigos (ver checkPenaltyCompliance en /api/update-rankings/route.ts).
--
-- Bug real encontrado en producción: el chequeo de castigos (rediseñado
-- para no depender del cursor de misiones, que se podía trabar con una
-- sola partida que fallara al bajarse de Riot) volvía a pedir TODA la
-- ventana de partidas desde que existe el castigo en CADA corrida del
-- cron, sin ninguna memoria de qué partidas ya había evaluado — así que
-- la MISMA partida se volvía a contar como "no cumplida" en cada corrida
-- nueva (cada 10 min), sumando al contador compartido una y otra vez por
-- la misma partida real, hasta descalificar a alguien sin que jugara lo
-- suficiente para merecerlo de verdad.

alter table participants
  add column if not exists penalty_check_since timestamptz;
  -- Hasta qué momento ya se evaluaron partidas reales contra los castigos
  -- pendientes actuales — null significa "todavía no se evaluó nada para
  -- este grupo, arrancar desde el created_at más viejo entre los
  -- pendientes". Se resetea a null cada vez que el grupo de castigos
  -- pendientes queda vacío (se resolvieron todos, por cumplimiento,
  -- descalificación, o perdón) — así un grupo nuevo siempre arranca
  -- fresco, sin arrastrar el progreso de un grupo anterior ya resuelto.
