"use client";

import { useState } from "react";

/**
 * Ícono de línea/posición (Community Dragon). Se usa tanto para la línea
 * jugada en cada partida del historial (teamPosition real de match-v5)
 * como para la línea main fija del participante (main_role, definida a
 * mano en /admin) — mismo ícono, mismo componente, distinto origen del
 * dato. Si no hay laneSlug o la imagen falla al cargar, no se renderiza
 * nada — nunca rompe el layout.
 */
export function PositionIcon({ laneSlug, size = 16 }: { laneSlug: string; size?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- CDN externo (Community Dragon), necesita onError
    <img
      src={`https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-${laneSlug}.png`}
      alt=""
      width={size}
      height={size}
      className="shrink-0"
      style={{ width: size, height: size }}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
