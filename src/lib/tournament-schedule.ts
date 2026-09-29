import { TOURNAMENT_START_DATE, TOURNAMENT_END_DATE } from "@/lib/config";

/**
 * Única fuente de verdad de "¿ya arrancó/terminó el torneo?" para código
 * de aplicación (páginas, componentes de cliente, rutas /api que ya
 * importan @/lib/config libremente). Antes de esto, el mismo cálculo
 * (`Date.now() >= new Date(TOURNAMENT_START_DATE).getTime()`) se
 * reescribía a mano en más de un lugar — ej. ChatWidget.tsx lo
 * recalculaba aparte de isChatOpenAt (src/lib/chat-lock.ts) en vez de
 * reusar el resultado que ya tenía calculado, dos copias de la misma
 * cuenta en el mismo archivo con riesgo real de desincronizarse si se
 * editaba una sin tocar la otra.
 *
 * Los módulos puros sin dependencias (src/lib/pickem-logic.ts,
 * src/lib/chat-lock.ts) NO importan esto — se testean corriendo directo
 * con `node --experimental-strip-types`, que no resuelve el alias "@/";
 * siguen su propio patrón ya establecido en el resto del código
 * (duplicar la comparación de una sola línea + un test que verifica que
 * las copias no se desincronicen, ver scripts/test-chat-lock.mjs).
 */
export function hasTournamentStarted(now: number = Date.now()): boolean {
  return now >= new Date(TOURNAMENT_START_DATE).getTime();
}

/** Igual que arriba pero para el fin del torneo (TOURNAMENT_END_DATE). */
export function hasTournamentEnded(now: number = Date.now()): boolean {
  return now >= new Date(TOURNAMENT_END_DATE).getTime();
}

/**
 * Recta final (pedido explícito del usuario): cuántas horas antes de
 * TOURNAMENT_END_DATE se congela el sistema de Mangos entero — misiones
 * (ya no otorgan progreso ni castigos nuevos), lanzar mangos y recibirlos.
 * 46, no 48 (2 días "redondos"): número exacto pedido, para que el corte
 * caiga apenas el countdown del header marca "2d" en vez de justo en el
 * límite del día.
 */
export const FINAL_STRETCH_HOURS_BEFORE_END = 46;

/**
 * true desde FINAL_STRETCH_HOURS_BEFORE_END antes del fin del torneo en
 * adelante (incluido después de que termine) — usado por
 * /api/update-rankings (corta el motor de misiones) y
 * /api/jugador/mangos/launch (bloquea lanzar/recibir) para que la última
 * recta sea pareja para todos, sin nadie completando una misión de último
 * momento ni bombardeando a otro con mangos cuando ya no hay tiempo de
 * responder.
 */
export function isFinalStretch(now: number = Date.now()): boolean {
  return now >= new Date(TOURNAMENT_END_DATE).getTime() - FINAL_STRETCH_HOURS_BEFORE_END * 60 * 60 * 1000;
}
