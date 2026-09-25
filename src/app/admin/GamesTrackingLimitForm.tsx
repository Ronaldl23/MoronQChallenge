"use client";

import { useEffect, useState, type FormEvent } from "react";
import { GAMES_TRACKING_LIMIT } from "@/lib/games-tracking";

interface ParticipantOption {
  id: string;
  nombre_display: string;
  riot_game_name: string;
  riot_tag: string;
  tracked_games_played: number;
  unlimited_games_tracking: boolean;
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
 * Tope de partidas rastreadas (ver 0040_games_tracking_limit.sql) — al
 * llegar a GAMES_TRACKING_LIMIT partidas ranked reales desde que entró al
 * torneo, /api/update-rankings deja de tocar a ese jugador del todo
 * (rango/LP, misiones y Mangos quedan congelados en lo último que tenía).
 * Esta excepción (checkbox, mismo patrón que ForFunToggleForm) le saca el
 * tope para siempre a un jugador puntual, sin importar cuántas partidas
 * acumule — el contador se sigue mostrando igual, informativo.
 */
export function GamesTrackingLimitForm() {
  const [list, setList] = useState<ListState>({ type: "loading" });
  const [participantId, setParticipantId] = useState("");
  const [unlimited, setUnlimited] = useState(false);
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

  const participants = list.type === "loaded" ? list.participants : [];
  const selected = participants.find((p) => p.id === participantId) ?? null;

  function handleSelect(id: string) {
    setParticipantId(id);
    const participant = participants.find((p) => p.id === id);
    setUnlimited(participant?.unlimited_games_tracking ?? false);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!participantId) return;
    setStatus({ type: "loading" });

    const res = await fetch("/api/admin/participants/games-tracking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant_id: participantId, unlimited_games_tracking: unlimited }),
    });

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      setStatus({ type: "error", message: body?.error ?? "No se pudo actualizar el tope de partidas" });
      return;
    }

    setStatus({
      type: "success",
      message: `${body.participant.nombre_display} quedó ${unlimited ? "sin límite de partidas" : "con el límite normal"}.`,
    });
    setList((current) =>
      current.type === "loaded"
        ? {
            type: "loaded",
            participants: current.participants.map((p) =>
              p.id === participantId ? { ...p, unlimited_games_tracking: unlimited } : p,
            ),
          }
        : current,
    );
  }

  return (
    <section className="flex flex-col gap-4 border-t border-zinc-200 pt-8 dark:border-zinc-800">
      <div>
        <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
          Tope de partidas rastreadas
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Al llegar a {GAMES_TRACKING_LIMIT} partidas ranked jugadas desde que entró al torneo, un
          jugador deja de actualizarse (rango, misiones y Mangos quedan congelados) hasta que lo
          habilités acá.
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
              onChange={(event) => handleSelect(event.target.value)}
              className="rounded border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
              required
            >
              <option value="" disabled>
                Elegí un jugador
              </option>
              {participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre_display} ({p.riot_game_name}#{p.riot_tag}) — {p.tracked_games_played}/
                  {GAMES_TRACKING_LIMIT}
                  {p.unlimited_games_tracking ? " — sin límite" : ""}
                </option>
              ))}
            </select>
          </label>

          {selected && (
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={unlimited}
                onChange={(event) => setUnlimited(event.target.checked)}
                className="h-4 w-4"
              />
              Sin límite de partidas para {selected.nombre_display}
            </label>
          )}

          {status.type === "error" && (
            <p className="text-sm text-red-600 dark:text-red-400">{status.message}</p>
          )}
          {status.type === "success" && (
            <p className="text-sm text-green-700 dark:text-green-400">{status.message}</p>
          )}

          <button
            type="submit"
            disabled={status.type === "loading" || !participantId}
            className="self-start rounded bg-amber-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {status.type === "loading" ? "Guardando..." : "Guardar"}
          </button>
        </form>
      )}
    </section>
  );
}
