import { TIER_COLOR, TIER_LABEL } from "@/lib/tiers";
import { TierEmblem } from "./TierEmblem";
import type { RankDivision, RankTier } from "@/types/database";

export function TierBadge({
  tier,
  division,
}: {
  tier: RankTier;
  division: RankDivision | null;
}) {
  const color = TIER_COLOR[tier];

  return (
    <span
      className="inline-flex items-center gap-3 rounded-xl border px-3 py-2 font-display text-xs font-semibold tracking-wide whitespace-nowrap"
      style={{
        color,
        borderColor: `${color}55`,
        backgroundColor: `${color}14`,
      }}
    >
      <TierEmblem tier={tier} size={80} />
      {TIER_LABEL[tier]}
      {division && <span className="text-text-muted">{division}</span>}
    </span>
  );
}
