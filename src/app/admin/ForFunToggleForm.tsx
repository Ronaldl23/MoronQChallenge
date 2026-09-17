"use client";

import { useEffect, useState, type FormEvent } from "react";

interface ParticipantOption {
  id: string;
  nombre_display: string;
  riot_game_name: string;
  riot_tag: string;
  for_fun: boolean;
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
 * Modo "For Fun" (ver 0039_for_fun_mode.sql) — para jugadores que no
 * cumplen las reglas del torneo: siguen viéndose en su posición real del
 * ranking, pero quedan afuera del podio/premios y completamente afuera del
 * sistema de Mangos (no pueden lanzarle a nadie ni que les lancen a
 * ellos). A diferencia de "Descalificar jugador", esto es un toggle
 * directo (activar/desactivar), no algo que se revierta desde "Perdonar
 * jugador" — el checkbox ya arranca marcado con el estado actual del
 * jugador elegido.
 */
export function ForFunToggleForm() {
  const [list, setList] = useState<ListState>({ type: "loading" });
  const [participantId, setParticipantId] = useState("");
  const [forFun, setForFun] = useState(false);
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
    setForFun(participant?.for_fun ?? false);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!participantId) return;
    setStatus({ type: "loading" });

    const res = await fetch("/api/admin/participants/for-fun", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant_id: participantId, for_fun: forFun }),
    });

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      setStatus({ type: "error", message: body?.error ?? "No se pudo actualizar el modo For Fun" });
      return;
    }

    setStatus({
      type: "success",
      message: `${body.participant.nombre_display} quedó ${forFun ? "en" : "fuera de"} modo For Fun.`,
    });
    setList((current) =>
      current.type === "loaded"
        ? {
            type: "loaded",
            participants: current.participants.map((p) =>
              p.id === participantId ? { ...p, for_fun: forFun } : p,
            ),
          }
        : current,
    );
  }

  return (
    <section className="flex flex-col gap-4 border-t border-zinc-200 pt-8 dark:border-zinc-800">
      <div>
        <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
          Modo For Fun
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Para jugadores que no cumplen las reglas del torneo: siguen
          jugando y viéndose en su posición real del ranking, pero quedan
          afuera del podio/premios y ya no pueden lanzar ni recibir mangos
          (castigos). Se puede activar y desactivar en cualquier momento
          desde acá.
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
                  {p.nombre_display} ({p.riot_game_name}#{p.riot_tag})
                  {p.for_fun ? " — For Fun activo" : ""}
                </option>
              ))}
            </select>
          </label>

          {selected && (
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={forFun}
                onChange={(event) => setForFun(event.target.checked)}
                className="h-4 w-4"
              />
              Activar modo For Fun para {selected.nombre_display}
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
