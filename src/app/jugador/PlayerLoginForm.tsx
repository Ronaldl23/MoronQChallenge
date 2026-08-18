"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function PlayerLoginForm() {
  const router = useRouter();
  const [loginCode, setLoginCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/jugador/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login_code: loginCode }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "No se pudo iniciar sesión");
      setLoading(false);
      return;
    }

    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Código de acceso
        <input
          value={loginCode}
          onChange={(event) => setLoginCode(event.target.value)}
          className="rounded border border-zinc-300 bg-white px-3 py-2 font-mono tracking-wider text-black uppercase dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          placeholder="ABCD1234"
          autoFocus
          required
        />
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="rounded bg-black px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {loading ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
