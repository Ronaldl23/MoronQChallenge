import type { LeaderboardEntry } from "@/lib/leaderboard";
import { Avatar } from "./Avatar";
import { TierBadge } from "./TierBadge";
import { WinrateBar } from "./WinrateBar";

const PODIUM_BADGE: Record<number, { label: string; className: string }> = {
  1: { label: "Líder", className: "bg-gold text-bg" },
  2: { label: "2do Lugar", className: "bg-silver text-bg" },
  3: { label: "3er Lugar", className: "bg-bronze text-white" },
};

export function PodiumCard({ entry }: { entry: LeaderboardEntry }) {
  const { participant, latest, rank } = entry;
  const total = latest.wins + latest.losses;
  const winPct = total > 0 ? Math.round((latest.wins / total) * 100) : 0;
  const isLeader = rank === 1;
  const badge = PODIUM_BADGE[rank];

  return (
    <div
      className={`relative flex flex-col gap-4 rounded-2xl border bg-surface p-6 ${
        isLeader
          ? "border-gold/50 shadow-[0_0_40px_-16px_var(--gold)]"
          : "border-border-hairline"
      }`}
    >
      {badge && (
        <span
          className={`absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 font-display text-xs font-bold tracking-wider uppercase ${badge.className}`}
        >
          {badge.label}
        </span>
      )}

      <div className="flex items-center gap-3">
        <span className="font-display text-2xl font-bold text-text-muted">
          #{rank}
        </span>
        <Avatar name={participant.nombre_display} size={48} />
        <div className="min-w-0">
          <p className="truncate font-semibold text-text-primary">
            {participant.nombre_display}
          </p>
          <p className="truncate text-xs text-text-secondary">
            {participant.riot_game_name}#{participant.riot_tag}
          </p>
        </div>
      </div>

      <TierBadge tier={latest.tier} division={latest.division} />

      <p className="font-display text-3xl font-bold text-text-primary">
        {latest.lp.toLocaleString("es")}{" "}
        <span className="text-sm font-medium text-text-secondary">LP</span>
      </p>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>{winPct}% Winrate</span>
          <span>
            {latest.wins}V - {latest.losses}D
          </span>
        </div>
        <WinrateBar wins={latest.wins} losses={latest.losses} />
      </div>
    </div>
  );
}
