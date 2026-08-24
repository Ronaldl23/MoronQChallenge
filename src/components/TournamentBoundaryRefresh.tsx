"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** setTimeout desborda y dispara de inmediato pasado esto (~24.8 días, límite de un entero de 32 bits) — si el instante todavía está más lejos, no se programa (un reload normal antes de esa fecha ya trae el estado correcto). */
const MAX_TIMEOUT_MS = 2_147_483_000;

/**
 * Sin salida visual — programa un `router.refresh()` EXACTO para el
 * instante `atIso`, si todavía no pasó. Pensado para páginas server-
 * renderizadas cuyo contenido depende de "¿ya arrancó/terminó el
 * torneo?" (ej. /pickem, bloqueado a partir de TOURNAMENT_START_DATE):
 * sin esto, alguien que deja la pestaña abierta ANTES del instante ve el
 * estado viejo (tablero editable) indefinidamente hasta que recargue a
 * mano, aunque el countdown del header sí siga tickeando en tiempo real
 * — un desfase real entre "lo que dice el countdown" y "lo que muestra
 * la página", justo en el momento que más importa. router.refresh()
 * vuelve a pedir el árbol de Server Components (re-evalúa
 * isPickemLocked() con la hora real del servidor), así que el cambio de
 * vista queda tan exacto como esa comparación server-side, no aproximado
 * por un sondeo cada tantos segundos.
 */
export function TournamentBoundaryRefresh({ atIso }: { atIso: string }) {
  const router = useRouter();

  useEffect(() => {
    const msUntil = new Date(atIso).getTime() - Date.now();
    if (msUntil <= 0 || msUntil > MAX_TIMEOUT_MS) return;
    const id = setTimeout(() => router.refresh(), msUntil);
    return () => clearTimeout(id);
  }, [atIso, router]);

  return null;
}
