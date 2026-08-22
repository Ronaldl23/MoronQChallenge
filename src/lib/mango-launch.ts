import { randomInt } from "node:crypto";
import type { Champion } from "@/lib/champions";
import type { SummonerSpell } from "@/lib/summoner-spells";

/** 10% de probabilidad de que la ruleta devuelva el mango (rebote). */
export const BOUNCE_PROBABILITY_PERCENT = 10;
/** 20% de probabilidad de que el castigo sea "jugar de Support" en vez de un campeón puntual. */
export const SUPPORT_PROBABILITY_PERCENT = 20;
/** 60% de probabilidad de que el castigo sea un hechizo de invocador obligatorio (o "sin Flash"), repartido uniforme entre las SPELL_POOL_SIZE opciones de abajo. */
export const SPELL_PROBABILITY_PERCENT = 60;
/** El 10% restante se reparte en partes iguales entre todos los campeones individuales (pickRandomChampion ya es uniforme). */

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

/**
 * Los 8 hechizos "debes llevar X" del balde de hechizos — ids de Data
 * Dragon, guardados TAL CUAL en `mangos.champion_assigned` (mismo truco que
 * SUPPORT_ASSIGNMENT: ningún id de campeón colisiona con un id de hechizo,
 * así que no hace falta un sentinel ni una columna aparte). El orden acá
 * define el orden de los "slots" 0..7 de rollSpellOutcome.
 */
export const MANDATORY_SPELL_IDS = [
  "SummonerHaste", // Fantasma
  "SummonerHeal", // Curar
  "SummonerBarrier", // Barrera
  "SummonerBoost", // Purificar
  "SummonerExhaust", // Debilitar
  "SummonerTeleport", // Teletransporte
  "SummonerDot", // Incendiar
  "SummonerSmite", // Hoz
] as const;

/** Id de Data Dragon de Flash — el 9no slot del balde de hechizos, ver NO_FLASH_ASSIGNMENT. */
export const FLASH_SPELL_ID = "SummonerFlash";

/**
 * Caso especial: todo el mundo ya lleva Flash por default, así que "debes
 * llevar Flash" no sería un castigo real — el 9no slot uniforme del balde
 * de hechizos en cambio castiga con "JUGAR SIN FLASH" en la próxima
 * partida. Se guarda con este sentinel (mismo truco que SUPPORT_ASSIGNMENT)
 * en vez del id de Flash — así resolveAssignedPunishment/isCompliant lo
 * distinguen sin ambigüedad de "debes llevar Flash" (que no existe como
 * castigo).
 */
export const NO_FLASH_ASSIGNMENT = "NO_FLASH";

/** Los 8 hechizos normales + el caso especial "sin Flash" = 9 opciones uniformes dentro del 60% del balde de hechizos. */
export const SPELL_POOL_SIZE = MANDATORY_SPELL_IDS.length + 1;

export type SpellPunishmentOutcome =
  | { noFlash: false; spell: SummonerSpell }
  | { noFlash: true };

export type PunishmentOutcome =
  | { kind: "support" }
  | { kind: "champion"; champion: Champion }
  | ({ kind: "spell" } & SpellPunishmentOutcome);
export type FirstRollOutcome = { kind: "bounce" } | PunishmentOutcome;

export function pickRandomChampion(champions: Champion[]): Champion {
  if (champions.length === 0) throw new Error("Lista de campeones vacía");
  return champions[randomInt(champions.length)];
}

/**
 * Elige uniforme una de las SPELL_POOL_SIZE opciones del balde de hechizos
 * — slot 0..7 = uno de los MANDATORY_SPELL_IDS ("debes llevar X"), slot 8
 * (el último, correspondiente a "Flash" en el mapeo del usuario) = el caso
 * especial "sin Flash" (ver NO_FLASH_ASSIGNMENT).
 */
