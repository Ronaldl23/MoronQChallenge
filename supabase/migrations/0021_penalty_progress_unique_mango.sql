-- Cierra una carrera real que podía duplicar penalty_progress para el mismo
-- mango: dos requests de lanzamiento casi simultáneas sobre el MISMO mango
-- (doble click, retry de red) podían pasar las dos el chequeo de
-- disponibilidad y terminar insertando, cada una, su propia fila de
-- penalty_progress para ese mango (ver /api/jugador/mangos/launch, ya
-- corregido en código con un UPDATE condicional + chequeo de filas
-- afectadas). Cada mango solo genera UN penalty_progress en toda su vida
-- (al lanzarse; el perdón de un admin reutiliza esa misma fila volviendo su
-- status a 'pending', nunca inserta una nueva — ver /api/admin/penalties/resolve),
-- así que mango_id debería ser único ahí — nunca lo fue a nivel de esquema.
--
-- Un duplicado real rompe la revelación: reveal/route.ts busca ESE
-- penalty_progress con .maybeSingle(), que truena con "JSON object
-- requested, multiple (or no) rows returned" apenas hay más de una fila —
-- el mango queda trabado en 'pending_reveal' para siempre, y el conteo de
-- castigos pendientes (leaderboard y /jugador) queda inflado de más.

-- Dedup de lo que ya haya quedado duplicado antes de este fix: se conserva
-- la fila más vieja de cada mango_id (la que ganó la carrera del INSERT
-- original) y se borran las demás.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY mango_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM penalty_progress
)
DELETE FROM penalty_progress
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

ALTER TABLE penalty_progress
  ADD CONSTRAINT penalty_progress_mango_id_key UNIQUE (mango_id);
