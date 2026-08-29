import { randomInt } from "node:crypto";
import type { Champion } from "@/lib/champions";
import type { SummonerSpell } from "@/lib/summoner-spells";

/** 10% de probabilidad de que la ruleta devuelva el mango (rebote) — mango normal, no caduco. Ver EXPIRED_BOUNCE_PROBABILITY_PERCENT para uno caduco. */
export const BOUNCE_PROBABILITY_PERCENT = 10;
/**
 * 30% de probabilidad de rebote para un mango CADUCO (ver
 * MANGO_EXPIRY_HOURS/isMangoExpired más abajo) — 3x el 10% normal, a
 * propósito: castiga "holdear" un mango sin lanzarlo. Solo cambia el
 * balde de rebote de la ruleta principal — el resto (Support/hechizo)
 * mantiene su % absoluto, así que el que se achica es el de campeón
 * puntual (ver rollFirstOutcome).
 */
export const EXPIRED_BOUNCE_PROBABILITY_PERCENT = 30;
/** 20% de probabilidad de que el castigo sea "jugar de Support" en vez de un campeón puntual. */
export const SUPPORT_PROBABILITY_PERCENT = 20;
/** 40% de probabilidad de que el castigo sea un hechizo de invocador obligatorio (o "sin Flash"), repartido entre las SPELL_POOL_SIZE opciones de abajo (no uniforme, ver SPELL_SLOT_WEIGHTS). */
export const SPELL_PROBABILITY_PERCENT = 40;
/**
 * El resto se reparte en partes iguales entre todos los campeones
 * individuales (pickRandomChampion ya es uniforme) — con un mango normal,
 * 30% en la ruleta principal (100 - BOUNCE - SUPPORT - SPELL) y 40% en la
 * ruleta de rebote (100 - SUPPORT - SPELL, sin balde de rebote); con un
 * mango caduco, el balde de campeón de la ruleta principal se achica a 10%
 * (100 - EXPIRED_BOUNCE - SUPPORT - SPELL) porque el rebote le come más
 * lugar — ver rollFirstOutcome y rollPenaltyOutcome más abajo.
 */

/** Cuántas horas puede estar un mango sin lanzarse antes de quedar "podrido" (ver isMangoExpired) — sube su chance de rebote y cambia de ícono en el inventario. */
export const MANGO_EXPIRY_HOURS = 24;

/**
 * Cuántos castigos puede tener un jugador ACTIVOS (penalty_progress en
 * 'pending') al mismo tiempo — mientras tenga MAX_ACTIVE_PENALTIES, no se
 * le puede lanzar uno más. Reemplaza al viejo límite "3 recibidos por día"
 * — ya no importa CUÁNDO los recibió, importa CUÁNTOS tiene sin resolver
 * ahora mismo. Sin relación con MAX_MANGO_INVENTORY (src/lib/quests.ts),
 * que es el cupo de mangos PROPIOS sin lanzar de cada jugador — mismo
 * número (3) de casualidad, conceptos distintos.
 */
export const MAX_ACTIVE_PENALTIES = 3;

/**
 * El cupo de MAX_ACTIVE_PENALTIES es sobre lo que a un jugador le PUEDEN
 * lanzar (ver el chequeo del objetivo en /api/jugador/mangos/launch) — no
 * bloquea que ÉL MISMO siga lanzando mangos aunque ya esté en el tope,
 * porque si su propio mango rebota (ver BOUNCE_PROBABILITY_PERCENT),
 * ese castigo es autoinfligido: la única excepción confirmada por el
 * usuario para terminar con MÁS de MAX_ACTIVE_PENALTIES castigos activos
 * es exactamente esa — un jugador con 3 que lanza y le rebota, sumando un
 * 4to. Pero esa excepción es de una sola vez, no una puerta abierta: un
 * jugador que ya está en 4+ (porque tuvo su propio rebote) queda
 * bloqueado para lanzar OTRO mango hasta volver a 3 o menos (cumpliendo
 * uno, o que lo perdonen) — sin este freno podría seguir lanzando y
 * acumulando un 5to, 6to castigo sin ningún límite. Se permite lanzar en
 * 0..MAX_ACTIVE_PENALTIES (incluido el propio tope, para que el rebote que
 * te suma el 4to pueda pasar) y se bloquea recién en MAX_ACTIVE_PENALTIES+1
 * en adelante.
 */
export function canLaunchMango(ownActivePenaltyCount: number): boolean {
  return ownActivePenaltyCount <= MAX_ACTIVE_PENALTIES;
}

