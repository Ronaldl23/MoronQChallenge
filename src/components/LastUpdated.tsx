"use client";

import { useEffect, useState } from "react";

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) return "hace instantes";
  if (minutes === 1) return "hace 1 minuto";
  if (minutes < 60) return `hace ${minutes} minutos`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "hace 1 hora";
  if (hours < 24) return `hace ${hours} horas`;

  const days = Math.floor(hours / 24);
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}

export function LastUpdated({ iso }: { iso: string | null }) {
  // null en server y en el primer render del cliente por igual — el texto
  // relativo depende de "ahora", así que solo se calcula después de montar
  // (mismo patrón que el Countdown, evita un mismatch de hidratación).
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!iso) return;

    // Defiere el primer cálculo fuera del cuerpo síncrono del efecto (evita
    // el warning de setState-en-efecto) sin esperar los 30s del intervalo.
    const immediate = setTimeout(() => setLabel(formatRelative(iso)), 0);
    const id = setInterval(() => setLabel(formatRelative(iso)), 30_000);
    return () => {
      clearTimeout(immediate);
      clearInterval(id);
    };
  }, [iso]);

  if (!iso || !label) return null;

  return (
    <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-win opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-win" />
      </span>
      Actualizado {label}
    </span>
  );
}
