"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function PickemGuestLoginForm() {
  const router = useRouter();
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/pickem/guest-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_code: accessCode }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "No se pudo iniciar sesión");
      setLoading(false);
      return;
    }

    router.push("/pickem");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium text-text-secondary">
        Código de acceso a Pick&apos;em
        <input
          value={accessCode}
          onChange={(event) => setAccessCode(event.target.value)}
          className="rounded-lg border border-border-hairline bg-bg-elevated px-3 py-2 font-mono tracking-wider text-text-primary placeholder:text-text-muted focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
          placeholder="ABCD1234"
          autoFocus
          required
        />
      </label>

      {error && <p className="text-sm font-medium text-loss">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="rounded-full bg-gold px-4 py-2 font-display text-sm font-bold tracking-wide text-bg uppercase transition-colors hover:bg-gold-soft disabled:opacity-50"
      >
        {loading ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
