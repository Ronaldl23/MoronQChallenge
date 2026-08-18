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

const SPIN_SOUND_SRC = "/RuletaGiro.mp3";
/** Por si el archivo de audio no carga (red, 404) — la animación no se cuelga esperando una duración que nunca llega. */
const FALLBACK_SPIN_DURATION_MS = 4500;
/** El audio es siempre el mismo archivo: se mide la duración una sola vez por sesión de página, no en cada giro. */
let cachedSpinDurationMs: number | null = null;

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
  const [spinDurationMs, setSpinDurationMs] = useState(
    cachedSpinDurationMs ?? FALLBACK_SPIN_DURATION_MS,
  );
  const settled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let raf1 = 0;
    let raf2 = 0;
    const audio = new Audio(SPIN_SOUND_SRC);

    function beginSpin(durationMs: number) {
      if (cancelled) return;
      setSpinDurationMs(durationMs);
      audio.play().catch(() => {});

      const viewportWidth = VISIBLE_ITEMS * ITEM_WIDTH;
      const target = TARGET_INDEX * ITEM_WIDTH + ITEM_WIDTH / 2 - viewportWidth / 2;

      // Dos rAF: el primero deja pintado offset=0 sin transición, el segundo
      // recién prende la transición y mueve el offset — si no, el navegador
      // a veces colapsa ambos cambios en un solo frame y no anima nada.
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          if (cancelled) return;
          setTransitioning(true);
          setOffset(target);
        });
      });
    }

    if (cachedSpinDurationMs != null) {
      beginSpin(cachedSpinDurationMs);
    } else {
      // Todavía no se conoce la duración real del audio (primera vez en esta
      // sesión de página) — se espera a que el navegador la sepa (metadata)
      // para arrancar la animación ya sincronizada, en vez de arrancar con
      // el fallback y tener que reajustar la transición a mitad de camino.
      audio.addEventListener(
        "loadedmetadata",
        () => {
          const durationMs =
            Number.isFinite(audio.duration) && audio.duration > 0
              ? audio.duration * 1000
              : FALLBACK_SPIN_DURATION_MS;
          cachedSpinDurationMs = durationMs;
          beginSpin(durationMs);
        },
        { once: true },
      );
      audio.addEventListener(
        "error",
        () => {
          cachedSpinDurationMs = FALLBACK_SPIN_DURATION_MS;
          beginSpin(FALLBACK_SPIN_DURATION_MS);
        },
        { once: true },
      );
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      audio.pause();
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
          transition: transitioning
            ? `transform ${spinDurationMs}ms cubic-bezier(0.1, 0.7, 0.15, 1)`
            : "none",
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
