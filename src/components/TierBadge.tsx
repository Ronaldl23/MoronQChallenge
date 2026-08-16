import { TIER_COLOR, TIER_LABEL } from "@/lib/tiers";
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
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-display text-xs font-semibold tracking-wide whitespace-nowrap"
      style={{
        color,
        borderColor: `${color}55`,
        backgroundColor: `${color}14`,
      }}
    >
      {TIER_LABEL[tier]}
      {division && <span className="text-text-muted">{division}</span>}
    </span>
  );
}
