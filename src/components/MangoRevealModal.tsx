"use client";

import { useRef, useState } from "react";
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
  | { phase: "prompt" }
  | { phase: "revealing" }
  | { phase: "spinning"; result: RouletteItem; spinToken: number }
  | { phase: "revealed"; champion: ChampionResult }
  | { phase: "error"; message: string };

/**
 * Revelación de un mango 'pending_reveal' — el azar YA se decidió en el
 * servidor al momento del lanzamiento (ver /api/jugador/mangos/launch);
 * esto solo pide el resultado ya guardado (/api/jugador/mangos/reveal) y
 * anima la MISMA ruleta que antes vivía en LaunchModal. Nunca incluye el
 * balde de rebote: para cuando cualquier mango llega a 'pending_reveal',
 * el rebote (si hubo) ya se resolvió íntegro server-side — lo que se
 * revela acá siempre es un campeón puntual o Support.
 *
 * Se usa en dos lugares con el mismo componente: el disparo automático
 * desde MangoNotifications (cualquier página) y el botón manual "Mango en
 * espera" de InventoryPanel (si por lo que sea no se disparó solo).
 */
export function MangoRevealModal({
  mangoId,
  champions,
  onClose,
  onRevealed,
}: {
  mangoId: string;
  champions: Champion[];
  onClose: () => void;
  onRevealed?: () => void;
}) {
  const [step, setStep] = useState<Step>({ phase: "prompt" });
  const pendingChampionRef = useRef<ChampionResult | null>(null);
  // Contador en vez de Date.now(): alcanza con que cambie para forzar el useEffect de RouletteStrip.
  const spinCounterRef = useRef(0);

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

  async function handleReveal() {
    setStep({ phase: "revealing" });

    const res = await fetch("/api/jugador/mangos/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mango_id: mangoId }),
    });
    const body = await res.json().catch(() => null);

    if (!res.ok) {
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
  }

  function handleSettle() {
    const champion = pendingChampionRef.current;
    if (!champion) return;
    setStep({ phase: "revealed", champion });
  }

  function handleDone() {
    onRevealed?.();
    onClose();
  }

  // "revealing"/"spinning"/"revealed" ya comprometieron la revelación en el
  // servidor (el mango pasó a 'sent') — cerrar el modal en esos pasos no
  // debe perderla, así que el botón de cerrar solo aparece en "prompt" (y
  // "error", donde no se llegó a comprometer nada).
  const canDismiss = step.phase === "prompt" || step.phase === "error";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={canDismiss ? onClose : undefined}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-gold/40 bg-surface p-6 shadow-[0_0_60px_-20px_var(--gold)]"
        onClick={(event) => event.stopPropagation()}
      >
        {step.phase === "prompt" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- asset local */}
            <img src="/MangoAngry.png" alt="" className="h-20 w-20 object-contain" />
            <h3 className="font-display text-lg font-bold text-text-primary">
              ¡Tenés un Mango esperando!
            </h3>
            <p className="text-sm text-text-secondary">
              Alguien te lo envió — girá la ruleta para ver qué castigo te tocó.
            </p>
            <button
              type="button"
              onClick={handleReveal}
              className="mt-2 rounded-full bg-gold px-5 py-2 font-display text-sm font-bold tracking-wide text-bg uppercase transition-colors hover:bg-gold-soft"
            >
              Girar la ruleta
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-text-secondary hover:text-text-primary"
            >
              Ahora no
            </button>
          </div>
        )}

        {step.phase === "revealing" && (
          <p className="py-8 text-center text-sm text-text-secondary">Preparando la ruleta...</p>
        )}

        {step.phase === "spinning" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <h3 className="font-display text-lg font-bold text-text-primary">
              Girando la ruleta...
            </h3>
            <RouletteStrip
              key={step.spinToken}
              pool={poolWithSupport}
              result={step.result}
              onSettle={handleSettle}
            />
          </div>
        )}

        {step.phase === "revealed" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- CDN externo (Data Dragon / Community Dragon) */}
            <img
              src={step.champion.iconUrl}
              alt={step.champion.name}
              className="h-20 w-20 rounded-lg ring-2 ring-gold"
            />
            <p className="font-display text-xl font-bold text-gold">
              Te tocó: {step.champion.name}
            </p>
            <button
              type="button"
              onClick={handleDone}
              className="mt-2 rounded-full bg-gold px-4 py-2 font-display text-sm font-bold tracking-wide text-bg uppercase transition-colors hover:bg-gold-soft"
            >
              Listo
            </button>
          </div>
        )}

        {step.phase === "error" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-sm font-medium text-loss">{step.message}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 rounded-full bg-gold px-4 py-2 font-display text-sm font-bold tracking-wide text-bg uppercase transition-colors hover:bg-gold-soft"
            >
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
