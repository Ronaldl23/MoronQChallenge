"use client";

import { motion } from "motion/react";
import type { LeaderboardEntry } from "@/lib/leaderboard";
import { Avatar } from "./Avatar";
import { TierBadge } from "./TierBadge";
import { TierEmblem } from "./TierEmblem";
import { WinrateBar } from "./WinrateBar";

const RANK_STYLE: Record<
  number,
  {
    badge: { label: string; className: string };
    border: string;
    glow: string;
    tint: string;
  }
> = {
  1: {
    badge: { label: "Líder", className: "bg-gold text-bg" },
    border: "border-gold/60",
    glow: "shadow-[0_0_70px_-16px_var(--gold)]",
    tint: "bg-[radial-gradient(120%_100%_at_50%_-20%,rgba(217,164,65,0.20),transparent_65%)]",
  },
  2: {
    badge: { label: "2do Lugar", className: "bg-silver text-bg" },
    border: "border-silver/35",
    glow: "shadow-[0_0_34px_-18px_var(--silver)]",
    tint: "bg-[radial-gradient(120%_100%_at_50%_-20%,rgba(188,196,204,0.13),transparent_65%)]",
  },
  3: {
    badge: { label: "3er Lugar", className: "bg-bronze text-white" },
    border: "border-bronze/35",
    glow: "shadow-[0_0_34px_-18px_var(--bronze)]",
    tint: "bg-[radial-gradient(120%_100%_at_50%_-20%,rgba(193,121,63,0.15),transparent_65%)]",
  },
};

export function PodiumCard({ entry }: { entry: LeaderboardEntry }) {
  const { participant, latest, rank } = entry;
  const total = latest.wins + latest.losses;
  const winPct = total > 0 ? Math.round((latest.wins / total) * 100) : 0;
  const isLeader = rank === 1;
  const style = RANK_STYLE[rank];

  return (
    <motion.div
      layout
      transition={{ layout: { duration: 0.4, ease: "easeInOut" } }}
      className={`relative rounded-2xl border bg-surface ${style.border} ${style.glow} ${isLeader ? "sm:-translate-y-2" : ""}`}
    >
      {/*
        El badge "Líder"/etc. sobresale del borde superior a propósito
        (-top-3), así que vive FUERA del contenedor con overflow-hidden de
        abajo — si no, ese overflow-hidden lo recorta a la mitad.
      */}
      {style.badge && (
        <span
          className={`absolute -top-3 left-1/2 z-10 -translate-x-1/2 rounded-full px-3 py-1 font-display text-xs font-bold tracking-wider uppercase ${style.badge.className}`}
        >
          {style.badge.label}
        </span>
      )}

      <div className="relative flex flex-col gap-4 overflow-hidden rounded-2xl p-6">
        <div className={`pointer-events-none absolute inset-0 ${style.tint}`} aria-hidden />

        <div className="relative flex items-center gap-3">
          <span className="font-display text-2xl font-bold text-text-muted">
            #{rank}
          </span>
          <Avatar name={participant.nombre_display} size={48} />
          <div className="min-w-0">
            <p className="truncate text-lg font-bold text-text-primary">
              {participant.nombre_display}
            </p>
            <p className="truncate text-xs text-text-secondary">
              {participant.riot_game_name}#{participant.riot_tag}
            </p>
          </div>
        </div>

        <div className="relative flex items-center gap-3">
          <TierEmblem tier={latest.tier} size={80} />
          <TierBadge tier={latest.tier} division={latest.division} />
        </div>

        <p className="relative font-display leading-none font-bold text-text-primary">
          <span className={isLeader ? "text-5xl" : "text-4xl"}>
            {latest.lp.toLocaleString("es")}
          </span>{" "}
          <span className="text-sm font-medium text-text-secondary">LP</span>
        </p>

        <div className="relative flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>{winPct}% Winrate</span>
            <span>
              {latest.wins}V - {latest.losses}D
            </span>
          </div>
          <WinrateBar wins={latest.wins} losses={latest.losses} />
        </div>
      </div>
    </motion.div>
  );
}
