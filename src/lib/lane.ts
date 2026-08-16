export type MainRole = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";

export const MAIN_ROLES: MainRole[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

export const MAIN_ROLE_LABEL: Record<MainRole, string> = {
  TOP: "Top",
  JUNGLE: "Jungla",
  MIDDLE: "Mid",
  BOTTOM: "ADC/Bot",
  UTILITY: "Support",
};

/**
 * Mismo mapeo que usa Riot para teamPosition en match-v5 (línea jugada en
 * cada partida) y para main_role (línea main fija del participante) — el
 * slug es el que espera la URL de íconos de Community Dragon.
 */
export const ROLE_TO_LANE_SLUG: Record<MainRole, string> = {
  TOP: "top",
  JUNGLE: "jungle",
  MIDDLE: "middle",
  BOTTOM: "bottom",
  UTILITY: "utility",
};
