-- Excepción puntual por jugador (pedido explícito del usuario, caso
-- Biangelo/Xenøm#Morøn tras cambiar de cuenta): un participante en
-- placements (sin ninguna partida ranked jugada esta temporada CON ESA
-- cuenta) normalmente no puede recibir mangos — regla pensada para proteger
-- a alguien genuinamente nuevo/débil, sin rango con el que ubicarlo en el
-- bono anti-bullying (ver /api/jugador/mangos/launch). El problema real: una
-- cuenta recién vinculada puede estar "en placements" administrativamente
-- (0 partidas registradas todavía) pero tener un MMR de base alto — no es
-- débil ni nueva, y bloquearle recibir castigos en ese estado es injusto
-- para el resto mientras dure esa ventana.
--
-- false (default) = comportamiento normal para todo el mundo: en placements
-- no puede recibir mangos. true en un participante puntual = puede recibir
-- mangos aunque esté en placements — el resto de las reglas (protección,
-- tope de castigos activos, Escudo, etc.) siguen aplicando igual, esto
-- SOLO destraba el bloqueo por placements.
alter table participants
  add column if not exists receives_penalties_while_in_placements boolean not null default false;
