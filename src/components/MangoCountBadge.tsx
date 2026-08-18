/** Ícono "Mangos" del leaderboard (Fase 5) — visible solo si el jugador tiene al menos un mango sin lanzar en su inventario. */
export function MangoCountBadge({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <span
      title={`${count} ${count === 1 ? "mango" : "mangos"} en inventario`}
      className="inline-flex shrink-0 items-center gap-0.5"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- asset local */}
      <img src="/MangoHappy.png" alt="" className="h-5 w-5 object-contain" />
      {count > 1 && (
        <span className="font-display text-[10px] font-bold text-text-secondary">x{count}</span>
      )}
    </span>
  );
}
