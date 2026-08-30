-- MoronQChallenge: reemplaza el cursor de cumplimiento de castigos
-- (penalty_check_since, timestamptz — ver 0023_penalty_check_cursor.sql)
-- por uno basado en match id de Riot, no en hora.
--
-- Bug real encontrado en producción: el startTime que se le manda a Riot
-- para pedir partidas nuevas es INCLUSIVO — la misma partida que ya se
-- había evaluado con éxito en una corrida anterior podía volver a
-- aparecer en la respuesta de Riot y recontarse de nuevo, sin que el
-- jugador jugara nada nuevo. Se había parchado con un chequeo extra de
-- "playedAt <= penalty_check_since", pero seguía siendo una comparación
-- de timestamps — fràgil por diseño (offsets, redondeo, el borde exacto
-- de Riot). El motor de misiones (quest_progress.last_processed_match_id)
-- ya resuelve este mismo problema desde el principio comparando IDs de
-- partida exactos, no horas — este cambio alinea el cumplimiento de
-- castigos al mismo criterio, ya probado.

alter table participants
  add column if not exists penalty_last_processed_match_id text;
  -- Igual que quest_progress.last_processed_match_id, pero para el grupo
  -- de castigos pendientes ACTUAL: la última partida de match-v5 que ya
  -- se evaluó contra los castigos pendientes. null significa "todavía no
  -- se evaluó nada para este grupo" (arranca tomando toda la ventana
  -- reciente como nueva, igual que el motor de misiones). Se resetea a
  -- null cada vez que el grupo de castigos pendientes queda vacío
  -- (cumplido, descalificado, o perdonado) — un grupo nuevo siempre
  -- arranca fresco.

alter table participants
  drop column if exists penalty_check_since;
