-- MoronQChallenge: Sistema "Aegis" — contador ESTIMADO de veces que a un
-- participante probablemente le tocó el bonus de LP por autofill de Riot
-- ("Aegis of Valor": doble LP en la victoria). La API no expone si esto
-- ocurrió en una partida puntual — /api/update-rankings lo estima (ver
-- src/lib/aegis.ts) cuando puede aislar el LP de UNA sola partida ranked
-- SoloQ nueva desde la corrida anterior (con 2+ no se sabe cuál dio cuánto,
-- se salta igual que un remake) y esa partida fue una victoria con LP
-- ganado >= 1.7x el promedio histórico del jugador.
--
-- Mismo patrón que penalty_games_without_compliance (0010): un contador
-- simple en participants, no una tabla aparte — siempre existe (default 0),
-- sin lifecycle de fila propio. A diferencia de ese, ESTE sí debe ser
-- público (se muestra en el leaderboard y el podio), por eso el GRANT.

alter table participants
  add column if not exists aegis_count integer not null default 0
    check (aegis_count >= 0);

-- Ver el aviso en 0005_mango_system_phase1.sql: toda columna nueva de
-- participants que deba ser públicamente legible hay que sumarla al GRANT
-- column-level (la policy de SELECT es a nivel de fila, no alcanza sola).
grant select (aegis_count) on participants to anon, authenticated;
