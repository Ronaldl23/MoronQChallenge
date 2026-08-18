"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Refresca los Server Components de la página cada `intervalMs` (sin recarga
 * completa), para que el leaderboard recoja snapshots nuevos y las filas se
 * reordenen con animación en vez de necesitar un F5 manual.
 *
 * También refresca al instante cuando la pestaña vuelve a estar visible —
 * los navegadores throttlean o directamente pausan setInterval en pestañas
 * en segundo plano/minimizadas, así que una pestaña dejada abierta muchas
 * horas puede quedarse mostrando datos viejos aunque el intervalo siga
 * "corriendo" en teoría. Volver a la pestaña fuerza un dato fresco de una,
 * sin esperar al próximo tick del intervalo.
 */
export function AutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [router, intervalMs]);

  return null;
}
