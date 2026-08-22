"use client";

import { useEffect, useState, type FormEvent } from "react";

type GuestStatus =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "success"; message: string; accessCode: string };

type RevealState =
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "loaded"; revealed: boolean; revealedAt: string | null };

/** Panel de admin para Pick'em: crear invitados con código de acceso, y revelar resultados a mano. */
export function PickemAdminPanel() {
  const [displayName, setDisplayName] = useState("");
  const [guestStatus, setGuestStatus] = useState<GuestStatus>({ type: "idle" });
  const [reveal, setReveal] = useState<RevealState>({ type: "loading" });
  const [revealing, setRevealing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch("/api/admin/pickem/reveal");
      const body = await res.json().catch(() => null);
      if (cancelled) return;
      if (!res.ok) {
        setReveal({ type: "error", message: body?.error ?? "No se pudo cargar el estado" });
        return;
      }
      setReveal({ type: "loaded", revealed: body.results_revealed, revealedAt: body.revealed_at });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreateGuest(event: FormEvent) {
    event.preventDefault();
    setGuestStatus({ type: "loading" });

    const res = await fetch("/api/admin/pickem/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: displayName }),
    });
    const body = await res.json().catch(() => null);

    if (!res.ok) {
      setGuestStatus({ type: "error", message: body?.error ?? "No se pudo crear el invitado" });
      return;
    }

    setGuestStatus({
      type: "success",
      message: `Invitado creado: ${body.guest.display_name}`,
      accessCode: body.guest.access_code,
    });
    setDisplayName("");
  }

  async function handleReveal() {
    if (!confirm("¿Revelar los resultados del Pick'em? Esta acción no se puede deshacer.")) return;
    setRevealing(true);
    const res = await fetch("/api/admin/pickem/reveal", { method: "POST" });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      alert(body?.error ?? "No se pudo revelar los resultados");
      setRevealing(false);
      return;
    }
    setReveal({ type: "loaded", revealed: true, revealedAt: new Date().toISOString() });
    setRevealing(false);
  }

  return (
    <section className="flex flex-col gap-6 border-t border-zinc-200 pt-8 dark:border-zinc-800">
      <div>
        <h2 className="text-lg font-semibold text-black dark:text-zinc-50">Pick&apos;em</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Invitados externos con acceso exclusivo a /pickem, y revelación manual de resultados.
        </p>
      </div>

      <form onSubmit={handleCreateGuest} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Nombre del invitado
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="rounded border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            required
          />
        </label>

        {guestStatus.type === "error" && (
          <p className="text-sm text-red-600 dark:text-red-400">{guestStatus.message}</p>
        )}
        {guestStatus.type === "success" && (
          <div className="flex flex-col gap-2 rounded border border-green-300 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
            <p className="text-sm text-green-700 dark:text-green-400">{guestStatus.message}</p>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              Código de acceso a <code>/pickem/login</code>:{" "}
              <code className="rounded bg-zinc-200 px-2 py-0.5 font-mono text-base font-semibold tracking-wider text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50">
                {guestStatus.accessCode}
              </code>
              <br />
              Compartíselo a la persona — no se vuelve a mostrar acá.
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={guestStatus.type === "loading"}
          className="rounded bg-black px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {guestStatus.type === "loading" ? "Creando..." : "Crear invitado"}
        </button>
      </form>

      <div className="flex flex-col gap-2 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {reveal.type === "loaded" && reveal.revealed
            ? `Resultados revelados${reveal.revealedAt ? ` el ${new Date(reveal.revealedAt).toLocaleString("es")}` : ""}.`
            : "Los resultados todavía no están revelados."}
        </p>
        <button
          type="button"
          onClick={handleReveal}
          disabled={revealing || (reveal.type === "loaded" && reveal.revealed)}
          className="self-start rounded bg-red-700 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {revealing ? "Revelando..." : "Revelar resultados del Pick'em"}
        </button>
      </div>
    </section>
  );
}
