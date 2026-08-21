"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { TierListCard } from "./TierListCard";
import type { ShowcaseParticipant } from "@/types/database";

/**
 * Una zona donde soltar participantes — una fila de tier, o el panel de "sin
 * asignar". useDroppable registra el contenedor en sí (para poder soltar en
 * el espacio vacío, no solo encima de otra ficha) y SortableContext adentro
 * habilita reordenar/arrastrar las fichas que ya viven acá.
 */
export function TierListContainer({
  id,
  items,
  participantsById,
  className = "",
  emptyHint,
}: {
  id: string;
  items: string[];
  participantsById: Map<string, ShowcaseParticipant>;
  className?: string;
  emptyHint?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[56px] flex-1 flex-wrap items-center gap-2 rounded-lg p-1.5 transition-colors ${
        isOver ? "bg-gold/10" : ""
      } ${className}`}
    >
      <SortableContext id={id} items={items} strategy={rectSortingStrategy}>
        {items.map((participantId) => {
          const participant = participantsById.get(participantId);
          if (!participant) return null;
          return <TierListCard key={participantId} participant={participant} />;
        })}
      </SortableContext>
      {items.length === 0 && emptyHint && (
        <p className="pointer-events-none px-2 text-xs text-text-muted italic">
          {emptyHint}
        </p>
      )}
    </div>
  );
}
