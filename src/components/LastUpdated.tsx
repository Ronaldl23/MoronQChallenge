"use client";

import { useEffect, useState } from "react";
import { formatRelativeTime } from "@/lib/format";

export function LastUpdated({ iso }: { iso: string | null }) {
  // null en server y en el primer render del cliente por igual — el texto
  // relativo depende de "ahora", así que solo se calcula después de montar
  // (mismo patrón que el Countdown, evita un mismatch de hidratación).
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!iso) return;

    // Defiere el primer cálculo fuera del cuerpo síncrono del efecto (evita
    // el warning de setState-en-efecto) sin esperar los 30s del intervalo.
    const immediate = setTimeout(() => setLabel(formatRelativeTime(iso)), 0);
    const id = setInterval(() => setLabel(formatRelativeTime(iso)), 30_000);
    return () => {
      clearTimeout(immediate);
      clearInterval(id);
    };
  }, [iso]);

  if (!iso || !label) return null;

  return (
    // title = ISO crudo que llegó del servidor, para diagnosticar sin DevTools
    // (hover en desktop). TEMPORAL mientras se investiga el reporte de
    // timestamp desactualizado — sacar una vez confirmado, ver AGENTS.md.
    <span
      title={`iso crudo: ${iso}`}
      className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-win opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-win" />
      </span>
      Actualizado {label}
    </span>
  );
}
