"use client";

import { useEffect, useState, type FormEvent } from "react";
import { SUPPORTED_PLATFORMS } from "@/lib/riot";

interface ParticipantOption {
  id: string;
  nombre_display: string;
  riot_game_name: string;
  riot_tag: string;
  region_platform: string;
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
 * Para cuando a un jugador le banean la cuenta de LoL y sigue el torneo
 * con una nueva: reemplaza riot_game_name/riot_tag/puuid/region (y borra
 * los snapshots viejos + resetea el progreso de misiones, ver
 * /api/admin/participants/replace-account) sin crear un participante
 * nuevo — mismo id, mismo nombre_display, mismo lugar en el torneo.
 */
export function ReplaceParticipantAccountForm() {
  const [list, setList] = useState<ListState>({ type: "loading" });
  const [participantId, setParticipantId] = useState("");
  const [riotGameName, setRiotGameName] = useState("");
  const [riotTag, setRiotTag] = useState("");
  const [regionPlatform, setRegionPlatform] = useState<string>(SUPPORTED_PLATFORMS[0]);
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

  function handleSelectParticipant(id: string) {
    setParticipantId(id);
    if (list.type === "loaded") {
      const selected = list.participants.find((p) => p.id === id);
      if (selected) setRegionPlatform(selected.region_platform);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!participantId) return;
    setStatus({ type: "loading" });

    const res = await fetch("/api/admin/participants/replace-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participant_id: participantId,
        riot_game_name: riotGameName,
        riot_tag: riotTag,
        region_platform: regionPlatform,
      }),
    });

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      setStatus({
        type: "error",
        message: body?.error ?? "No se pudo reemplazar la cuenta",
      });
      return;
    }

    setStatus({
      type: "success",
      message: `Cuenta reemplazada: ahora es ${body.participant.riot_game_name}#${body.participant.riot_tag}`,
    });

    if (list.type === "loaded") {
      setList({
        type: "loaded",
        participants: list.participants.map((p) =>
          p.id === body.participant.id
            ? {
                ...p,
                riot_game_name: body.participant.riot_game_name,
                riot_tag: body.participant.riot_tag,
                region_platform: body.participant.region_platform,
              }
            : p,
        ),
      });
    }
    setRiotGameName("");
    setRiotTag("");
  }

  return (
    <section className="flex flex-col gap-4 border-t border-zinc-200 pt-8 dark:border-zinc-800">
      <div>
        <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
          Reemplazar cuenta del jugador
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Cambia el Riot ID de un participante sin tocar su lugar en el
          torneo (mismo nombre, mismo id) — arranca de 0: se borra su
          historial de LP y el progreso de misiones.
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
              onChange={(event) => handleSelectParticipant(event.target.value)}
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
            Riot game name (cuenta nueva)
            <input
              value={riotGameName}
              onChange={(event) => setRiotGameName(event.target.value)}
              className="rounded border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Riot tag (sin #)
            <input
              value={riotTag}
              onChange={(event) => setRiotTag(event.target.value)}
              className="rounded border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Región
            <select
              value={regionPlatform}
              onChange={(event) => setRegionPlatform(event.target.value)}
              className="rounded border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            >
              {SUPPORTED_PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {platform}
                </option>
              ))}
            </select>
          </label>

          {status.type === "error" && (
            <p className="text-sm text-red-600 dark:text-red-400">{status.message}</p>
          )}
          {status.type === "success" && (
            <p className="text-sm text-green-700 dark:text-green-400">{status.message}</p>
          )}

          <button
            type="submit"
            disabled={status.type === "loading" || !participantId}
            className="self-start rounded bg-red-700 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {status.type === "loading" ? "Reemplazando..." : "Reemplazar cuenta"}
          </button>
        </form>
      )}
    </section>
  );
}
