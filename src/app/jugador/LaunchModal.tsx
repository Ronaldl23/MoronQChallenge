"use client";

import { useState } from "react";

type Step =
  | { phase: "select" }
  | { phase: "launching" }
  | { phase: "sent"; targetName: string }
  | { phase: "error"; message: string };

export interface LaunchTarget {
  id: string;
  nombre_display: string;
  /** Castigos activos ahora mismo (penalty_progress en 'pending') — ver MAX_ACTIVE_PENALTIES en src/lib/mango-launch.ts. */
  activePenaltyCount: number;
  maxActivePenalties: number;
  /** ISO — null o en el pasado si no tiene protección activa. Se gana al cumplir un castigo teniendo maxActivePenalties activos a la vez (ver PROTECTION_HOURS). */
  protectedUntil: string | null;
  /** Presencia (últimos 45s de last_seen_at) — ver src/lib/presence.ts. Calculado server-side. */
  online: boolean;
}

function isProtected(target: LaunchTarget): boolean {
  return target.protectedUntil !== null && new Date(target.protectedUntil) > new Date();
}

/** Horas enteras redondeadas hacia arriba que le quedan de protección — para mostrar "protegido 3h" en vez de un timestamp crudo. */
function protectionHoursLeft(protectedUntil: string): number {
  return Math.max(1, Math.ceil((new Date(protectedUntil).getTime() - Date.now()) / (60 * 60 * 1000)));
}

/**
 * El azar (campeón/Support/rebote) se decide en el servidor en el momento
 * del lanzamiento, como siempre — pero desde este rediseño ya NO se le
 * muestra a quien lanza (ver /api/jugador/mangos/launch). El resultado se
 * revela recién en la sesión de quien lo tiene que revelar, con
 * MangoRevealModal (disparado automáticamente desde MangoNotifications en
 * cualquier página, o manualmente desde el banner de "Mango en espera" acá
 * mismo en /jugador) — este modal solo confirma el envío.
 */
export function LaunchModal({
  mangoId,
  otherParticipants,
  onClose,
  onComplete,
}: {
  mangoId: string;
  otherParticipants: LaunchTarget[];
  onClose: () => void;
  onComplete: () => void;
}) {
  const [step, setStep] = useState<Step>({ phase: "select" });

  async function handleSelectTarget(targetId: string, targetName: string) {
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

    setStep({ phase: "sent", targetName: body.targetNombreDisplay ?? targetName });
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
            <p className="mt-1 text-xs text-text-secondary">
              El castigo se decide ahora, pero no lo vas a ver — se revela en la sesión de quien lo
              reciba.
            </p>
            <div className="mt-4 flex max-h-80 flex-col gap-2 overflow-y-auto">
              {otherParticipants.length === 0 && (
                <p className="text-sm text-text-secondary">No hay otros participantes todavía.</p>
              )}
              {otherParticipants.map((p) => {
                const protectedNow = isProtected(p);
                const atLimit = p.activePenaltyCount >= p.maxActivePenalties;
                const disabled = protectedNow || atLimit;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleSelectTarget(p.id, p.nombre_display)}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      disabled
                        ? "cursor-not-allowed border-border-hairline bg-bg-elevated/40 text-text-muted"
                        : "border-border-hairline bg-bg-elevated text-text-primary hover:border-gold/50"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      {/* Mismo estilo de brillo que el "en partida" de OP.GG (OpggButton) — un jugador conectado ahora mismo es más probable que revele pronto. */}
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          p.online ? "animate-pulse bg-live shadow-[0_0_6px_var(--live)]" : "bg-text-muted/40"
                        }`}
                        aria-hidden
                      />
                      <span className={p.online ? "" : "text-text-muted"}>{p.nombre_display}</span>
                    </span>
                    {protectedNow ? (
                      <span className="text-xs text-loss">
                        protegido {protectionHoursLeft(p.protectedUntil!)}h
                      </span>
                    ) : atLimit ? (
                      <span className="text-xs text-loss">máximo de castigos disponibles</span>
                    ) : (
                      <span className="text-xs text-text-secondary">
                        {p.activePenaltyCount}/{p.maxActivePenalties} castigos
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

        {step.phase === "sent" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- asset local */}
            <img src="/MangoHappy.png" alt="" className="h-20 w-20 object-contain" />
            <p className="font-display text-xl font-bold text-gold">¡Mango lanzado!</p>
            <p className="text-sm text-text-secondary">
              Se lo enviaste a <strong className="text-text-primary">{step.targetName}</strong>. Te
              vamos a avisar acá cuando lo revele.
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
