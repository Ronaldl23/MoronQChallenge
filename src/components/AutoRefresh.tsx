"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Refresca los Server Components de la página cada `intervalMs` (sin recarga
 * completa), para que el leaderboard recoja snapshots nuevos y las filas se
 * reordenen con animación en vez de necesitar un F5 manual.
 */
export function AutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
