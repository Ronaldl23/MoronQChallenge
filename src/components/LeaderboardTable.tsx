"use client";

import { Fragment, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { LeaderboardEntry } from "@/lib/leaderboard";
import { ROLE_TO_LANE_SLUG } from "@/lib/lane";
import { DisqualifiedBadge } from "./DisqualifiedBadge";
import { MangoCountBadge } from "./MangoCountBadge";
import { MatchHistory } from "./MatchHistory";
import { OpggButton } from "./OpggButton";
import { PenaltyIndicator } from "./PenaltyIndicator";
import { PositionIcon } from "./PositionIcon";
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
  // null = orden original (por elo_score/rank, ya viene así de
  // getLeaderboard). Un solo estado para ambos headers ordenables ("Jugador"
  // y "±LP") en vez de dos independientes: activar uno pisa al otro, así
  // que el indicador de cuál está activo nunca puede quedar ambiguo (los
  // dos a la vez) — se deriva directamente de `column` más abajo, no hay
  // que sincronizar nada a mano. El # de cada fila NO cambia con ningún
  // sort — sigue reflejando la posición real por elo, es solo el ORDEN de
  // las filas lo que cambia.
  const [activeSort, setActiveSort] = useState<{
    column: "player" | "lp";
    direction: "asc" | "desc";
  } | null>(null);

  const sortedEntries = useMemo(() => {
    if (!activeSort) return entries;
    if (activeSort.column === "player") {
      const sorted = [...entries].sort((a, b) => a.rank - b.rank);
      return activeSort.direction === "asc" ? sorted : sorted.reverse();
    }
    const sorted = [...entries].sort((a, b) => a.netAvgLp - b.netAvgLp);
    return activeSort.direction === "desc" ? sorted.reverse() : sorted;
  }, [entries, activeSort]);

  function handlePlayerHeaderClick() {
    setActiveSort((prev) =>
      prev?.column === "player"
        ? {
            column: "player",
            direction: prev.direction === "asc" ? "desc" : "asc",
          }
        : { column: "player", direction: "asc" },
    );
  }

  function handleLpHeaderClick() {
    setActiveSort((prev) =>
      prev?.column === "lp"
        ? {
            column: "lp",
            direction: prev.direction === "desc" ? "asc" : "desc",
          }
        : { column: "lp", direction: "desc" },
    );
  }

  return (
    <div className="min-w-0 overflow-x-auto rounded-2xl border border-border-hairline bg-surface">
      {/*
        Racha y ±LP se ocultan en mobile (hidden sm:table-cell): son las
        columnas menos esenciales, y sacarlas de encima deja que #, Jugador,
        Rango y V/D entren sin necesitar scroll horizontal. sm:min-w-[720px]
        solo aplica el ancho mínimo denso en desktop; en mobile el ancho lo
        define el contenido de las columnas visibles.
      */}
      <table className="w-full sm:min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border-hairline text-left text-xs tracking-wider text-text-secondary uppercase">
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 font-medium">
              <button
                type="button"
                onClick={handlePlayerHeaderClick}
                className="inline-flex items-center gap-1 text-text-secondary transition-colors hover:text-text-primary"
                title="Ordenar por posición original del ranking"
              >
                Jugador
                <SortIndicator
                  direction={
                    activeSort?.column === "player"
                      ? activeSort.direction
                      : null
                  }
                />
              </button>
            </th>
            <th className="px-4 py-2 font-medium">Rango</th>
            <th className="px-4 py-2 font-medium">V / D</th>
            <th className="hidden px-4 py-2 font-medium sm:table-cell">
              Racha
            </th>
            <th className="px-4 py-2 text-center font-medium">Mangos</th>
            <th className="px-4 py-2 text-center font-medium">Castigos</th>
            {/* pr-16 en vez de px-4: nudge a la izquierda respecto al contenido de abajo (▲/▼ + botón OP.GG), que visualmente "pesa" más hacia la derecha que el label solo. */}
            <th className="py-2 pr-16 pl-4 text-right font-medium">
              <button
                type="button"
                onClick={handleLpHeaderClick}
                className="inline-flex items-center gap-1 text-text-secondary transition-colors hover:text-text-primary"
                title="Ordenar por promedio neto de LP por partida"
              >
                ±LP
                <SortIndicator
                  direction={
                    activeSort?.column === "lp" ? activeSort.direction : null
                  }
                />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedEntries.map((entry) => {
            const total = entry.latest.wins + entry.latest.losses;
            const winPct =
              total > 0 ? Math.round((entry.latest.wins / total) * 100) : 0;
            const isExpanded = expandedId === entry.participant.id;

            return (
              <Fragment key={entry.participant.id}>
                <motion.tr
                  layout
                  transition={{ layout: { duration: 0.4, ease: "easeInOut" } }}
                  className="border-b border-border-hairline transition-colors duration-150 last:border-0 hover:bg-surface-hover"
                >
                  <td className="px-4 py-2 font-display font-semibold text-text-secondary">
                    {entry.rank}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId(isExpanded ? null : entry.participant.id)
                      }
                      aria-expanded={isExpanded}
                      className="flex w-full items-center gap-3 text-left"
                    >
                      <div className="relative shrink-0">
                        <ProfileIcon
                          name={entry.participant.nombre_display}
                          avatarUrl={entry.participant.avatar_url}
                          profileIconId={entry.participant.profile_icon_id}
                          ddragonVersion={ddragonVersion}
                          size={32}
                        />
                        {entry.isDisqualified && <DisqualifiedBadge />}
                      </div>
                      <div className="min-w-0">
                        <p
                          className={`flex items-center gap-1.5 truncate text-[15px] font-bold ${entry.isDisqualified ? "text-text-muted" : "text-text-primary"}`}
                        >
                          {entry.participant.nombre_display}
                          {entry.participant.main_role && (
                            <PositionIcon
                              laneSlug={
                                ROLE_TO_LANE_SLUG[entry.participant.main_role]
                              }
                              size={14}
                            />
                          )}
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
                  <td className="px-4 py-2">
                    {/*
                  Mobile: badge y LP apilados, sin el emblema de 80px (demasiado
                  grande para 390px de ancho — es el que más empuja el overflow
                  horizontal). sm:contents "desarma" este wrapper para que sus
                  hijos vuelvan a ser hijos directos del flex de abajo, quedando
                  desktop pixel a pixel igual que antes (emblema + badge + LP en
                  una sola línea).
                */}
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                      <div className="flex items-center gap-2 sm:contents">
                        <span className="hidden sm:inline-flex">
                          <TierEmblem tier={entry.latest.tier} size={80} />
                        </span>
                        <TierBadge
                          tier={entry.latest.tier}
                          division={entry.latest.division}
                        />
                      </div>
                      <span className="font-display text-base font-bold text-text-primary">
                        {entry.latest.lp.toLocaleString("es")} LP
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex w-28 flex-col gap-1.5">
                      <div className="flex items-center justify-between text-xs whitespace-nowrap text-text-secondary">
                        <span>{winPct}%</span>
                        <span>
                          {entry.latest.wins}V - {entry.latest.losses}D
                        </span>
                      </div>
                      <WinrateBar
                        wins={entry.latest.wins}
                        losses={entry.latest.losses}
                      />
                    </div>
                  </td>
                  <td className="hidden px-4 py-2 sm:table-cell">
                    <Sparkline points={entry.trend} id={entry.participant.id} />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <MangoCountBadge count={entry.mangoCount} />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <PenaltyIndicator penalties={entry.pendingPenalties} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* ▲▼LP se oculta en mobile: es un detalle secundario del V/D que ya se ve al lado; el botón de OP.GG (estado en vivo) se mantiene siempre visible. */}
                      <div
                        className="hidden flex-col items-end gap-0.5 font-display text-xs font-semibold sm:flex"
                        title="Promedio de LP por partida en los últimos 7 días: ganado por victoria (▲) y perdido por derrota (▼)"
                      >
                        <span className="text-win">▲ {entry.avgLpGained}</span>
                        <span className="text-loss">▼ {entry.avgLpLost}</span>
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
                      <td colSpan={8} className="p-0">
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

/** Mismo path del chevron que ya usa la fila del jugador para expandir/colapsar — apagado y quieto cuando no está ordenando, dorado y apuntando según la dirección activa cuando sí. */
function SortIndicator({ direction }: { direction: "asc" | "desc" | null }) {
  if (!direction) {
    return (
      <svg
        viewBox="0 0 20 20"
        className="h-3 w-3 shrink-0 text-text-muted"
        fill="currentColor"
      >
        <path d="M5.25 7.5l4.75 5 4.75-5H5.25z" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 20 20"
      className={`h-3 w-3 shrink-0 text-gold transition-transform duration-150 ${
        direction === "asc" ? "rotate-180" : ""
      }`}
      fill="currentColor"
    >
      <path d="M5.25 7.5l4.75 5 4.75-5H5.25z" />
    </svg>
  );
}
