"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ShowcasePhoto } from "./ShowcasePhoto";
import type { ShowcaseParticipant } from "@/types/database";

/**
 * Ficha arrastrable de un participante — se usa tal cual adentro de cada
 * fila/panel (con useSortable, sigue al puntero mientras se arrastra propio)
 * y como render "congelado" dentro del DragOverlay de TierListBoard (esa
 * copia no necesita useSortable: solo se ve, no reacciona a nada).
 */
export function TierListCard({
  participant,
  dragging = false,
}: {
  participant: ShowcaseParticipant;
  /** true en la copia que vive dentro de DragOverlay — sin listeners propios, solo estilo "levantada". */
  dragging?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: participant.id,
    disabled: dragging,
  });

  const style = dragging
    ? undefined
    : {
        transform: CSS.Transform.toString(transform),
        transition,
      };

  return (
    <div
      ref={dragging ? undefined : setNodeRef}
      style={style}
      {...(dragging ? {} : attributes)}
      {...(dragging ? {} : listeners)}
      className={`flex w-20 shrink-0 touch-none flex-col items-center gap-1 rounded-lg border border-border-hairline bg-surface p-2 text-center select-none ${
        dragging
          ? "rotate-3 scale-105 cursor-grabbing shadow-2xl"
          : isDragging
            ? "opacity-30"
            : "cursor-grab shadow-sm hover:border-gold/40 hover:bg-surface-hover"
      }`}
    >
      <ShowcasePhoto
        name={participant.nombre}
        photoUrl={participant.photo_url}
        size={48}
      />
      <span className="w-full truncate text-[11px] font-medium text-text-primary">
        {participant.nombre}
      </span>
    </div>
  );
}
