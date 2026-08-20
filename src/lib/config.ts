export const TOURNAMENT_NAME = "MoronQChallenge";

/**
 * Fecha/hora en UTC en la que arranca el torneo. Guardada en UTC a
 * propósito (con sufijo "Z") para que el countdown del header cuente
 * correctamente sin importar la zona horaria del navegador de quien lo
 * visite — la conversión a hora local la hace el motor de Date del
 * navegador, no algo que tengamos que calcular acá.
 *
 * Real: lunes 24 de agosto de 2026, 8:00 PM hora de Venezuela (UTC-4) =
 * 2026-08-25T00:00:00Z.
 */
export const TOURNAMENT_START_DATE = "2026-08-25T00:00:00Z";

/**
 * Fin del torneo: exactamente 1 mes calendario después del inicio (24 de
 * agosto → 24 de septiembre, mismo horario — 2026-09-25T00:00:00Z ==
 * 24 de septiembre de 2026, 8:00 PM Venezuela). Se calcula a partir de
 * TOURNAMENT_START_DATE en vez de hardcodear una segunda fecha suelta, para
 * que ambas no puedan desincronizarse si el inicio cambia.
 */
function addOneCalendarMonthUTC(iso: string): string {
  const date = new Date(iso);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString();
}

export const TOURNAMENT_END_DATE = addOneCalendarMonthUTC(
  TOURNAMENT_START_DATE,
);
