"use client";

import { Fragment, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { LeaderboardEntry } from "@/lib/leaderboard";
import { MatchHistory } from "./MatchHistory";
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
            const isExpanded = expandedId === entry.participant.id;

            return (
            <Fragment key={entry.participant.id}>
            <motion.tr
              layout
              transition={{ layout: { duration: 0.4, ease: "easeInOut" } }}
              className="border-b border-border-hairline transition-colors duration-150 last:border-0 hover:bg-surface-hover"
            >
              <td className="px-4 py-3 font-display font-semibold text-text-secondary">
                {entry.rank}
              </td>
              <td className="px-4 py-3">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId(isExpanded ? null : entry.participant.id)
                  }
                  aria-expanded={isExpanded}
                  className="flex w-full items-center gap-3 text-left"
                >
                  <ProfileIcon
                    name={entry.participant.nombre_display}
                    avatarUrl={entry.participant.avatar_url}
                    profileIconId={entry.participant.profile_icon_id}
                    ddragonVersion={ddragonVersion}
                    size={32}
                  />
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-[15px] font-bold text-text-primary">
                      {entry.participant.nombre_display}
                      <svg
                        viewBox="0 0 20 20"
                        className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform duration-200 ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                        fill="currentColor"
                      >
                        <path d="M5.25 7.5l4.75 5 4.75-5H5.25z" />
                      </svg>
                    </p>
                    <p className="truncate text-xs text-text-secondary">
                      {entry.participant.riot_game_name}#
                      {entry.participant.riot_tag}
                    </p>
                  </div>
                </button>
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
            <AnimatePresence>
              {isExpanded && (
                <tr>
                  <td colSpan={6} className="p-0">
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: "easeInOut" }}
                      className="overflow-hidden border-b border-border-hairline bg-bg-elevated last:border-0"
                    >
                      <MatchHistory
                        participantId={entry.participant.id}
                        ddragonVersion={ddragonVersion}
                      />
                    </motion.div>
                  </td>
                </tr>
              )}
            </AnimatePresence>
            </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
