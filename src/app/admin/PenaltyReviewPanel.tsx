"use client";

import { useEffect, useState } from "react";
import type { DisqualifiedPenalty, ManuallyDisqualifiedPlayer } from "@/app/api/admin/penalties/route";
import { PunishmentIcon } from "@/components/PunishmentIcon";

type LoadState = { type: "loading" } | { type: "error"; message: string } | { type: "loaded" };

/**
 * Dos vías de descalificación, mostradas juntas por jugador (ver
 * /api/admin/penalties):
 * - Automática (src/lib/penalty.ts): un jugador se pasa a 'disqualified'
 *   solo, sin que ningún admin tenga que confirmarlo — se listan los
 *   castigos sin cumplir.
 * - Manual (/api/admin/participants/disqualify, formulario en
 *   DisqualifyParticipantForm): un admin lo descalifica directo por otro
 *   motivo (trampa, conducta, etc.) — se muestra el motivo en vez de un
 *   castigo.
 *
 * En cualquiera de las dos, la única acción disponible es "Perdonar
 * jugador", que resuelve TODO lo que tenga pendiente de una — no hay
 * perdón por castigo individual. Perdonar los castigos de mango no los
 * borra: los devuelve a 'pending' con ventana fresca (ver
 * /api/admin/penalties/resolve), así que los sigue teniendo que cumplir;
 * la descalificación manual sí se limpia por completo (no hay "castigo"
 * que devolver ahí).
 */
export function PenaltyReviewPanel() {
  const [penalties, setPenalties] = useState<DisqualifiedPenalty[]>([]);
  const [manuallyDisqualified, setManuallyDisqualified] = useState<ManuallyDisqualifiedPlayer[]>([]);
  const [state, setState] = useState<LoadState>({ type: "loading" });
  const [resolvingParticipantId, setResolvingParticipantId] = useState<string | null>(null);
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
      setManuallyDisqualified(body.manuallyDisqualified ?? []);
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

  async function pardonPlayer(participantId: string) {
    setResolvingParticipantId(participantId);
    const res = await fetch("/api/admin/penalties/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant_id: participantId }),
    });
    if (res.ok) {
      setPenalties((prev) => prev.filter((p) => p.participantId !== participantId));
      setManuallyDisqualified((prev) => prev.filter((p) => p.participantId !== participantId));
    } else {
      const body = await res.json().catch(() => null);
      alert(body?.error ?? "No se pudo perdonar al jugador");
    }
    setResolvingParticipantId(null);
  }

  const groups = new Map<
    string,
    { participantName: string; penalties: DisqualifiedPenalty[]; manualReason: string | null }
  >();
  for (const p of penalties) {
    const group = groups.get(p.participantId) ?? {
      participantName: p.participantName,
      penalties: [],
      manualReason: null,
    };
    group.penalties.push(p);
    groups.set(p.participantId, group);
  }
  for (const m of manuallyDisqualified) {
    const group = groups.get(m.participantId) ?? {
      participantName: m.participantName,
      penalties: [],
      manualReason: null,
    };
    group.manualReason = m.reason;
    groups.set(m.participantId, group);
  }

  return (
    <section className="flex flex-col gap-4 border-t border-zinc-200 pt-8 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
          Jugadores descalificados
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
      {state.type === "loaded" && groups.size === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Ningún jugador descalificado por ahora.
        </p>
      )}

      <ul className="flex flex-col gap-4">
        {[...groups.entries()].map(([participantId, group]) => (
          <li
            key={participantId}
            className="flex flex-col gap-3 rounded border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-black dark:text-zinc-50">
                {group.participantName}
                {group.penalties.length > 0 && (
                  <span className="font-normal text-zinc-500 dark:text-zinc-400">
                    {" "}
                    — descalificado por no cumplir{" "}
                    {group.penalties.length > 1 ? "estos castigos" : "este castigo"}
                  </span>
                )}
              </p>
              <button
                type="button"
                disabled={resolvingParticipantId === participantId}
                onClick={() => pardonPlayer(participantId)}
                className="shrink-0 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-red-700"
              >
                Perdonar jugador
              </button>
            </div>
            {group.manualReason !== null && (
              <p className="rounded bg-red-50 p-3 text-sm text-zinc-700 dark:bg-red-950/40 dark:text-zinc-300">
                <span className="font-medium text-black dark:text-zinc-50">
                  Descalificado manualmente:
                </span>{" "}
                {group.manualReason}
              </p>
            )}
            {group.penalties.length > 0 && (
              <ul className="flex flex-col gap-2">
                {group.penalties.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 rounded bg-zinc-50 p-3 dark:bg-zinc-800/60"
                  >
                    <PunishmentIcon
                      iconUrl={p.championIconUrl ?? "/MangoAngry.png"}
                      noFlash={p.noFlash}
                      size={40}
                      imgClassName="h-10 w-10 shrink-0 rounded object-cover"
                    />
                    <div className="text-sm text-zinc-700 dark:text-zinc-300">
                      <p className="font-medium text-black dark:text-zinc-50">
                        Castigo: {p.championName}
                      </p>
                      <p>Enviado por {p.senderName}</p>
                      <p className="text-zinc-500 dark:text-zinc-400">
                        Asignado el {new Date(p.createdAt).toLocaleDateString("es")}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
