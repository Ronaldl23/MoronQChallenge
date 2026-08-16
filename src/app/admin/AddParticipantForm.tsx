"use client";

import { useState, type FormEvent } from "react";
import { SUPPORTED_PLATFORMS } from "@/lib/riot";

const initialForm: {
  nombre_display: string;
  riot_game_name: string;
  riot_tag: string;
  region_platform: string;
} = {
  nombre_display: "",
  riot_game_name: "",
  riot_tag: "",
  region_platform: SUPPORTED_PLATFORMS[0],
};

type Status =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "success"; message: string };

export function AddParticipantForm() {
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState<Status>({ type: "idle" });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus({ type: "loading" });

    const res = await fetch("/api/participants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      setStatus({
        type: "error",
        message: body?.error ?? "No se pudo agregar el participante",
      });
      return;
    }

    setStatus({
      type: "success",
      message: `Agregado: ${body.participant.riot_game_name}#${body.participant.riot_tag}`,
    });
    setForm(initialForm);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Nombre para mostrar
        <input
          value={form.nombre_display}
          onChange={(event) => setForm({ ...form, nombre_display: event.target.value })}
          className="rounded border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Riot game name
        <input
          value={form.riot_game_name}
          onChange={(event) =>
            setForm({ ...form, riot_game_name: event.target.value })
          }
          className="rounded border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Riot tag (sin #)
        <input
          value={form.riot_tag}
          onChange={(event) => setForm({ ...form, riot_tag: event.target.value })}
          className="rounded border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Región
        <select
          value={form.region_platform}
          onChange={(event) =>
            setForm({ ...form, region_platform: event.target.value })
          }
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
        <p className="text-sm text-green-600 dark:text-green-400">{status.message}</p>
      )}

      <button
        type="submit"
        disabled={status.type === "loading"}
        className="rounded bg-black px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {status.type === "loading" ? "Agregando..." : "Agregar"}
      </button>
    </form>
  );
}
