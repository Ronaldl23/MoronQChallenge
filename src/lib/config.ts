export const TOURNAMENT_NAME = "MoronQChallenge";

function addDaysUTC(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

/**
 * Fecha/hora en UTC en la que arranca el torneo. Guardada en UTC a
 * propósito (con sufijo "Z") para que el countdown del header cuente
 * correctamente sin importar la zona horaria del navegador de quien lo
 * visite — la conversión a hora local la hace el motor de Date del
 * navegador, no algo que tengamos que calcular acá.
 *
 * Reinicio de temporada: 4 de septiembre de 2026, medianoche UTC —
 * arranca de nuevo con el ranking vacío (ver la limpieza de datos hecha
 * ese mismo día).
 */
export const TOURNAMENT_START_DATE = "2026-09-04T00:00:00Z";

/**
 * Fin del torneo: exactamente TOURNAMENT_DURATION_DAYS después del inicio
 * (regla confirmada por el usuario: 30 días fijos, no "1 mes calendario"
 * — evita que la duración real varíe según el mes en que caiga el
 * reinicio). Se calcula a partir de TOURNAMENT_START_DATE en vez de
 * hardcodear una segunda fecha suelta, para que ambas no puedan
 * desincronizarse si el inicio cambia.
 */
export const TOURNAMENT_DURATION_DAYS = 30;

export const TOURNAMENT_END_DATE = addDaysUTC(
  TOURNAMENT_START_DATE,
  TOURNAMENT_DURATION_DAYS,
);

/**
 * Fecha en la que se BLOQUEA el Pick'em — deliberadamente separada de
 * TOURNAMENT_START_DATE. El Pick'em es algo casual para la comunidad, no
 * parte del torneo competitivo en sí, así que se le da un margen de 3 días
 * después del inicio real del torneo para quien no llegó a cargar su pick
 * a tiempo. Solo isPickemLocked() (ver src/lib/pickem.ts) usa esta fecha —
 * hasTournamentStarted()/hasTournamentEnded() (src/lib/tournament-schedule.ts),
 * el countdown del header, /participantes y el chat siguen atados a
 * TOURNAMENT_START_DATE/TOURNAMENT_END_DATE sin ningún cambio.
 */
export const PICKEM_LOCK_DATE = addDaysUTC(TOURNAMENT_START_DATE, 3);
