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
      {/*
        El emblema es un <img> de tamaño fijo (no se achica solo en mobile,
        a diferencia del resto del layout que sí es responsive) — la
        columna tiene que ser lo bastante ancha para 160px + padding en
        CUALQUIER viewport, así que va un solo ancho fijo en vez del
        w-16 sm:w-28 de antes.
      */}
      <div
        className="flex w-48 shrink-0 flex-col items-center justify-center gap-1.5 p-3 text-center"
        style={{
          backgroundColor: `${color}26`,
          borderRight: `2px solid ${color}55`,
        }}
      >
        <TierEmblem tier={rankTier} size={160} />
        <span
          className="font-display text-sm leading-tight font-bold tracking-wide uppercase"
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
