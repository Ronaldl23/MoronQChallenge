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
    <div className="flex flex-col overflow-hidden rounded-xl border border-border-hairline bg-surface sm:flex-row">
      {/*
        Ícono y label lado a lado en desktop (sm:flex-row) — con 8 filas hay
        que entrar en la altura de una sola pantalla sin scroll, y horizontal
        gasta mucha menos altura por fila que un ícono grande arriba del
        texto. En mobile en cambio SE APILA (flex-col por default, el emblema
        ahora es grande — 120px — y una columna fija de ese ancho no entra
        cómoda en un viewport angosto: dejaba casi sin espacio la drop-zone,
        y una ficha soltada ahí terminaba cortada fuera de pantalla). Mobile
        no tenía el requisito de "sin scroll" que sí tiene desktop, así que
        apilar acá es gratis.
      */}
      <div
        className="flex shrink-0 items-center gap-1.5 border-b-2 px-2 py-1 sm:w-64 sm:border-r-2 sm:border-b-0"
        style={{
          backgroundColor: `${color}26`,
          borderColor: `${color}55`,
        }}
      >
        <TierEmblem tier={rankTier} size={136} />
        <span
          className="font-display text-lg leading-tight font-bold tracking-wide uppercase"
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
