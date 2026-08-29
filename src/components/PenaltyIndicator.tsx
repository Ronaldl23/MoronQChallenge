import type { PendingPenaltySummary } from "@/lib/leaderboard";

/**
 * Ícono "Castigos" del leaderboard (Fase 5) — visible solo si hay al menos
 * un castigo pendiente o en revisión. El detalle (campeón/Support + quién
 * lo envió) va en el `title` nativo del navegador, mismo patrón de tooltip
 * que ya usa el resto del sitio (ver MatchHistory/LastUpdated) — no hay un
 * componente de tooltip custom en este código.
 *
 * drop-shadow (no box-shadow) a propósito: sigue la silueta transparente
 * del PNG en vez de iluminar un cuadrado detrás del ícono.
 */
export function PenaltyIndicator({ penalties }: { penalties: PendingPenaltySummary[] }) {
  if (penalties.length === 0) return null;

  const title = penalties
    .map((p) =>
      p.isMoldyTrash
        ? `Mango con hongos: ${p.championName}`
        : `${p.senderName} le envió: ${p.championName}`,
    )
    .join("\n");

  return (
    <span
      title={title}
      className="relative inline-flex shrink-0 items-center"
      aria-label={`${penalties.length} ${penalties.length === 1 ? "castigo pendiente" : "castigos pendientes"}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- asset local */}
      <img
        src="/Peligro.png"
        alt=""
        className="h-5 w-5 object-contain drop-shadow-[0_0_5px_var(--loss)]"
      />
      <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-loss text-[9px] leading-none font-black text-white ring-2 ring-surface">
        {penalties.length}
      </span>
    </span>
  );
}
