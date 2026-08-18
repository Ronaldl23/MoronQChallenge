"use client";

import { useEffect, useRef, useState } from "react";

export interface RouletteItem {
  key: string;
  label: string;
  iconUrl: string;
  /** Estilo distinto (usado para el marcador de "MANGO DEVUELTO"). */
  special?: boolean;
}

const ITEM_WIDTH = 96;
const VISIBLE_ITEMS = 5;
const REEL_LENGTH = 50;
/** Deja colchón de items después del resultado para que no se vea el final del reel al frenar. */
const TARGET_INDEX = 44;

function buildReel(pool: RouletteItem[], result: RouletteItem): RouletteItem[] {
  const reel: RouletteItem[] = [];
  for (let i = 0; i < REEL_LENGTH; i++) {
    reel.push(i === TARGET_INDEX ? result : pool[Math.floor(Math.random() * pool.length)]);
  }
  return reel;
}

/**
 * Ruleta tipo "case opening": una franja horizontal larga que gira y frena
 * exactamente en `result` — el azar YA pasó en el servidor (ver
 * /api/jugador/mangos/launch), esto es puro reveal visual.
 *
 * El caller es responsable de montar una instancia NUEVA por cada giro
 * (`<RouletteStrip key={spinToken} .../>`) — así el reset de estado entre
 * giros pasa solo, por remount, en vez de un setState sincrónico dentro de
 * un efecto (evita renders en cascada).
 */
export function RouletteStrip({
  pool,
  result,
  onSettle,
}: {
  pool: RouletteItem[];
  result: RouletteItem;
  onSettle?: () => void;
}) {
  const [reel] = useState<RouletteItem[]>(() => buildReel(pool, result));
  const [offset, setOffset] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const settled = useRef(false);

  useEffect(() => {
    const viewportWidth = VISIBLE_ITEMS * ITEM_WIDTH;
    const target = TARGET_INDEX * ITEM_WIDTH + ITEM_WIDTH / 2 - viewportWidth / 2;

    // Dos rAF: el primero deja pintado offset=0 sin transición, el segundo
    // recién prende la transición y mueve el offset — si no, el navegador
    // a veces colapsa ambos cambios en un solo frame y no anima nada.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setTransitioning(true);
        setOffset(target);
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-border-hairline bg-bg-elevated"
      style={{ width: VISIBLE_ITEMS * ITEM_WIDTH }}
    >
      <div
        className="flex"
        style={{
          transform: `translateX(-${offset}px)`,
          transition: transitioning ? "transform 4.5s cubic-bezier(0.1, 0.7, 0.15, 1)" : "none",
        }}
        onTransitionEnd={() => {
          if (settled.current) return;
          settled.current = true;
          onSettle?.();
        }}
      >
        {reel.map((item, i) => (
          <div
            key={`${item.key}-${i}`}
            className="flex shrink-0 flex-col items-center justify-center gap-1 py-3"
            style={{ width: ITEM_WIDTH }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- CDN externo (Data Dragon) o asset local, lista dinámica */}
            <img
              src={item.iconUrl}
              alt=""
              width={56}
              height={56}
              className={`h-14 w-14 rounded-lg object-cover ${
                item.special ? "ring-2 ring-loss" : "ring-1 ring-border-hairline"
              }`}
            />
            <span className="max-w-[88px] truncate text-center text-[10px] text-text-secondary">
              {item.label}
            </span>
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-gold shadow-[0_0_8px_var(--gold)]" />
    </div>
  );
}
