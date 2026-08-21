import type { RankDivision, RankTier } from "@/types/database";

/**
 * Base score per tier, in ascending rank order. Master/Grandmaster/
 * Challenger share a base since they're differentiated by LP alone
 * (no divisions at those tiers).
 */
const TIER_BASE: Record<RankTier, number> = {
  IRON: 0,
  BRONZE: 400,
  SILVER: 800,
  GOLD: 1200,
  PLATINUM: 1600,
  EMERALD: 2000,
  DIAMOND: 2400,
  MASTER: 2800,
  GRANDMASTER: 2800,
  CHALLENGER: 2800,
};

/** Divisions only exist below Master. IV is the lowest, I the highest. */
const DIVISION_OFFSET: Record<RankDivision, number> = {
  IV: 0,
  III: 100,
  II: 200,
  I: 300,
};

const APEX_TIERS = new Set<RankTier>(["MASTER", "GRANDMASTER", "CHALLENGER"]);

export interface EloScoreInput {
  tier: RankTier;
  division: RankDivision | null;
  lp: number;
}

/**
 * elo_score = tier_base + division_offset + lp
 *
 * - tier_base grows in steps of 400 (IRON=0 ... DIAMOND=2400, Master+=2800).
 * - division_offset grows in steps of 100 within a tier (IV=0 ... I=300),
 *   and is 0 for Master+ (no divisions there).
 * - lp is added as-is, so it breaks ties within the same tier/division and
 *   also drives ranking among Master/Grandmaster/Challenger.
 */
export function calculateEloScore({ tier, division, lp }: EloScoreInput): number {
  const tierBase = TIER_BASE[tier];
  const divisionOffset = APEX_TIERS.has(tier) || !division ? 0 : DIVISION_OFFSET[division];

  return tierBase + divisionOffset + lp;
}

/**
 * Orden ascendente de tier, IRON a CHALLENGER — a diferencia de TIER_BASE
 * (pensado para el elo_score del leaderboard, que mezcla LP), acá
 * Master/Grandmaster/Challenger SÍ quedan en escalones distintos: el LP se
 * resetea al ascender de tier, así que comparar elo_score en ese límite
 * puede dar un score más bajo justo después de un ascenso real (ver
 * rankOrdinal más abajo, que evita ese caso).
 */
const RANK_TIER_ORDER: RankTier[] = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
];

const DIVISION_ORDINAL: Record<RankDivision, number> = {
  IV: 0,
  III: 1,
  II: 2,
  I: 3,
};

/**
 * Posición ordinal de (tier, división) en la escala completa de rango, sin
 * LP — pensado para detectar ascenso/descenso de tier/división (chat
 * "Fase B"), donde lo único que importa es si la posición subió o bajó,
 * nunca la variación de LP dentro del mismo tier/división.
 */
export function rankOrdinal(tier: RankTier, division: RankDivision | null): number {
  const tierIndex = RANK_TIER_ORDER.indexOf(tier);
  const divisionIndex = division ? DIVISION_ORDINAL[division] : 0;
  return tierIndex * 4 + divisionIndex;
}
