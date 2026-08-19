"use client";

import { useEffect, useRef, useState } from "react";
import type { Champion } from "@/lib/champions";
import { SUPPORT_ASSIGNMENT, SUPPORT_ICON_URL } from "@/lib/mango-launch";
import { RouletteStrip, type RouletteItem } from "@/components/RouletteStrip";

const SUPPORT_ITEM: RouletteItem = {
  key: "support",
  label: "Support",
  iconUrl: SUPPORT_ICON_URL,
  variant: "support",
};

interface ChampionResult {
  id: string;
  name: string;
  iconUrl: string;
}

/** El id pseudo-campeón "SUPPORT" que devuelve el servidor necesita el anillo dorado de SUPPORT_ITEM, no el genérico. */
function championToRouletteItem(champion: ChampionResult): RouletteItem {
  if (champion.id === SUPPORT_ASSIGNMENT) return SUPPORT_ITEM;
  return { key: champion.id, label: champion.name, iconUrl: champion.iconUrl };
}

type Step =
  | { phase: "revealing" }
  | { phase: "spinning"; result: RouletteItem; spinToken: number }
  | { phase: "revealed"; champion: ChampionResult }
  | { phase: "error"; message: string };

const RESULT_DISPLAY_MS = 4_000;
const ERROR_DISPLAY_MS = 4_000;

/**
 * Revelación 100% automática de un mango 'pending_reveal' — el azar YA se
 * decidió en el servidor al momento del lanzamiento (ver
 * /api/jugador/mangos/launch); esto solo pide el resultado ya guardado
 * (/api/jugador/mangos/reveal) y anima la MISMA ruleta que antes vivía en
 * LaunchModal. Nunca incluye el balde de rebote: para cuando cualquier
 * mango llega a 'pending_reveal', el rebote (si hubo) ya se resolvió
 * íntegro server-side — lo que se revela acá siempre es un campeón puntual
 * o Support.
 *
 * Arranca sola al montar (sin botón "Girar la ruleta" — el jugador no
 * tiene que hacer nada) y no bloquea el resto del sitio: vive flotando en
 * la misma esquina que los toasts (sin backdrop ni overlay de pantalla
 * completa), así se puede seguir navegando mientras gira. Avisa al padre
 * (MangoNotifications) con `onDone` cuando termina — con éxito, con error,
 * o porque otra pestaña ya lo reveló primero (409) — para que arranque el
 * siguiente mango de la cola si queda alguno.
 */
export function MangoRevealWidget({
  mangoId,
  champions,
  onDone,
}: {
  mangoId: string;
  champions: Champion[];
  onDone: () => void;
}) {
  const [step, setStep] = useState<Step | null>({ phase: "revealing" });
  const pendingChampionRef = useRef<ChampionResult | null>(null);
  const spinCounterRef = useRef(0);
  const doneRef = useRef(false);

  const championItems: RouletteItem[] = champions.map((c) => ({
    key: c.id,
    label: c.name,
    iconUrl: c.iconUrl,
  }));
  // Support pesa 20% real (vs. ~0.4% de un campeón puntual): unas cuantas
  // copias más en el pool visual para que se sienta acorde, aunque el
  // resultado real ya lo decidió el servidor — esto es solo relleno.
  const poolWithSupport: RouletteItem[] = [
    ...championItems,
    SUPPORT_ITEM,
    SUPPORT_ITEM,
    SUPPORT_ITEM,
    SUPPORT_ITEM,
  ];

  function finish() {
    if (doneRef.current) return;
    doneRef.current = true;
    setStep(null);
    onDone();
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const res = await fetch("/api/jugador/mangos/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mango_id: mangoId }),
      });
      if (cancelled) return;
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        // 409: otra pestaña ya lo reveló primero — no es un error real del
        // jugador, saltea en silencio en vez de mostrarle un mensaje feo.
        if (res.status === 409) {
          finish();
          return;
        }
        setStep({ phase: "error", message: body?.error ?? "No se pudo revelar el mango" });
        return;
      }

      const champion = body.champion as ChampionResult;
      pendingChampionRef.current = champion;
      spinCounterRef.current += 1;
      setStep({
        phase: "spinning",
        result: championToRouletteItem(champion),
        spinToken: spinCounterRef.current,
      });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mangoId]);

  // Ni "revealed" ni "error" requieren click: avanzan solos después de un
  // rato — la cola completa tiene que poder terminar sin que el jugador
  // toque nada, tal como el resto de esta secuencia.
  useEffect(() => {
    if (step?.phase === "revealed") {
      const id = setTimeout(finish, RESULT_DISPLAY_MS);
      return () => clearTimeout(id);
    }
    if (step?.phase === "error") {
      const id = setTimeout(finish, ERROR_DISPLAY_MS);
      return () => clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.phase]);

  function handleSettle() {
    const champion = pendingChampionRef.current;
    if (!champion) return;
    setStep({ phase: "revealed", champion });
  }

  if (!step) return null;

  return (
    <div className="pointer-events-auto w-fit max-w-[28rem] rounded-2xl border border-gold/40 bg-surface p-4 shadow-[0_0_40px_-16px_var(--gold)]">
      {step.phase === "revealing" && (
        <p className="px-2 py-2 text-sm text-text-secondary">Preparando la ruleta...</p>
      )}

      {step.phase === "spinning" && (
        <div className="flex flex-col items-center gap-3">
          <h3 className="font-display text-sm font-bold text-text-primary">Girando la ruleta...</h3>
          <RouletteStrip
            key={step.spinToken}
            pool={poolWithSupport}
            result={step.result}
            onSettle={handleSettle}
          />
        </div>
      )}

      {step.phase === "revealed" && (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- CDN externo (Data Dragon / Community Dragon) */}
          <img
            src={step.champion.iconUrl}
            alt={step.champion.name}
            className="h-12 w-12 shrink-0 rounded-lg object-cover ring-2 ring-gold"
          />
          <div className="min-w-0 flex-1">
            <p className="font-display text-xs font-bold text-gold">Te tocó</p>
            <p className="truncate text-sm font-semibold text-text-primary">{step.champion.name}</p>
          </div>
          <button
            type="button"
            onClick={finish}
            aria-label="Cerrar"
            className="shrink-0 text-text-muted hover:text-text-primary"
          >
            ✕
          </button>
        </div>
      )}

      {step.phase === "error" && (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-sm font-medium text-loss">{step.message}</p>
          <button
            type="button"
            onClick={finish}
            aria-label="Cerrar"
            className="shrink-0 text-text-muted hover:text-text-primary"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
