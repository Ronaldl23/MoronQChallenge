"use client";

import { useState } from "react";

type Step =
  | { phase: "confirm" }
  | { phase: "discarding" }
  | { phase: "result"; moldy: boolean }
  | { phase: "error"; message: string };

/**
 * Tirar a la basura un mango que ya pasó la ventana de lanzamiento (ver
 * canDiscardMango en src/lib/mango-launch.ts) — el azar (50% hongo) se
 * decide en el servidor acá también, como siempre. Si tuvo hongo, el
 * resultado ("result", moldy=true) es solo un aviso de transición: la
 * ruleta de verdad la dispara MangoNotifications solo, apenas el próximo
 * poll detecte el mango 'pending_reveal' — este modal no espera a eso, se
 * cierra y deja que el flujo normal de revelación siga su curso.
 */
export function DiscardModal({
  mangoId,
  onClose,
  onComplete,
}: {
  mangoId: string;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [step, setStep] = useState<Step>({ phase: "confirm" });

  async function handleConfirm() {
    setStep({ phase: "discarding" });

    const res = await fetch("/api/jugador/mangos/discard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mango_id: mangoId }),
    });
    const body = await res.json().catch(() => null);

    if (!res.ok) {
      setStep({ phase: "error", message: body?.error ?? "No se pudo tirar el mango" });
      return;
    }

    setStep({ phase: "result", moldy: !!body?.moldy });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border-hairline bg-surface p-6"
        onClick={(event) => event.stopPropagation()}
      >
        {step.phase === "confirm" && (
          <>
            <h3 className="font-display text-lg font-bold text-text-primary">
              ¿Tirar este mango a la basura?
            </h3>
            <p className="mt-1 text-xs text-text-secondary">
              Ya no se puede lanzar. Tiene 50% de probabilidad de tener hongos — si te toca, te va a
              tocar cumplir un castigo igual.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={handleConfirm}
                className="rounded-full bg-gold px-4 py-2 font-display text-sm font-bold tracking-wide text-bg uppercase transition-colors hover:bg-gold-soft"
              >
                Tirar a la basura
              </button>
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-text-secondary hover:text-text-primary"
              >
                Cancelar
              </button>
            </div>
          </>
        )}

        {step.phase === "discarding" && (
          <p className="py-8 text-center text-sm text-text-secondary">Tirando...</p>
        )}

        {step.phase === "result" && !step.moldy && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- asset local */}
            <img src="/MangoPodrido.png" alt="" className="h-20 w-20 object-contain" />
            <p className="font-display text-xl font-bold text-gold">
              Tu mango se ha tirado con éxito a la basura
            </p>
            <button
              type="button"
              onClick={onComplete}
              className="mt-2 rounded-full bg-gold px-4 py-2 font-display text-sm font-bold tracking-wide text-bg uppercase transition-colors hover:bg-gold-soft"
            >
              Listo
            </button>
          </div>
        )}

        {step.phase === "result" && step.moldy && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- asset local */}
            <img src="/MangoPodridoFurioso.png" alt="" className="h-20 w-20 object-contain" />
            <p className="font-display text-xl font-bold text-loss">¡Tenía hongos!</p>
            <p className="text-sm text-text-secondary">
              Te vas a enterar qué te tocó en un instante — mirá la esquina de la pantalla.
            </p>
            <button
              type="button"
              onClick={onComplete}
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
