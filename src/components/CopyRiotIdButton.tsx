"use client";

import { useState, type MouseEvent } from "react";

/**
 * Ícono de copiar al lado del Riot ID (nombre#tag), en la tabla y en las
 * tarjetas del podio. stopPropagation en el click a propósito: en la tabla
 * vive dentro de la misma celda que el botón que expande/colapsa el
 * historial de partidas de la fila — sin esto, un click acá terminaría
 * también abriendo/cerrando esa fila.
 */
export function CopyRiotIdButton({ riotId }: { riotId: string }) {
  const [copied, setCopied] = useState(false);

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(riotId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Sin permiso de portapapeles (contexto no seguro, navegador viejo,
      // etc.) no hay nada más que hacer del lado del cliente — se queda sin
      // la confirmación visual, no rompe el resto de la fila.
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={copied ? "Riot ID copiado" : `Copiar Riot ID ${riotId}`}
      title={copied ? "¡Copiado!" : "Copiar Riot ID"}
      className="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary"
    >
      {copied ? (
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-win" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M16.704 5.29a1 1 0 0 1 .006 1.415l-7.5 7.5a1 1 0 0 1-1.414 0l-3.5-3.5a1 1 0 1 1 1.414-1.414l2.793 2.792 6.793-6.793a1 1 0 0 1 1.408 0Z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg
          viewBox="0 0 20 20"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="7" y="7" width="10" height="10" rx="1.5" />
          <path d="M4.5 12.5h-1a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1" />
        </svg>
      )}
    </button>
  );
}
