"use client";

import { useEffect, useRef, useState } from "react";
import { PunishmentIcon } from "./PunishmentIcon";

export interface RouletteItem {
  key: string;
  label: string;
  iconUrl: string;
  /** Estilo distinto para marcadores especiales — "bounce" (MANGO DEVUELTO), "support" (castigo Support) y "spell" (hechizo de invocador obligatorio, incluido "sin Flash"). */
  variant?: "bounce" | "support" | "spell";
  /** true en el ítem "sin Flash" — superpone una X en CSS sobre el ícono de Flash (ver PunishmentIcon), nunca un ícono nuevo. */
  noFlash?: boolean;
}

const VARIANT_RING: Record<NonNullable<RouletteItem["variant"]>, string> = {
  bounce: "ring-2 ring-loss",
  support: "ring-2 ring-gold",
  spell: "ring-2 ring-live",
};

const ITEM_WIDTH = 96;
const VISIBLE_ITEMS = 5;
const REEL_LENGTH = 50;
/** Deja colchón de items después del resultado para que no se vea el final del reel al frenar. */
const TARGET_INDEX = 44;

/** Desvanece los extremos del reel en vez de cortarlos en seco — se ve menos "recortado". */
const EDGE_FADE_MASK = "linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%)";

/** Cuánto se deja ver el highlight/pop del ítem ganador antes de avisarle al padre que ya se puede pasar al siguiente paso (ej. MangoRevealWidget colapsa a la tarjeta de resultado) — sin esto, el highlight nunca llega a pintarse porque el padre reacciona a onSettle en el mismo tick. */
const HIGHLIGHT_HOLD_MS = 650;

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
  const [isSettled, setIsSettled] = useState(false);
  const [spinDurationMs, setSpinDurationMs] = useState(
    cachedSpinDurationMs ?? FALLBACK_SPIN_DURATION_MS,
  );
  const settled = useRef(false);
  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Limpieza si el componente se desmonta durante el hold del highlight
  // (ej. el padre lo saca por alguna otra razón antes de que onSettle
  // llegue a dispararse) — evita un setState después de desmontado.
  useEffect(() => {
    return () => clearTimeout(settleTimeoutRef.current);
  }, []);

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
    <div className="relative" style={{ width: VISIBLE_ITEMS * ITEM_WIDTH }}>
      <div
        className="relative overflow-hidden rounded-xl border border-gold/30 bg-bg-elevated shadow-[inset_0_2px_20px_-4px_rgba(0,0,0,0.8),inset_0_-2px_20px_-4px_rgba(0,0,0,0.8),0_12px_28px_-10px_rgba(0,0,0,0.7)]"
        style={{
          width: VISIBLE_ITEMS * ITEM_WIDTH,
          maskImage: EDGE_FADE_MASK,
          WebkitMaskImage: EDGE_FADE_MASK,
        }}
      >
        {/* Resplandor detrás del ítem ganador — siempre queda centrado en el
            viewport una vez que la ruleta frena, así que no hace falta
            calcular su posición: el centro del contenedor ES el centro del
            resultado. -z-10 lo manda detrás del reel (que no está
            posicionado, así que por default pintaría encima). */}
        {isSettled && (
          <div
            className="pointer-events-none absolute inset-y-0 left-1/2 -z-10 w-20 -translate-x-1/2 bg-gold/30 blur-2xl"
            aria-hidden
          />
        )}
        <div
          className="flex"
          style={{
            transform: `translateX(-${offset}px)`,
            transition: transitioning
              ? `transform ${spinDurationMs}ms cubic-bezier(0.16, 1, 0.3, 1)`
              : "none",
          }}
          onTransitionEnd={() => {
            if (settled.current) return;
            settled.current = true;
            setIsSettled(true);
            // Deja ver el highlight/pop del ganador un instante antes de
            // avisarle al padre — si no, MangoRevealWidget reacciona a
            // onSettle en el mismo tick y colapsa esta vista antes de que
            // el highlight llegue a pintarse.
            settleTimeoutRef.current = setTimeout(() => onSettle?.(), HIGHLIGHT_HOLD_MS);
          }}
        >
          {reel.map((item, i) => {
            const isWinner = isSettled && i === TARGET_INDEX;
            return (
              <div
                key={`${item.key}-${i}`}
                className="flex shrink-0 flex-col items-center justify-center gap-1 py-3"
                style={{ width: ITEM_WIDTH }}
              >
                <PunishmentIcon
                  iconUrl={item.iconUrl}
                  noFlash={item.noFlash}
                  size={56}
                  imgClassName={`h-14 w-14 rounded-lg object-cover shadow-md transition-shadow duration-300 ${
                    isWinner
                      ? "shadow-[0_0_26px_-2px_var(--gold)] ring-2 ring-gold [animation:roulette-win-pop_0.55s_cubic-bezier(0.34,1.56,0.64,1)_forwards]"
                      : item.variant
                        ? VARIANT_RING[item.variant]
                        : "ring-1 ring-border-hairline"
                  }`}
                />
                <span
                  className={`max-w-[88px] truncate text-center text-[10px] transition-colors duration-300 ${
                    isWinner ? "font-semibold text-gold" : "text-text-secondary"
                  }`}
                >
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-gold shadow-[0_0_8px_var(--gold)]" />
      </div>
      {/* Punteros del marcador central, fuera del overflow-hidden de arriba para no recortarse. */}
      <div
        className="pointer-events-none absolute -top-1.5 left-1/2 h-0 w-0 -translate-x-1/2 border-x-4 border-t-4 border-x-transparent border-t-gold"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-1.5 left-1/2 h-0 w-0 -translate-x-1/2 border-x-4 border-b-4 border-x-transparent border-b-gold"
        aria-hidden
      />
    </div>
  );
}
