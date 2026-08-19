-- MoronQChallenge: Sistema de Mangos — contador de cumplimiento COMPARTIDO
-- entre todos los castigos pendientes de un jugador (reemplaza el contador
-- por-castigo individual, que era demasiado exigente: con N castigos
-- pendientes el jugador solo tenía 3 partidas EN TOTAL para resolverlos
-- todos, no 3 intentos por cada uno).
--
-- Vive en participants (no en penalty_progress) porque es un estado
-- compartido por TODOS los castigos pendientes de ese jugador a la vez, no
-- algo propio de un castigo puntual — una columna simple alcanza: siempre
-- existe (default 0), sin lifecycle de fila que crear/borrar como tendría
-- una tabla aparte de 1 fila por participante.
--
-- penalty_progress.games_without_compliance queda sin usar desde acá — no
-- se borra (mismo criterio que `disqualified` en la Fase 4: registro
-- histórico de cómo funcionaba el modelo viejo, sin costo dejarlo).

alter table participants
  add column if not exists penalty_games_without_compliance integer not null default 0
    check (penalty_games_without_compliance >= 0);
