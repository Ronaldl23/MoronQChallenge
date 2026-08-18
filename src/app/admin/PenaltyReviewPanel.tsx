"use client";

import { useEffect, useState } from "react";
import type { FlaggedPenalty } from "@/app/api/admin/penalties/route";

type LoadState = { type: "loading" } | { type: "error"; message: string } | { type: "loaded" };

/**
 * Fase 4: cola de revisión manual. Lista los castigos en
 * 'flagged_for_review' (se pasaron de las 3 partidas sin cumplirse) para que
 * el admin confirme la descalificación o perdone — nunca pasa solo, siempre
 * requiere un click acá.
 */
export function PenaltyReviewPanel() {
  const [penalties, setPenalties] = useState<FlaggedPenalty[]>([]);
  const [state, setState] = useState<LoadState>({ type: "loading" });
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  // Cambiarlo re-dispara el efecto de abajo — así "Actualizar" reusa la
  // misma función definida ADENTRO del efecto (mismo patrón que
  // MangoNotifications.tsx) en vez de una función externa, que es lo que
  // dispara la regla react-hooks/set-state-in-effect.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchPenalties() {
      const res = await fetch("/api/admin/penalties");
      const body = await res.json().catch(() => null);
      if (cancelled) return;
      if (!res.ok) {
        setState({ type: "error", message: body?.error ?? "No se pudo cargar la lista" });
        return;
      }
      setPenalties(body.penalties ?? []);
      setState({ type: "loaded" });
    }

    fetchPenalties();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  function handleRefreshClick() {
    setState({ type: "loading" });
    setReloadToken((t) => t + 1);
  }

  async function resolve(id: string, action: "disqualify" | "pardon") {
    setResolvingId(id);
    const res = await fetch("/api/admin/penalties/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    if (res.ok) {
      setPenalties((prev) => prev.filter((p) => p.id !== id));
    } else {
      const body = await res.json().catch(() => null);
      alert(body?.error ?? "No se pudo resolver el castigo");
    }
    setResolvingId(null);
  }

  return (
    <section className="flex flex-col gap-4 border-t border-zinc-200 pt-8 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
          Castigos pendientes de revisión
        </h2>
        <button
          type="button"
          onClick={handleRefreshClick}
          className="text-sm text-zinc-500 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Actualizar
        </button>
      </div>

      {state.type === "loading" && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Cargando...</p>
      )}
      {state.type === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
      )}
      {state.type === "loaded" && penalties.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Ningún castigo pendiente de revisión por ahora.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {penalties.map((p) => (
          <li
            key={p.id}
            className="flex flex-col gap-3 rounded border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- CDN externo (Data Dragon / Community Dragon) */}
              <img
                src={p.championIconUrl ?? "/MangoAngry.png"}
                alt=""
                className="h-10 w-10 shrink-0 rounded object-cover"
              />
              <div className="text-sm text-zinc-700 dark:text-zinc-300">
                <p className="font-medium text-black dark:text-zinc-50">
                  {p.participantName} — castigo: {p.championName}
                </p>
                <p>Enviado por {p.senderName}</p>
                <p className="text-zinc-500 dark:text-zinc-400">
                  {p.gamesWithoutCompliance} partidas sin cumplir · asignado el{" "}
                  {new Date(p.createdAt).toLocaleDateString("es")}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={resolvingId === p.id}
                onClick={() => resolve(p.id, "pardon")}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
              >
                Perdonar
              </button>
              <button
                type="button"
                disabled={resolvingId === p.id}
                onClick={() => resolve(p.id, "disqualify")}
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-red-700"
              >
                Confirmar descalificación
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
