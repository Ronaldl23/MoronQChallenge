"use client";

import { useRef, useState } from "react";
import type { Champion } from "@/lib/champions";
import { RouletteStrip, type RouletteItem } from "@/components/RouletteStrip";

const BOUNCE_ITEM: RouletteItem = {
  key: "bounce",
  label: "MANGO DEVUELTO",
  iconUrl: "/MangoAngry.png",
  special: true,
};

type Step =
  | { phase: "select" }
  | { phase: "launching" }
  | { phase: "spinning"; result: RouletteItem; spinToken: number }
  | { phase: "revealed-normal"; champion: Champion; targetName: string }
  | { phase: "bounced-first-revealed"; targetName: string }
  | { phase: "spinning-bounce"; result: RouletteItem; spinToken: number }
  | { phase: "revealed-bounce"; champion: Champion }
  | { phase: "error"; message: string };

export interface LaunchTarget {
  id: string;
  nombre_display: string;
  receivedLast24h: number;
  dailyLimit: number;
}

export function LaunchModal({
  mangoId,
  otherParticipants,
  champions,
  onClose,
  onComplete,
}: {
  mangoId: string;
  otherParticipants: LaunchTarget[];
  champions: Champion[];
  onClose: () => void;
  onComplete: () => void;
}) {
  const [step, setStep] = useState<Step>({ phase: "select" });
  const pendingRef = useRef<{ bounced: boolean; champion: Champion; targetName: string } | null>(
    null,
  );
  // Contador en vez de Date.now(): alcanza con que cambie en cada giro para
  // forzar el useEffect de RouletteStrip, sin llamar nada impuro acá.
  const spinCounterRef = useRef(0);

  const pool: RouletteItem[] = champions.map((c) => ({
    key: c.id,
    label: c.name,
    iconUrl: c.iconUrl,
  }));
  // Marcador de rebote intercalado, solo para la PRIMERA ruleta (el "10%").
  const poolWithBounce: RouletteItem[] =
    pool.length > 0 ? [...pool, BOUNCE_ITEM, BOUNCE_ITEM] : [BOUNCE_ITEM];

  async function handleSelectTarget(targetId: string) {
    setStep({ phase: "launching" });

    const res = await fetch("/api/jugador/mangos/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mango_id: mangoId, target_participant_id: targetId }),
    });
    const body = await res.json().catch(() => null);

    if (!res.ok) {
      setStep({ phase: "error", message: body?.error ?? "No se pudo lanzar el mango" });
      return;
    }

    const bounced = body.bounced as boolean;
    const champion = body.champion as Champion;
    const targetName = body.targetNombreDisplay as string;
    pendingRef.current = { bounced, champion, targetName };

    const resultItem: RouletteItem = bounced
      ? BOUNCE_ITEM
      : { key: champion.id, label: champion.name, iconUrl: champion.iconUrl };
    spinCounterRef.current += 1;
    setStep({ phase: "spinning", result: resultItem, spinToken: spinCounterRef.current });
  }

  function handleFirstSettle() {
    const pending = pendingRef.current;
    if (!pending) return;
    setStep(
      pending.bounced
        ? { phase: "bounced-first-revealed", targetName: pending.targetName }
        : { phase: "revealed-normal", champion: pending.champion, targetName: pending.targetName },
    );
  }

  function handleContinueAfterBounceReveal() {
    const pending = pendingRef.current;
    if (!pending) return;
    const resultItem: RouletteItem = {
      key: pending.champion.id,
      label: pending.champion.name,
      iconUrl: pending.champion.iconUrl,
    };
    spinCounterRef.current += 1;
    setStep({ phase: "spinning-bounce", result: resultItem, spinToken: spinCounterRef.current });
  }

  function handleBounceSettle() {
    const pending = pendingRef.current;
    if (!pending) return;
    setStep({ phase: "revealed-bounce", champion: pending.champion });
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
        {step.phase === "select" && (
          <>
            <h3 className="font-display text-lg font-bold text-text-primary">
              ¿A quién le lanzás el mango?
            </h3>
            <div className="mt-4 flex max-h-80 flex-col gap-2 overflow-y-auto">
              {otherParticipants.length === 0 && (
                <p className="text-sm text-text-secondary">No hay otros participantes todavía.</p>
              )}
              {otherParticipants.map((p) => {
                const atLimit = p.receivedLast24h >= p.dailyLimit;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={atLimit}
                    onClick={() => handleSelectTarget(p.id)}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      atLimit
                        ? "cursor-not-allowed border-border-hairline bg-bg-elevated/40 text-text-muted"
                        : "border-border-hairline bg-bg-elevated text-text-primary hover:border-gold/50"
                    }`}
                  >
                    <span>{p.nombre_display}</span>
                    {atLimit ? (
                      <span className="text-xs text-loss">límite diario alcanzado</span>
                    ) : (
                      <span className="text-xs text-text-secondary">
                        {p.receivedLast24h}/{p.dailyLimit} hoy
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 text-sm text-text-secondary hover:text-text-primary"
            >
              Cancelar
            </button>
          </>
        )}

        {step.phase === "launching" && (
          <p className="py-8 text-center text-sm text-text-secondary">Lanzando...</p>
        )}

        {step.phase === "spinning" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <h3 className="font-display text-lg font-bold text-text-primary">
              Girando la ruleta...
            </h3>
            <RouletteStrip
              key={step.spinToken}
              pool={poolWithBounce}
              result={step.result}
              onSettle={handleFirstSettle}
            />
          </div>
        )}

        {step.phase === "revealed-normal" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- CDN externo (Data Dragon) */}
            <img
              src={step.champion.iconUrl}
              alt={step.champion.name}
              className="h-20 w-20 rounded-lg ring-2 ring-gold"
            />
            <p className="text-text-secondary">
              Le lanzaste el mango a{" "}
              <strong className="text-text-primary">{step.targetName}</strong>.
            </p>
            <p className="font-display text-xl font-bold text-gold">Le tocó: {step.champion.name}</p>
            <button
              type="button"
              onClick={onComplete}
              className="mt-2 rounded-full bg-gold px-4 py-2 font-display text-sm font-bold tracking-wide text-bg uppercase transition-colors hover:bg-gold-soft"
            >
              Listo
            </button>
          </div>
        )}

        {step.phase === "bounced-first-revealed" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- asset local */}
            <img src="/MangoAngry.png" alt="Mango devuelto" className="h-20 w-20 object-contain" />
            <p className="font-display text-xl font-bold text-loss">
              ¡{step.targetName} te devolvió el mango!
            </p>
            <p className="text-sm text-text-secondary">
              El mango vuelve a tu inventario — pero el castigo te toca a vos.
            </p>
            <button
              type="button"
              onClick={handleContinueAfterBounceReveal}
              className="mt-2 rounded-full bg-gold px-4 py-2 font-display text-sm font-bold tracking-wide text-bg uppercase transition-colors hover:bg-gold-soft"
            >
              Girar mi castigo
            </button>
          </div>
        )}

        {step.phase === "spinning-bounce" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <h3 className="font-display text-lg font-bold text-text-primary">
              Girando tu castigo...
            </h3>
            <RouletteStrip
              key={step.spinToken}
              pool={pool}
              result={step.result}
              onSettle={handleBounceSettle}
            />
          </div>
        )}

        {step.phase === "revealed-bounce" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- CDN externo (Data Dragon) */}
            <img
              src={step.champion.iconUrl}
              alt={step.champion.name}
              className="h-20 w-20 rounded-lg ring-2 ring-loss"
            />
            <p className="font-display text-xl font-bold text-loss">Te tocó: {step.champion.name}</p>
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
