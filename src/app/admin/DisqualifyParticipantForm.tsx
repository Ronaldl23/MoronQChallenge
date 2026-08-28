"use client";

import { useEffect, useState, type FormEvent } from "react";

interface ParticipantOption {
  id: string;
  nombre_display: string;
  riot_game_name: string;
  riot_tag: string;
}

type ListState =
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "loaded"; participants: ParticipantOption[] };

type SubmitStatus =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "success"; message: string };

/**
 * Descalificación manual — para motivos que no tienen ningún mango de por
 * medio (trampa, conducta, etc.), distinto de la descalificación
 * automática por no cumplir un castigo a tiempo (ver src/lib/penalty.ts).
 * El jugador queda con la fila roja/último lugar del leaderboard igual
 * que esa otra vía (isDisqualified las combina, ver src/lib/leaderboard.ts)
 * y aparece en "Jugadores descalificados" (PenaltyReviewPanel) con el
 * motivo — perdonarlo desde ahí lo revierte por completo.
 */
export function DisqualifyParticipantForm() {
  const [list, setList] = useState<ListState>({ type: "loading" });
  const [participantId, setParticipantId] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<SubmitStatus>({ type: "idle" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch("/api/participants");
      const body = await res.json().catch(() => null);
      if (cancelled) return;
      if (!res.ok) {
        setList({ type: "error", message: body?.error ?? "No se pudo cargar la lista" });
        return;
      }
      setList({ type: "loaded", participants: body.participants ?? [] });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!participantId || !reason.trim()) return;
    setStatus({ type: "loading" });

    const res = await fetch("/api/admin/participants/disqualify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant_id: participantId, reason }),
    });

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      setStatus({ type: "error", message: body?.error ?? "No se pudo descalificar al jugador" });
      return;
    }

    setStatus({
      type: "success",
      message: `${body.participant.nombre_display} quedó descalificado.`,
    });
    setParticipantId("");
    setReason("");
  }

  return (
    <section className="flex flex-col gap-4 border-t border-zinc-200 pt-8 dark:border-zinc-800">
      <div>
        <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
          Descalificar jugador
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Descalifica a un participante directo, sin que tenga que ver con
          un castigo de mango (trampa, conducta, etc.) — cae al último
          lugar del leaderboard con la fila en rojo, igual que una
          descalificación automática. Se revierte desde &quot;Jugadores
          descalificados&quot; más abajo, con &quot;Perdonar jugador&quot;.
        </p>
      </div>

      {list.type === "loading" && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Cargando participantes...</p>
      )}
      {list.type === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">{list.message}</p>
      )}

      {list.type === "loaded" && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Jugador
            <select
              value={participantId}
              onChange={(event) => setParticipantId(event.target.value)}
              className="rounded border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
              required
            >
              <option value="" disabled>
                Elegí un jugador
              </option>
              {list.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre_display} ({p.riot_game_name}#{p.riot_tag})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Motivo
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="rounded border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
              rows={2}
              required
            />
          </label>

          {status.type === "error" && (
            <p className="text-sm text-red-600 dark:text-red-400">{status.message}</p>
          )}
          {status.type === "success" && (
            <p className="text-sm text-green-700 dark:text-green-400">{status.message}</p>
          )}

          <button
            type="submit"
            disabled={status.type === "loading" || !participantId || !reason.trim()}
            className="self-start rounded bg-red-700 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {status.type === "loading" ? "Descalificando..." : "Descalificar"}
          </button>
        </form>
      )}
    </section>
  );
}
