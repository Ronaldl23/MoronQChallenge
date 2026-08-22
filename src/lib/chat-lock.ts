/**
 * Ventana en la que se puede ESCRIBIR en el chat del torneo — antes de
 * TOURNAMENT_START_DATE queda bloqueado (nadie puede hablar todavía), se
 * abre automáticamente el día/hora de inicio, y se cierra de nuevo apenas
 * termina (TOURNAMENT_END_DATE). Leer el historial NO depende de esto —
 * solo el envío de mensajes nuevos.
 *
 * Función pura (mismo criterio que src/lib/pickem-logic.ts) para poder
 * testearla sin red ni base de datos.
 */
export function isChatOpenAt(now: number, startIso: string, endIso: string): boolean {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return now >= start && now < end;
}
