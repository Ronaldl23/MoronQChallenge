import { randomInt } from "node:crypto";
import type { Champion } from "@/lib/champions";

/** 10% de probabilidad de que la ruleta devuelva el mango (rebote). */
export const BOUNCE_PROBABILITY_PERCENT = 10;
/** 20% de probabilidad de que el castigo sea "jugar de Support" en vez de un campeón puntual. */
export const SUPPORT_PROBABILITY_PERCENT = 20;
/** El 70% restante se reparte en partes iguales entre todos los campeones individuales (pickRandomChampion ya es uniforme). */

/** Máximo de mangos que un mismo jugador puede RECIBIR en 24hs (distinto del máximo de 3 en inventario propio, Fase 2). */
export const DAILY_RECEIVE_LIMIT = 3;

/**
 * Valor reservado para `mangos.champion_assigned` cuando el castigo es "jugar
 * de Support" en vez de un campeón específico. No hace falta una columna
 * aparte: ningún id de campeón de Data Dragon es literalmente "SUPPORT" (son
 * PascalCase, ej. "Ahri", "MonkeyKing"), así que el valor ya es inequívoco.
 * Importante para la Fase 4 (verificar cumplimiento): si el castigo es
 * SUPPORT_ASSIGNMENT, se cumple con CUALQUIER campeón siempre que
 * teamPosition sea UTILITY; si no, se cumple jugando exactamente ese campeón.
 */
export const SUPPORT_ASSIGNMENT = "SUPPORT";

/** Mismo ícono de posición que ya usamos en el historial de partidas (Community Dragon). */
export const SUPPORT_ICON_URL =
  "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-utility.png";

export type PunishmentOutcome = { kind: "support" } | { kind: "champion"; champion: Champion };
export type FirstRollOutcome = { kind: "bounce" } | PunishmentOutcome;

export function pickRandomChampion(champions: Champion[]): Champion {
  if (champions.length === 0) throw new Error("Lista de campeones vacía");
  return champions[randomInt(champions.length)];
}

/**
 * Ruleta principal (lanzamiento a un objetivo): 10% rebote, 20% Support, 70%
 * repartido uniforme entre todos los campeones — pickRandomChampion ya
 * reparte parejo, así que alcanza con un solo roll de 0-99 para decidir el
 * "balde" y, si toca campeón, un segundo roll uniforme dentro de esa lista.
 */
export function rollFirstOutcome(champions: Champion[]): FirstRollOutcome {
  const roll = randomInt(100);
  if (roll < BOUNCE_PROBABILITY_PERCENT) return { kind: "bounce" };
  if (roll < BOUNCE_PROBABILITY_PERCENT + SUPPORT_PROBABILITY_PERCENT) return { kind: "support" };
  return { kind: "champion", champion: pickRandomChampion(champions) };
}

/**
 * Ruleta del castigo que rebota (segunda ruleta tras un "MANGO DEVUELTO"):
 * sin balde de rebote — un rebote no puede volver a rebotar, ver
 * /api/jugador/mangos/launch. Mismo % de Support que la primera ruleta
 * (20%), el resto para campeones — no se renormaliza el 70%→77.8% por
 * simplicidad, la intención (Support pesa mucho más que un campeón puntual)
 * se mantiene igual.
 */
export function rollPenaltyOutcome(champions: Champion[]): PunishmentOutcome {
  const roll = randomInt(100);
  if (roll < SUPPORT_PROBABILITY_PERCENT) return { kind: "support" };
  return { kind: "champion", champion: pickRandomChampion(champions) };
}

/** Nombre/ícono para mostrar un castigo ya asignado (notificaciones, banner) — resuelve tanto Support como un campeón puntual. */
export function resolveAssignedPunishment(
  championAssigned: string | null,
  championById: Map<string, Champion>,
): { name: string; iconUrl: string | null } {
  if (championAssigned === SUPPORT_ASSIGNMENT) {
    return { name: "Support", iconUrl: SUPPORT_ICON_URL };
  }
  if (!championAssigned) {
    return { name: "un campeón", iconUrl: null };
  }
  const champion = championById.get(championAssigned);
  return { name: champion?.name ?? championAssigned, iconUrl: champion?.iconUrl ?? null };
}

export function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}
