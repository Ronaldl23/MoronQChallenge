"use client";

import { useEffect, useState } from "react";
import type { MatchSummary } from "@/app/api/match-history/route";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function ChampionIcon({
  championName,
  ddragonVersion,
}: {
  championName: string;
  ddragonVersion: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <div className="h-8 w-8 shrink-0 rounded bg-white/10" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- CDN externo (Data Dragon), necesita onError
    <img
      src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${championName}.png`}
      alt=""
      width={32}
      height={32}
      className="h-8 w-8 shrink-0 rounded"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

type Status =
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "ready"; matches: MatchSummary[] };

/**
 * Historial de las últimas partidas de SoloQ, cargado bajo demanda cuando
 * el acordeón se abre (ver LeaderboardTable) — nunca precargado para todo
 * el leaderboard de una vez.
 */
export function MatchHistory({
  participantId,
  ddragonVersion,
}: {
  participantId: string;
  ddragonVersion: string;
}) {
  const [status, setStatus] = useState<Status>({ type: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/match-history?participantId=${participantId}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setStatus({
            type: "error",
            message: body?.error ?? "No se pudo cargar el historial",
          });
          return;
        }
        setStatus({ type: "ready", matches: body.matches as MatchSummary[] });
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({ type: "error", message: "No se pudo cargar el historial" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [participantId]);

  if (status.type === "loading") {
    return (
      <div className="flex items-center gap-2 px-6 py-4 text-sm text-text-secondary">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-text-secondary/30 border-t-text-secondary" />
        Cargando historial...
      </div>
    );
  }

  if (status.type === "error") {
    return <p className="px-6 py-4 text-sm text-loss">{status.message}</p>;
  }

  if (status.matches.length === 0) {
    return (
      <p className="px-6 py-4 text-sm text-text-secondary">
        Sin partidas de SoloQ recientes.
      </p>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border-hairline px-4 py-2">
      {status.matches.map((match) => {
        const kda =
          match.deaths === 0
            ? null
            : (match.kills + match.assists) / match.deaths;

        return (
          <div key={match.matchId} className="flex flex-wrap items-center gap-4 py-2 text-sm">
            <span
              className={`w-16 shrink-0 font-display text-xs font-bold uppercase ${
                match.win ? "text-win" : "text-loss"
              }`}
            >
              {match.win ? "Victoria" : "Derrota"}
            </span>

            <div className="flex w-36 shrink-0 items-center gap-2">
              <ChampionIcon championName={match.championName} ddragonVersion={ddragonVersion} />
              <span className="truncate text-text-primary">{match.championName}</span>
            </div>

            <div className="flex w-28 shrink-0 flex-col">
              <span className="font-semibold text-text-primary">
                {match.kills}/{match.deaths}/{match.assists}
              </span>
              <span className="text-xs text-text-secondary">
                {kda === null ? "KDA perfecto" : `${kda.toFixed(2)} KDA`}
              </span>
            </div>

            <span className="w-14 shrink-0 text-xs text-text-secondary">
              {formatDuration(match.durationSeconds)}
            </span>

            <span
              className="ml-auto shrink-0 text-xs text-text-muted"
              title="Riot no expone el LP ganado o perdido por partida en su API pública"
            >
              {match.lpChange === null
                ? "—"
                : `${match.lpChange > 0 ? "+" : ""}${match.lpChange} LP`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
