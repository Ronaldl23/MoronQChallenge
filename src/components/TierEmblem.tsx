"use client";

import { useState } from "react";
import type { RankTier } from "@/types/database";

const EMBLEM_SLUG: Record<RankTier, string> = {
  IRON: "iron",
  BRONZE: "bronze",
  SILVER: "silver",
  GOLD: "gold",
  PLATINUM: "platinum",
  EMERALD: "emerald",
  DIAMOND: "diamond",
  MASTER: "master",
  GRANDMASTER: "grandmaster",
  CHALLENGER: "challenger",
};

/**
 * Emblema oficial del rango, servido desde Community Dragon (CDN comunitario
 * de assets de Riot, sin auth). Si la URL no resuelve por el motivo que sea,
 * simplemente no se renderiza nada — el texto del tier en TierBadge nunca
 * depende de este ícono para tener sentido.
 */
export function TierEmblem({ tier, size = 16 }: { tier: RankTier; size?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- CDN externo (Community Dragon), necesita onError
    <img
      src={`https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/ranked-emblems/emblem-${EMBLEM_SLUG[tier]}.png`}
      alt=""
      width={size}
      height={size}
      className="shrink-0"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
