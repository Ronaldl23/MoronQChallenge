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
  compact = false,
}: {
  participant: ShowcaseParticipant;
  /** true en la copia que vive dentro de DragOverlay — sin listeners propios, solo estilo "levantada". */
  dragging?: boolean;
  /**
   * true en el panel "Sin asignar": grilla densa (foto arriba, nombre abajo,
   * chica) para que entren muchos participantes visibles a la vez y sea
   * fácil encontrar a quién arrastrar — calca la estructura de referencia
   * que pasó el usuario. Las filas de tier siguen usando la ficha horizontal
   * (foto + nombre en una línea), pensada para una sola ficha por vez.
   */
  compact?: boolean;
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

  const stateClassName = dragging
    ? "rotate-3 scale-105 cursor-grabbing shadow-2xl"
    : isDragging
      ? "opacity-30"
      : "cursor-grab shadow-sm hover:border-gold/40 hover:bg-surface-hover";

  if (compact) {
    return (
      <div
        ref={dragging ? undefined : setNodeRef}
        style={style}
        {...(dragging ? {} : attributes)}
        {...(dragging ? {} : listeners)}
        className={`flex w-[72px] shrink-0 touch-none flex-col items-center gap-1 rounded-lg border border-border-hairline bg-surface p-1.5 text-center select-none ${stateClassName}`}
      >
        <ShowcasePhoto
          name={participant.nombre}
          photoUrl={participant.photo_url}
          size={48}
        />
        <span className="line-clamp-1 w-full text-[10px] font-medium text-text-primary">
          {participant.nombre}
        </span>
      </div>
    );
  }

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
      // drag, haciendo fallar el soltado). w-56 (224px) hacía que con el
      // drop-zone actual (~450px) entrara UNA sola ficha por línea — se
      // veían "apiladas" en columna aunque el contenedor ya usaba
      // flex-wrap, porque cada ficha por sí sola ocupaba casi todo el
      // ancho. w-40 deja entrar 2-3 por línea antes de wrappear.
      className={`flex w-40 shrink-0 touch-none items-center gap-2 rounded-lg border border-border-hairline bg-surface px-2 py-2 text-left select-none ${stateClassName}`}
    >
      <ShowcasePhoto
        name={participant.nombre}
        photoUrl={participant.photo_url}
        size={40}
      />
      <span className="line-clamp-1 min-w-0 flex-1 text-base font-medium text-text-primary">
        {participant.nombre}
      </span>
    </div>
  );
}
