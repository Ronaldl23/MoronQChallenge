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
