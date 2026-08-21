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
        Ícono y label lado a lado (no apilados) — con 8 filas hay que
        entrar en la altura de una sola pantalla sin scroll, y horizontal
        gasta mucha menos altura por fila que un ícono grande arriba del
        texto. El emblema es un <img> de tamaño fijo (no se achica solo en
        mobile), así que la columna tiene un ancho fijo que le entra
        cómodo en cualquier viewport.
      */}
      <div
        className="flex w-64 shrink-0 items-center gap-3 px-4 py-3"
        style={{
          backgroundColor: `${color}26`,
          borderRight: `2px solid ${color}55`,
        }}
      >
        <TierEmblem tier={rankTier} size={60} />
        <span
          className="font-display text-xl leading-tight font-bold tracking-wide uppercase"
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
