/**
 * Ícono "Mangos" del leaderboard (Fase 5) — visible solo si el jugador
 * tiene al menos un mango sin lanzar en su inventario.
 *
 * drop-shadow (no box-shadow) a propósito: sigue la silueta transparente
 * del PNG en vez de iluminar un cuadrado detrás del ícono.
 */
export function MangoCountBadge({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <span
      title={`${count} ${count === 1 ? "mango" : "mangos"} en inventario`}
      className="relative inline-flex shrink-0 items-center"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- asset local */}
      <img
        src="/MangoHappy.png"
        alt=""
        className="h-5 w-5 object-contain drop-shadow-[0_0_5px_var(--gold)]"
      />
      <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-gold text-[9px] leading-none font-black text-bg ring-2 ring-surface">
        {count}
      </span>
    </span>
  );
}
