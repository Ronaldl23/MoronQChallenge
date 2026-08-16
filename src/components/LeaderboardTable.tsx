import type { LeaderboardEntry } from "@/lib/leaderboard";
import { Avatar } from "./Avatar";
import { TierBadge } from "./TierBadge";
import { Sparkline } from "./Sparkline";

export function LeaderboardTable({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border-hairline bg-surface">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border-hairline text-left text-xs tracking-wider text-text-secondary uppercase">
            <th className="px-4 py-3 font-medium">#</th>
            <th className="px-4 py-3 font-medium">Jugador</th>
            <th className="px-4 py-3 font-medium">Elo</th>
            <th className="px-4 py-3 font-medium">V / D</th>
            <th className="px-4 py-3 font-medium">Racha</th>
            <th className="px-4 py-3 text-right font-medium">±LP</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.participant.id}
              className="border-b border-border-hairline last:border-0 hover:bg-surface-hover"
            >
              <td className="px-4 py-3 font-display font-semibold text-text-secondary">
                {entry.rank}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={entry.participant.nombre_display} size={32} />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text-primary">
                      {entry.participant.nombre_display}
                    </p>
                    <p className="truncate text-xs text-text-secondary">
                      {entry.participant.riot_game_name}#
                      {entry.participant.riot_tag}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <TierBadge tier={entry.latest.tier} division={entry.latest.division} />
                  <span className="font-display font-semibold text-text-primary">
                    {entry.latest.elo_score.toLocaleString("es")}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-text-secondary">
                {entry.latest.wins}V - {entry.latest.losses}D
              </td>
              <td className="px-4 py-3">
                <Sparkline points={entry.trend} />
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex flex-col items-end gap-0.5 font-display text-xs font-semibold">
                  <span className="text-win">▲ {entry.lpGained}</span>
                  <span className="text-loss">▼ {entry.lpLost}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
