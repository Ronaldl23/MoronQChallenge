-- MoronQChallenge: Sistema de Mangos — reveal diferido al receptor + presencia
--
-- El resultado de la ruleta se sigue decidiendo en el servidor en el
-- momento del LANZAMIENTO (mismo rollFirstOutcome/rollPenaltyOutcome de
-- siempre) — lo que cambia es que ya no se le muestra a quien lanza. Queda
-- guardado como 'pending_reveal' hasta que la persona correcta (el
-- receptor, o en caso de rebote, quien lanzó originalmente) complete el
-- giro de la ruleta en su propia sesión.

alter table mangos
  drop constraint if exists mangos_status_check;

alter table mangos
  add constraint mangos_status_check
  check (status in ('in_inventory', 'pending_reveal', 'sent', 'returned'));

alter table mangos
  add column if not exists is_bounce_back boolean not null default false;
  -- true solo en la fila que se crea cuando el primer roll da rebote (10%)
  -- y el segundo roll (solo champion/Support, sin rebote de nuevo) queda
  -- dirigido de vuelta a quien lanzó originalmente. Informativo — no
  -- cambia la lógica de juego ni el flujo de aviso/revelación, que es
  -- idéntico en ambos casos (confirmado por el usuario).

alter table mangos
  add column if not exists launcher_notified boolean not null default false;
  -- Se pone en true cuando quien LANZÓ un mango ya vio el aviso de "X
  -- recibió tu mango con el castigo: Y" (mismo patrón seen/flagged_seen de
  -- penalty_progress). Backfill abajo: los mangos 'sent' que ya existían
  -- antes de este cambio no deben generar un aluvión de notificaciones
  -- retroactivas cuando se despliegue.
update mangos set launcher_notified = true where status = 'sent';

alter table participants
  add column if not exists last_seen_at timestamptz;
  -- null hasta el primer poll de esa sesión. "Online" = last_seen_at
  -- dentro de los últimos 45s (ver src/lib/presence.ts) — margen sobre el
  -- intervalo de poll de 20s de MangoNotifications, que es quien lo
  -- actualiza como efecto secundario en cada corrida.
