"use client";

import { TierListContainer } from "./TierListContainer";
import { TierEmblem } from "./TierEmblem";
import type { RankTier, ShowcaseParticipant } from "@/types/database";

export function TierListRow({
  id,
  label,
  color,
  rankTier,
  items,
  participantsById,
}: {
  id: string;
  label: string;
  color: string;
  rankTier: RankTier;
  items: string[];
  participantsById: Map<string, ShowcaseParticipant>;
}) {
  return (
    <div className="flex overflow-hidden rounded-xl border border-border-hairline bg-surface">
      <div
        className="flex w-16 shrink-0 flex-col items-center justify-center gap-1 p-2 text-center sm:w-28"
        style={{
          backgroundColor: `${color}26`,
          borderRight: `2px solid ${color}55`,
        }}
      >
        <TierEmblem tier={rankTier} size={32} />
        <span
          className="font-display text-xs leading-tight font-bold tracking-wide uppercase sm:text-sm"
          style={{ color }}
        >
          {label}
        </span>
      </div>
      <TierListContainer
        id={id}
        items={items}
        participantsById={participantsById}
        className="bg-bg-elevated/40"
      />
    </div>
  );
}
