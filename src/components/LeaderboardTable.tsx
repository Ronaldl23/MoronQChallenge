"use client";

import { motion } from "motion/react";
import type { LeaderboardEntry } from "@/lib/leaderboard";
import { OpggButton } from "./OpggButton";
import { ProfileIcon } from "./ProfileIcon";
import { TierBadge } from "./TierBadge";
import { TierEmblem } from "./TierEmblem";
import { Sparkline } from "./Sparkline";
import { WinrateBar } from "./WinrateBar";

export function LeaderboardTable({
  entries,
  ddragonVersion,
}: {
  entries: LeaderboardEntry[];
  ddragonVersion: string;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border-hairline bg-surface">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border-hairline text-left text-xs tracking-wider text-text-secondary uppercase">
            <th className="px-4 py-3 font-medium">#</th>
            <th className="px-4 py-3 font-medium">Jugador</th>
            <th className="px-4 py-3 font-medium">Rango</th>
            <th className="px-4 py-3 font-medium">V / D</th>
            <th className="px-4 py-3 font-medium">Racha</th>
            <th className="px-4 py-3 text-right font-medium">±LP</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const total = entry.latest.wins + entry.latest.losses;
            const winPct = total > 0 ? Math.round((entry.latest.wins / total) * 100) : 0;

            return (
            <motion.tr
              key={entry.participant.id}
              layout
              transition={{ layout: { duration: 0.4, ease: "easeInOut" } }}
              className="border-b border-border-hairline transition-colors duration-150 last:border-0 hover:bg-surface-hover"
            >
              <td className="px-4 py-3 font-display font-semibold text-text-secondary">
                {entry.rank}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <ProfileIcon
                    name={entry.participant.nombre_display}
                    avatarUrl={entry.participant.avatar_url}
                    profileIconId={entry.participant.profile_icon_id}
                    ddragonVersion={ddragonVersion}
                    size={32}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-bold text-text-primary">
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
                <div className="flex items-center gap-3">
                  <TierEmblem tier={entry.latest.tier} size={80} />
                  <TierBadge tier={entry.latest.tier} division={entry.latest.division} />
                  <span className="font-display text-base font-bold text-text-primary">
                    {entry.latest.lp.toLocaleString("es")} LP
                  </span>
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex w-28 flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs whitespace-nowrap text-text-secondary">
                    <span>{winPct}%</span>
                    <span>
                      {entry.latest.wins}V - {entry.latest.losses}D
                    </span>
                  </div>
                  <WinrateBar wins={entry.latest.wins} losses={entry.latest.losses} />
                </div>
              </td>
              <td className="px-4 py-3">
                <Sparkline points={entry.trend} id={entry.participant.id} />
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  <div className="flex flex-col items-end gap-0.5 font-display text-xs font-semibold">
                    <span className="text-win">▲ {entry.lpGained}</span>
                    <span className="text-loss">▼ {entry.lpLost}</span>
                  </div>
                  <OpggButton
                    opggUrl={entry.participant.opgg_url}
                    inGame={entry.participant.in_game}
                  />
                </div>
              </td>
            </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
