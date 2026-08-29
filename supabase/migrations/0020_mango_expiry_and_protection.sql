-- MoronQChallenge: caducidad de mangos en inventario (24h) + protección
-- post-cumplimiento contra nuevos mangos (5h) — ver src/lib/mango-launch.ts
-- (MANGO_EXPIRY_HOURS, PROTECTION_HOURS) y src/app/api/jugador/mangos/launch.
--
-- Reemplaza el viejo límite "3 mangos recibidos por día" por "3 castigos
-- activos simultáneos" (penalty_progress.status='pending', ya existía, no
-- necesita columna nueva): mientras el objetivo tenga 3 pendientes, no se
-- le puede lanzar un cuarto. Al cumplir uno de esos 3 (no antes, y no si
-- tenía menos de 3), queda con 5hs de protección contra mangos nuevos —
-- mango_protection_until, seteado desde /api/update-rankings.

alter table participants
  add column if not exists mango_protection_until timestamptz;

-- Cuándo entró ESTE mango puntual al inventario de alguien (se resetea en
-- 0 cada vez que un mango nuevo se otorga por misión — nunca se toca en un
-- lanzamiento, rebote, ni revelación). Pasadas MANGO_EXPIRY_HOURS sin
-- lanzarlo, el mango queda "podrido": sube su probabilidad de rebote del
-- 10% al 30% (ver EXPIRED_BOUNCE_PROBABILITY_PERCENT) y cambia de ícono en
-- el inventario (MangoPodrido/MangoPodridoFurioso, ver InventoryPanel.tsx).
alter table mangos
  add column if not exists inventory_since timestamptz not null default now();

-- Los mangos que YA estaban en inventario antes de este cambio arrancan el
-- conteo de 24h desde AHORA, no desde que se ganaron (podría haber sido
-- hace semanas de estar "holdeados") — así nadie pierde de golpe un mango
-- el día del deploy, tal como pidió el usuario.
update mangos set inventory_since = now() where status = 'in_inventory';
