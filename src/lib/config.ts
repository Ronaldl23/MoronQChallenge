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

/**
 * Fecha en la que se BLOQUEA el Pick'em — deliberadamente separada de
 * TOURNAMENT_START_DATE. El Pick'em es algo casual para la comunidad, no
 * parte del torneo competitivo en sí, así que se le da un margen de 3 días
 * después del inicio real del torneo para quien no llegó a cargar su pick
 * a tiempo (24 → 27 de agosto, mismo horario — 2026-08-28T00:00:00Z == 27
 * de agosto de 2026, 8:00 PM Venezuela). Solo isPickemLocked() (ver
 * src/lib/pickem.ts) usa esta fecha — hasTournamentStarted()/
 * hasTournamentEnded() (src/lib/tournament-schedule.ts), el countdown del
 * header, /participantes y el chat siguen atados a TOURNAMENT_START_DATE/
 * TOURNAMENT_END_DATE sin ningún cambio.
 */
function addDaysUTC(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export const PICKEM_LOCK_DATE = addDaysUTC(TOURNAMENT_START_DATE, 3);
