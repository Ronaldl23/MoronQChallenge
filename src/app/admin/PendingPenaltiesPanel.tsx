"use client";

import { useEffect, useState } from "react";
import type { PendingPenaltyAdminView } from "@/app/api/admin/penalties/all-pending/route";
import { PunishmentIcon } from "@/components/PunishmentIcon";

type LoadState = { type: "loading" } | { type: "error"; message: string } | { type: "loaded" };

/**
 * TODOS los castigos pendientes del roster, con un botón "Perdonar este
 * castigo" por cada uno — para no tener que ir a Supabase a mano cuando un
 * castigo se generó por un problema puntual (cursor mal reseteado, un bug
 * de una corrida) en vez de por algo que el jugador hizo. A diferencia de
 * PenaltyReviewPanel (que resuelve descalificaciones completas), esto
 * perdona UN castigo individual sin tocar el resto de lo que ese jugador
 * tenga pendiente — ver /api/admin/penalties/forgive.
 */
export function PendingPenaltiesPanel() {
  const [penalties, setPenalties] = useState<PendingPenaltyAdminView[]>([]);
  const [state, setState] = useState<LoadState>({ type: "loading" });
  const [forgivingId, setForgivingId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchPenalties() {
      const res = await fetch("/api/admin/penalties/all-pending");
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

  async function forgivePenalty(id: string) {
    if (!confirm("¿Perdonar este castigo? Se marca como cumplido y se resetea el contador de partidas sin cumplir de ese jugador.")) {
      return;
    }
    setForgivingId(id);
    const res = await fetch("/api/admin/penalties/forgive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ penalty_progress_id: id }),
    });
    if (res.ok) {
      setPenalties((prev) => prev.filter((p) => p.id !== id));
    } else {
      const body = await res.json().catch(() => null);
      alert(body?.error ?? "No se pudo perdonar el castigo");
    }
    setForgivingId(null);
  }

  const groups = new Map<string, { participantName: string; penalties: PendingPenaltyAdminView[] }>();
  for (const p of penalties) {
    const group = groups.get(p.participantId) ?? { participantName: p.participantName, penalties: [] };
    group.penalties.push(p);
    groups.set(p.participantId, group);
  }

  return (
    <section className="flex flex-col gap-4 border-t border-zinc-200 pt-8 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-black dark:text-zinc-50">Castigos pendientes</h2>
        <button
          type="button"
          onClick={handleRefreshClick}
          className="text-sm text-zinc-500 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Actualizar
        </button>
      </div>

      {state.type === "loading" && <p className="text-sm text-zinc-500 dark:text-zinc-400">Cargando...</p>}
      {state.type === "error" && <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>}
      {state.type === "loaded" && groups.size === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Nadie tiene castigos pendientes ahora mismo.</p>
      )}

      <ul className="flex flex-col gap-4">
        {[...groups.entries()].map(([participantId, group]) => (
          <li
            key={participantId}
            className="flex flex-col gap-3 rounded border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <p className="text-sm font-medium text-black dark:text-zinc-50">{group.participantName}</p>
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
                  <div className="min-w-0 flex-1 text-sm text-zinc-700 dark:text-zinc-300">
                    <p className="font-medium text-black dark:text-zinc-50">Castigo: {p.championName}</p>
                    <p>
                      {p.isNoncompliancePenalty
                        ? "Por incumplimiento (autoinfligido)"
                        : p.isMoldyTrash
                          ? "Mango con hongos (autoinfligido)"
                          : p.isBounceBack
                            ? "Rebote de su propio lanzamiento (autoinfligido)"
                            : `Enviado por ${p.senderName}`}
                      {!p.revealed && " — todavía no revelado"}
                    </p>
                    <p className="text-zinc-500 dark:text-zinc-400">
                      Asignado el {new Date(p.createdAt).toLocaleString("es")}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={forgivingId === p.id}
                    onClick={() => forgivePenalty(p.id)}
                    className="shrink-0 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-red-700"
                  >
                    Perdonar
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
