import type { QuestType } from "@/types/database";

/**
 * Lógica pura del motor de misiones — sin Riot ni Supabase acá a propósito,
 * para poder testearla con secuencias de partidas simuladas (ver
 * scripts/test-quests.mjs) sin depender de red ni base de datos.
 */

export const QUEST_TARGETS: Record<QuestType, number> = {
  win_streak: 5,
  kda_streak: 5,
  /** No es racha — target=1: se otorga en la partida misma que la cumple. */
  deathless_win: 1,
};

export const KDA_STREAK_THRESHOLD = 4;
export const MAX_MANGO_INVENTORY = 3;

/** Todas las quests conocidas, en el orden en que se evalúan por partida (no afecta el resultado, solo el orden de los grants cuando varias se completan en la misma partida). */
export const QUEST_TYPES = Object.keys(QUEST_TARGETS) as QuestType[];

export interface MatchOutcome {
  matchId: string;
  win: boolean;
  /** (kills + assists) / max(deaths, 1) — ya calculado por el caller. */
  kda: number;
  /** Muertes crudas — deathless_win necesita el 0 exacto, no alcanza con "KDA alto" (calculateKda ya clampea deaths a 1 como mínimo, perdiendo la distinción 0 vs 1). */
  deaths: number;
}

/** Criterio "esta partida cuenta para la racha/objetivo" de cada quest. */
const QUEST_CRITERIA: Record<QuestType, (match: MatchOutcome) => boolean> = {
  win_streak: (match) => match.win,
  kda_streak: (match) => match.kda >= KDA_STREAK_THRESHOLD,
  deathless_win: (match) => match.win && match.deaths === 0,
};

export type QuestProgressState = Record<QuestType, number>;

export interface MangoGrantEvent {
  /** null cuando el otorgamiento corresponde a una racha que ya estaba completa de una corrida anterior (esperando cupo), no a una partida de esta corrida. */
  matchId: string | null;
  quest_type: QuestType;
}

export interface ProcessMatchesResult {
  progress: QuestProgressState;
  grants: MangoGrantEvent[];
  /** Cantidad de mangos en inventario al final (para persistir/verificar, no para insertar). */
  mangoCount: number;
  /** Id de la última partida de la lista recibida, o null si no había ninguna nueva. */
  lastProcessedMatchId: string | null;
}

/**
 * Procesa, en orden cronológico (más vieja primero), las partidas nuevas de
 * un participante y devuelve el progreso final de todas las quests + qué
 * mangos se ganaron. No toca Supabase — el caller es responsable de
 * persistir `progress`/`lastProcessedMatchId` en quest_progress y de
 * insertar una fila en `mangos` por cada evento en `grants`.
 *
 * Reglas (confirmadas por el usuario):
 * - win_streak: partidas ranked solo/duo ganadas seguidas: target consecutivas
 *   sin cortes -> mango. Una derrota en el medio vuelve el contador a 0.
 * - kda_streak: mismo criterio pero con KDA >= KDA_STREAK_THRESHOLD.
 * - deathless_win: UNA sola partida ganada con 0 muertes (target=1) — no es
 *   racha, se otorga en la partida misma que la cumple.
 * - Al completar una quest (progress === target), se otorga un Mango
 *   (siempre que haya cupo) y el progreso de ESA quest vuelve a 0.
 * - Cupo máximo de MAX_MANGO_INVENTORY mangos 'in_inventory' simultáneos: si
 *   ya está lleno, NO se otorga el mango, pero el progreso tampoco se
 *   resetea — se queda pegado en el target ("esperando a que tenga espacio")
 *   hasta que en una corrida futura haya cupo libre.
 */
export function processNewMatches({
  progress,
  matches,
  mangoCount: initialMangoCount,
  maxMangoInventory = MAX_MANGO_INVENTORY,
}: {
  progress: QuestProgressState;
  /** Solo las partidas NUEVAS (no vistas todavía), de la más vieja a la más nueva. */
  matches: MatchOutcome[];
  /** Cuántos mangos 'in_inventory' tiene el participante al arrancar esta corrida. */
  mangoCount: number;
  maxMangoInventory?: number;
}): ProcessMatchesResult {
  const current: QuestProgressState = { ...progress };
  let mangoCount = initialMangoCount;
  const grants: MangoGrantEvent[] = [];
  let lastProcessedMatchId: string | null = null;

  function tryGrant(questType: QuestType, matchId: string | null) {
    if (current[questType] >= QUEST_TARGETS[questType] && mangoCount < maxMangoInventory) {
      grants.push({ matchId, quest_type: questType });
      mangoCount += 1;
      current[questType] = 0;
    }
  }

  // Progreso que ya estaba completo desde una corrida anterior pero sin
  // cupo en ese momento (ver comentario de arriba): reintentar antes de
  // procesar partidas nuevas, por si ahora hay espacio libre.
  for (const questType of QUEST_TYPES) tryGrant(questType, null);

  for (const match of matches) {
    lastProcessedMatchId = match.matchId;

    for (const questType of QUEST_TYPES) {
      // Si ya está en el target esperando cupo (mangoCount lleno), no se
      // vuelve a tocar por esta partida — ni sube más allá del target, ni se
      // resetea por no cumplir: la racha ya se cumplió, solo falta el cupo.
      if (current[questType] < QUEST_TARGETS[questType]) {
        current[questType] = QUEST_CRITERIA[questType](match) ? current[questType] + 1 : 0;
      }
      tryGrant(questType, match.matchId);
    }
  }

  return {
    progress: current,
    grants,
    mangoCount,
    lastProcessedMatchId,
  };
}

export function calculateKda({
  kills,
  deaths,
  assists,
}: {
  kills: number;
  deaths: number;
  assists: number;
}): number {
  return (kills + assists) / Math.max(deaths, 1);
}