/**
 * Horas de protección contra mangos nuevos que gana un jugador al cumplir
 * un castigo TENIENDO sus MAX_ACTIVE_PENALTIES activos a la vez (ver
 * processParticipantPenalties en /api/update-rankings) — nunca si tenía
 * menos de MAX_ACTIVE_PENALTIES pendientes. Se guarda en
 * participants.mango_protection_until.
 */
export const PROTECTION_HOURS = 5;

/**
 * "Anti-bullying": por cada puesto del ranking que el objetivo esté por
 * DEBAJO de quien lanza, +2% de probabilidad de rebote (ver
 * computeBullyingBonusPercent) — castiga "pegarle para abajo" a alguien
 * mucho peor rankeado. 0% si el objetivo está igual o mejor rankeado (nunca
 * penaliza lanzar "para arriba"), y 0% si no se puede determinar el rank de
 * alguno de los dos (todavía sin partidas ranked, ver fetchRankOrder en
 * src/lib/ranking.ts). Se suma (no reemplaza) al bounceProbabilityPercent
 * base — puede terminar sumando más del 100% entre las dos cosas, se
 * clampea a 100 en el caller (ver /api/jugador/mangos/launch). Con
 * diferencias de rank grandes, esto empieza a comerse por completo los
 * baldes de hechizo/campeón de rollFirstOutcome (no se renormalizan) — a
 * propósito: cuanto más "bullying", más domina el rebote sobre cualquier
 * otro resultado.
 */
export const BULLYING_BOUNCE_PERCENT_PER_RANK = 2;

/**
 * Bono de probabilidad de rebote (en puntos porcentuales, para sumarle al
 * bounceProbabilityPercent base) por lanzarle a alguien peor rankeado que
 * quien lanza. null en cualquiera de los dos ranks = no se puede evaluar
 * "quién está arriba de quién" todavía, 0 de bono (no penaliza ni premia).
 */
export function computeBullyingBonusPercent(
  launcherRank: number | null,
  targetRank: number | null,
): number {
  if (launcherRank === null || targetRank === null) return 0;
  return Math.max(0, (targetRank - launcherRank) * BULLYING_BOUNCE_PERCENT_PER_RANK);
}

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
 * llevar Flash" no sería un castigo real — el 9no slot del balde de
 * hechizos en cambio castiga con "JUGAR SIN FLASH" en la próxima partida.
 * Se guarda con este sentinel (mismo truco que SUPPORT_ASSIGNMENT) en vez
 * del id de Flash — así resolveAssignedPunishment/isCompliant lo
 * distinguen sin ambigüedad de "debes llevar Flash" (que no existe como
 * castigo).
 */
export const NO_FLASH_ASSIGNMENT = "NO_FLASH";

/** Los 8 hechizos normales + el caso especial "sin Flash" = 9 opciones dentro del balde de hechizos (SPELL_PROBABILITY_PERCENT) — no uniformes, ver SPELL_SLOT_WEIGHTS. */
export const SPELL_POOL_SIZE = MANDATORY_SPELL_IDS.length + 1;

/** Peso de cada hechizo "normal" dentro del balde — el resto son NORMAL_SPELL_WEIGHT salvo los boosteados (ver BOOSTED_SPELL_WEIGHT). */
const NORMAL_SPELL_WEIGHT = 10;
/** Hoz (Smite) y Sin Flash pesan un 30% más que un hechizo normal (10 * 1.3 = 13) — a pedido explícito, más chance que el resto del balde. */
const BOOSTED_SPELL_WEIGHT = 13;

/**
 * Un peso por cada uno de los SPELL_POOL_SIZE slots (mismo orden que
 * MANDATORY_SPELL_IDS + el slot final de "sin Flash") — "Hoz" (el último
 * de MANDATORY_SPELL_IDS) y "sin Flash" (el slot extra al final) pesan
 * BOOSTED_SPELL_WEIGHT, el resto NORMAL_SPELL_WEIGHT. Ver pickWeightedIndex.
 */
const SPELL_SLOT_WEIGHTS: number[] = MANDATORY_SPELL_IDS.map((id) =>
  id === "SummonerSmite" ? BOOSTED_SPELL_WEIGHT : NORMAL_SPELL_WEIGHT,
).concat(BOOSTED_SPELL_WEIGHT);

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
 * Elige un índice 0..weights.length-1 con probabilidad proporcional al
 * peso de cada uno (no uniforme) — un solo roll de 0 a la suma total de
 * pesos, restando pesos hasta encontrar en cuál "cae".
 */
