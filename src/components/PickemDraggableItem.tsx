"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ShowcasePhoto } from "./ShowcasePhoto";
import type { ShowcaseParticipant } from "@/types/database";

/** Fila arrastrable de PickemBoard — igual estructura visual que PickemOrderedList, pero interactiva (useSortable) y con un ícono de "agarre" para dejar claro que se puede reordenar. */
export function PickemDraggableItem({
  rank,
  participant,
  dragging = false,
}: {
  rank: number;
  participant: ShowcaseParticipant;
  dragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: participant.id,
    disabled: dragging,
  });

  const style = dragging
    ? undefined
    : { transform: CSS.Transform.toString(transform), transition };

  const stateClassName = dragging
    ? "rotate-1 scale-105 cursor-grabbing shadow-2xl"
    : isDragging
      ? "opacity-30"
      : "cursor-grab shadow-sm hover:border-gold/40 hover:bg-surface-hover";

  return (
    <div
      ref={dragging ? undefined : setNodeRef}
      style={style}
      {...(dragging ? {} : attributes)}
      {...(dragging ? {} : listeners)}
      className={`flex touch-none items-center gap-3 rounded-lg border border-border-hairline bg-surface px-3 py-2 select-none ${stateClassName}`}
    >
      <span className="w-6 shrink-0 text-right font-display text-sm font-bold text-text-muted">
        {rank}
      </span>
      <ShowcasePhoto name={participant.nombre} photoUrl={participant.photo_url} size={32} />
      <span className="line-clamp-1 min-w-0 flex-1 text-sm font-medium text-text-primary">
        {participant.nombre}
      </span>
      <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-text-muted" fill="currentColor" aria-hidden>
        <circle cx="7" cy="5" r="1.3" />
        <circle cx="13" cy="5" r="1.3" />
        <circle cx="7" cy="10" r="1.3" />
        <circle cx="13" cy="10" r="1.3" />
        <circle cx="7" cy="15" r="1.3" />
        <circle cx="13" cy="15" r="1.3" />
      </svg>
    </div>
  );
}
