"use client";

import { useState, type FormEvent } from "react";

const initialForm = { nombre: "", photo_url: "" };

type Status =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "success"; message: string };

export function AddShowcaseParticipantForm() {
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState<Status>({ type: "idle" });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus({ type: "loading" });

    const res = await fetch("/api/admin/showcase-participants", {
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
      message: `Agregado a /participantes: ${body.participant.nombre}`,
    });
    setForm(initialForm);
  }

  return (
    <section className="flex flex-col gap-4 border-t border-zinc-200 pt-8 dark:border-zinc-800">
      <div>
        <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
          Roster público (/participantes)
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Independiente del ranking de LoL de arriba — solo nombre y foto, sin
          necesidad de un Riot ID.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Nombre
          <input
            value={form.nombre}
            onChange={(event) =>
              setForm({ ...form, nombre: event.target.value })
            }
            className="rounded border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Foto (link)
          <input
            type="url"
            value={form.photo_url}
            onChange={(event) =>
              setForm({ ...form, photo_url: event.target.value })
            }
            placeholder="https://ejemplo.com/foto.jpg"
            className="rounded border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            required
          />
        </label>

        {status.type === "error" && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {status.message}
          </p>
        )}
        {status.type === "success" && (
          <p className="text-sm text-green-700 dark:text-green-400">
            {status.message}
          </p>
        )}

        <button
          type="submit"
          disabled={status.type === "loading"}
          className="rounded bg-black px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {status.type === "loading" ? "Agregando..." : "Agregar"}
        </button>
      </form>
    </section>
  );
}