export function pickWeightedIndex(weights: number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = randomInt(total);
  for (let i = 0; i < weights.length; i++) {
    if (roll < weights[i]) return i;
    roll -= weights[i];
  }
  // No debería llegar acá nunca (roll < total siempre cae en algún slot) —
  // solo por si weights viniera vacío o con pesos <= 0.
  throw new Error("pickWeightedIndex: pesos inválidos");
}

/**
 * Elige un hechizo del balde con pesos (ver SPELL_SLOT_WEIGHTS) — slot
 * 0..7 = uno de los MANDATORY_SPELL_IDS ("debes llevar X", "Hoz" con más
 * peso), slot 8 (el último) = el caso especial "sin Flash" (también con
 * más peso, ver NO_FLASH_ASSIGNMENT).
 */
function rollSpellOutcome(spells: SummonerSpell[]): SpellPunishmentOutcome {
  const slot = pickWeightedIndex(SPELL_SLOT_WEIGHTS);
  if (slot === MANDATORY_SPELL_IDS.length) return { noFlash: true };

  const spellId = MANDATORY_SPELL_IDS[slot];
  const spellById = new Map(spells.map((s) => [s.id, s]));
  const spell = spellById.get(spellId);
  if (!spell) throw new Error(`Hechizo ${spellId} no encontrado en el listado de Data Dragon`);
  return { noFlash: false, spell };
}

/**
 * Ruleta principal (lanzamiento a un objetivo): rebote (10% normal, 30% si
 * el mango está caduco — ver isMangoExpired, el caller decide cuál pasar),
 * 20% Support, 40% hechizo de invocador (pesado, ver SPELL_SLOT_WEIGHTS), y
 * el resto repartido uniforme entre todos los campeones — pickRandomChampion
 * ya reparte parejo, así que alcanza con un solo roll de 0-99 para decidir
 * el "balde" y, si toca campeón u hechizo, un segundo roll dentro de esa
 * lista.
 */
export function rollFirstOutcome(
  champions: Champion[],
  spells: SummonerSpell[],
  bounceProbabilityPercent: number = BOUNCE_PROBABILITY_PERCENT,
): FirstRollOutcome {
  const roll = randomInt(100);
  if (roll < bounceProbabilityPercent) return { kind: "bounce" };
  if (roll < bounceProbabilityPercent + SUPPORT_PROBABILITY_PERCENT) return { kind: "support" };
  if (
    roll <
    bounceProbabilityPercent + SUPPORT_PROBABILITY_PERCENT + SPELL_PROBABILITY_PERCENT
  ) {
    return { kind: "spell", ...rollSpellOutcome(spells) };
  }
  return { kind: "champion", champion: pickRandomChampion(champions) };
}

/**
 * Ruleta del castigo que rebota (segunda ruleta tras un "MANGO DEVUELTO"):
 * sin balde de rebote — un rebote no puede volver a rebotar, ver
 * /api/jugador/mangos/launch. Mismos % de Support (20%) y hechizo (40%) que
 * la primera ruleta con un mango normal, el resto (40%) para campeones — no
 * se renormaliza por simplicidad, mismo criterio que ya usaba esta función
 * antes de agregar hechizos (ver el comentario original: la intención de
 * cada balde pesa lo mismo en las dos ruletas, el campeón se queda con lo
 * que sobra).
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

/**
 * true si un mango lleva MANGO_EXPIRY_HOURS o más sin lanzarse desde que
 * entró al inventario (`mangos.inventory_since`) — "podrido": sube su
 * chance de rebote (ver EXPIRED_BOUNCE_PROBABILITY_PERCENT) y cambia de
 * ícono en /jugador (MangoPodrido/MangoPodridoFurioso en vez de
 * MangoHappy/MangoAngry, ver InventoryPanel.tsx).
 */
export function isMangoExpired(inventorySince: string, now: Date = new Date()): boolean {
  const ageMs = now.getTime() - new Date(inventorySince).getTime();
  return ageMs >= MANGO_EXPIRY_HOURS * 60 * 60 * 1000;
}

/** Cuándo se pudre este mango si nadie lo lanza antes — inventory_since + MANGO_EXPIRY_HOURS, para mostrar la cuenta regresiva en el inventario (ver InventoryPanel.tsx). */
export function mangoExpiresAt(inventorySince: string): string {
  return new Date(
    new Date(inventorySince).getTime() + MANGO_EXPIRY_HOURS * 60 * 60 * 1000,
  ).toISOString();
}

export function hoursFromNowIso(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}
