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
      className="inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 font-display text-xs font-semibold tracking-wide whitespace-nowrap"
      style={{
        color,
        borderColor: `${color}55`,
        backgroundColor: `${color}14`,
      }}
    >
      <TierEmblem tier={tier} size={48} />
      {TIER_LABEL[tier]}
      {division && <span className="text-text-muted">{division}</span>}
    </span>
  );
}
