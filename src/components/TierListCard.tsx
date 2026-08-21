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
      // Horizontal (avatar + nombre en una sola línea) y no apilado: una
      // ficha vertical con foto grande obliga a cada fila a crecer mucho más
      // apenas recibe UNA ficha, lo que en /tierlist puede romper el "8
      // filas sin scroll" (las filas de más abajo terminan fuera del
      // viewport, y eso dispara el auto-scroll de dnd-kit a mitad de un
      // drag, haciendo fallar el soltado). El avatar (80px) crece bastante
      // más que el resto de la ficha a propósito — es lo que hay que poder
      // reconocer de un vistazo, el nombre es secundario.
      className={`flex w-44 shrink-0 touch-none items-center gap-2.5 rounded-lg border border-border-hairline bg-surface px-3 py-2.5 text-left select-none ${
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
        size={80}
      />
      <span className="line-clamp-1 min-w-0 flex-1 text-base font-medium text-text-primary">
        {participant.nombre}
      </span>
    </div>
  );
}