function rollSpellOutcome(spells: SummonerSpell[]): SpellPunishmentOutcome {
  const slot = randomInt(SPELL_POOL_SIZE);
  if (slot === MANDATORY_SPELL_IDS.length) return { noFlash: true };

  const spellId = MANDATORY_SPELL_IDS[slot];
  const spellById = new Map(spells.map((s) => [s.id, s]));
  const spell = spellById.get(spellId);
  if (!spell) throw new Error(`Hechizo ${spellId} no encontrado en el listado de Data Dragon`);
  return { noFlash: false, spell };
}

/**
 * Ruleta principal (lanzamiento a un objetivo): 10% rebote, 20% Support,
 * 60% hechizo de invocador (uniforme entre las 9 opciones), 10% repartido
 * uniforme entre todos los campeones — pickRandomChampion ya reparte
 * parejo, así que alcanza con un solo roll de 0-99 para decidir el "balde"
 * y, si toca campeón u hechizo, un segundo roll uniforme dentro de esa lista.
 */
export function rollFirstOutcome(
  champions: Champion[],
  spells: SummonerSpell[],
): FirstRollOutcome {
  const roll = randomInt(100);
  if (roll < BOUNCE_PROBABILITY_PERCENT) return { kind: "bounce" };
  if (roll < BOUNCE_PROBABILITY_PERCENT + SUPPORT_PROBABILITY_PERCENT) return { kind: "support" };
  if (roll < BOUNCE_PROBABILITY_PERCENT + SUPPORT_PROBABILITY_PERCENT + SPELL_PROBABILITY_PERCENT) {
    return { kind: "spell", ...rollSpellOutcome(spells) };
  }
  return { kind: "champion", champion: pickRandomChampion(champions) };
}

/**
 * Ruleta del castigo que rebota (segunda ruleta tras un "MANGO DEVUELTO"):
 * sin balde de rebote — un rebote no puede volver a rebotar, ver
 * /api/jugador/mangos/launch. Mismos % de Support (20%) y hechizo (60%) que
 * la primera ruleta, el resto (20%) para campeones — no se renormaliza por
 * simplicidad, mismo criterio que ya usaba esta función antes de agregar
 * hechizos (ver el comentario original: la intención de cada balde pesa lo
 * mismo en las dos ruletas, el campeón se queda con lo que sobra).
 */
export function rollPenaltyOutcome(
  champions: Champion[],
  spells: SummonerSpell[],
): PunishmentOutcome {
  const roll = randomInt(100);
  if (roll < SUPPORT_PROBABILITY_PERCENT) return { kind: "support" };
  if (roll < SUPPORT_PROBABILITY_PERCENT + SPELL_PROBABILITY_PERCENT) {
    return { kind: "spell", ...rollSpellOutcome(spells) };
  }
  return { kind: "champion", champion: pickRandomChampion(champions) };
}

/** Nombre/ícono para mostrar un castigo ya asignado (notificaciones, banner, ruleta) — resuelve Support, un hechizo (normal o "sin Flash"), o un campeón puntual. */
export function resolveAssignedPunishment(
  championAssigned: string | null,
  championById: Map<string, Champion>,
  spellById: Map<string, SummonerSpell>,
): { name: string; iconUrl: string | null; noFlash?: boolean } {
  if (championAssigned === SUPPORT_ASSIGNMENT) {
    return { name: "Support", iconUrl: SUPPORT_ICON_URL };
  }
  if (championAssigned === NO_FLASH_ASSIGNMENT) {
    // Muestra el ícono de Flash — el caller le superpone la X (CSS, ver
    // PunishmentIcon) para "prohibido", nunca un ícono nuevo.
    const flash = spellById.get(FLASH_SPELL_ID);
    return { name: "Sin Flash", iconUrl: flash?.iconUrl ?? null, noFlash: true };
  }
  if (!championAssigned) {
    return { name: "un campeón", iconUrl: null };
  }
  const spell = spellById.get(championAssigned);
  if (spell) {
    return { name: spell.name, iconUrl: spell.iconUrl };
  }
  const champion = championById.get(championAssigned);
  return { name: champion?.name ?? championAssigned, iconUrl: champion?.iconUrl ?? null };
}

export function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}
