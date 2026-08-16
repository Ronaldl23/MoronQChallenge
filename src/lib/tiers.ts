import type { RankTier } from "@/types/database";

export const TIER_LABEL: Record<RankTier, string> = {
  IRON: "Hierro",
  BRONZE: "Bronce",
  SILVER: "Plata",
  GOLD: "Oro",
  PLATINUM: "Platino",
  EMERALD: "Esmeralda",
  DIAMOND: "Diamante",
  MASTER: "Maestro",
  GRANDMASTER: "Gran Maestro",
  CHALLENGER: "Retador",
};

export const TIER_COLOR: Record<RankTier, string> = {
  IRON: "#8a8078",
  BRONZE: "#a97648",
  SILVER: "#a9b4bd",
  GOLD: "#d9a441",
  PLATINUM: "#3fb8a3",
  EMERALD: "#34c77b",
  DIAMOND: "#4f8ef7",
  MASTER: "#c15fe0",
  GRANDMASTER: "#e0455f",
  CHALLENGER: "#ef4d94",
};
