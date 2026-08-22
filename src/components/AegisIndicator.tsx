/**
 * Ícono "Aegis" del leaderboard — visible solo si el jugador tiene al menos
 * un "probable Aegis of Valor" detectado (ver src/lib/aegis.ts). Mismo
 * patrón visual que MangoCountBadge/PenaltyIndicator: ícono + badge circular
 * superpuesto en la esquina con el contador.
 *
 * drop-shadow (no box-shadow) a propósito: sigue la silueta transparente
 * del SVG en vez de iluminar un cuadrado detrás del ícono.
 */
export function AegisIndicator({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <span
      title={`${count} ${count === 1 ? "vez" : "veces"} que probablemente saltó el Aegis of Valor (estimado por LP)`}
      className="relative inline-flex shrink-0 items-center"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- asset local */}
      <img
        src="/Aegis.svg"
        alt=""
        className="h-5 w-5 object-contain drop-shadow-[0_0_5px_var(--aegis)]"
      />
      <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-aegis text-[9px] leading-none font-black text-bg ring-2 ring-surface">
        {count}
      </span>
    </span>
  );
}
