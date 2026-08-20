"use client";

import { useEffect, useState } from "react";
import { ShowcasePhoto } from "./ShowcasePhoto";
import type { ShowcaseParticipant } from "@/types/database";

interface Density {
  minTile: number;
  avatar: number;
  gap: string;
  padding: string;
  text: string;
}

/**
 * Grilla de tarjetas + preview de foto. Click (no hover: no existe en
 * touch, y así el disparador es el mismo en desktop y mobile) abre un
 * modal centrado con la foto ampliada — se cierra con click/tap afuera,
 * Escape, o el botón X.
 */
export function ParticipantsGrid({
  participants,
  density,
}: {
  participants: ShowcaseParticipant[];
  density: Density;
}) {
  const [selected, setSelected] = useState<ShowcaseParticipant | null>(null);
  // 1.5x el tamaño real de la miniatura en la tarjeta (density.avatar), no
  // un tamaño fijo — así el preview escala junto con la densidad de la
  // grilla (más chico en la vista densa de 30 participantes, más grande en
  // la de pocos participantes).
  const previewSize = Math.round(density.avatar * 1.5);

  useEffect(() => {
    if (!selected) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selected]);

  return (
    <>
      <div
        className={`mt-6 grid ${density.gap}`}
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${density.minTile}px, 1fr))`,
        }}
      >
        {participants.map((participant) => (
          <button
            key={participant.id}
            type="button"
            onClick={() => setSelected(participant)}
            className={`flex flex-col items-center gap-2 rounded-xl border border-border-hairline bg-surface text-center transition-colors hover:border-gold/40 hover:bg-surface-hover ${density.padding}`}
          >
            <ShowcasePhoto
              name={participant.nombre}
              photoUrl={participant.photo_url}
              size={density.avatar}
            />
            <span
              className={`w-full truncate font-medium text-text-primary ${density.text}`}
            >
              {participant.nombre}
            </span>
          </button>
        ))}
      </div>

      {selected && (
        // El backdrop cierra al click/tap afuera; stopPropagation en la
        // tarjeta de adentro evita que un click sobre la foto/nombre burbujee
        // y se auto-cierre.
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="relative flex flex-col items-center gap-4 rounded-2xl border border-border-hairline bg-surface p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Cerrar"
              className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-white/10 hover:text-text-primary"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <path d="M4.293 4.293a1 1 0 0 1 1.414 0L10 8.586l4.293-4.293a1 1 0 1 1 1.414 1.414L11.414 10l4.293 4.293a1 1 0 0 1-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 0 1-1.414-1.414L8.586 10 4.293 5.707a1 1 0 0 1 0-1.414Z" />
              </svg>
            </button>
            <ShowcasePhoto
              name={selected.nombre}
              photoUrl={selected.photo_url}
              size={previewSize}
            />
            <p className="font-display text-lg font-semibold text-text-primary">
              {selected.nombre}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
