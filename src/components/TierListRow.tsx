"use client";

import { TierListContainer } from "./TierListContainer";
import type { ShowcaseParticipant } from "@/types/database";

export function TierListRow({
  id,
  label,
  color,
  items,
  participantsById,
}: {
  id: string;
  label: string;
  color: string;
  items: string[];
  participantsById: Map<string, ShowcaseParticipant>;
}) {
  return (
    <div className="flex overflow-hidden rounded-xl border border-border-hairline bg-surface">
      <div
        className="flex w-16 shrink-0 items-center justify-center p-2 text-center font-display text-xs leading-tight font-bold tracking-wide uppercase sm:w-28 sm:text-sm"
        style={{
          backgroundColor: `${color}26`,
          color,
          borderRight: `2px solid ${color}55`,
        }}
      >
        {label}
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
