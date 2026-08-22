import type { ShowcaseParticipant } from "@/types/database";

/**
 * Lógica pura del sistema Pick'em — separada de src/lib/pickem.ts (que
 * hace I/O contra Supabase/cookies) para poder testearla sin red ni base
 * de datos, mismo criterio que src/lib/quests.ts/aegis.ts (ver
 * scripts/test-pickem.mjs). `lockAtIso` se pasa como parámetro en vez de
 * importar TOURNAMENT_START_DATE acá — ese import es de valor (no de
 * tipo), y el test corre con `node --experimental-strip-types` que solo
 * puede borrar imports de tipo del alias "@/", no resolverlos de verdad.
 */
export function isPickemLockedAt(now: number, lockAtIso: string): boolean {
  return now >= new Date(lockAtIso).getTime();
}

/**
 * El orden guardado tiene que ser EXACTAMENTE el roster actual: mismos ids,
 * sin duplicados, sin faltantes ni sobrantes. Si el roster cambió (el admin
 * agregó/quitó a alguien) desde la última vez que esta persona guardó, un
 * intento de guardar con el order viejo se rechaza acá — el frontend
 * siempre debe re-pedir el roster actual antes de mostrar el tablero.
 */
export function validatePredictedOrder(
  order: unknown,
  rosterIds: string[],
): { ok: true; order: string[] } | { ok: false; error: string } {
  if (!Array.isArray(order) || !order.every((id) => typeof id === "string")) {
    return { ok: false, error: "El orden debe ser una lista de ids" };
  }
  const rosterSet = new Set(rosterIds);
  const orderSet = new Set(order);
  if (order.length !== orderSet.size) {
    return { ok: false, error: "El orden tiene participantes repetidos" };
  }
  if (order.length !== rosterIds.length || [...orderSet].some((id) => !rosterSet.has(id))) {
    return {
      ok: false,
      error: "El orden no coincide con el roster actual de participantes",
    };
  }
  return { ok: true, order: order as string[] };
}

/** trim + lowercase — para que un espacio de más o una diferencia de mayúsculas entre showcase_participants.nombre y participants.nombre_display no rompa el match del reveal. */
export function normalizePickemName(name: string): string {
  return name.trim().toLowerCase();
}

export type PickemPositionStatus = "correct" | "incorrect" | "unknown";

/**
 * Compara una predicción guardada contra el ranking final. "unknown" (sin
 * color) cuando el participante de esa posición no tiene un match en el
 * ranking final — showcase_participants y participants son tablas
 * independientes sin FK entre sí (alguien puede estar en el roster público
 * sin tener una cuenta de Riot cargada), así que esto es un caso real, no
 * hipotético: NUNCA se pinta rojo solo porque no hay dato, eso sería
 * información falsa (el pick podría ser correcto y no lo sabríamos).
 */
export function computePickemResultStatus(
  order: string[],
  participantsById: Map<string, ShowcaseParticipant>,
  finalRankByName: Map<string, number>,
): PickemPositionStatus[] {
  return order.map((participantId, index) => {
    const participant = participantsById.get(participantId);
    if (!participant) return "unknown";
    const finalRank = finalRankByName.get(normalizePickemName(participant.nombre));
    if (finalRank === undefined) return "unknown";
    return finalRank === index + 1 ? "correct" : "incorrect";
  });
}
