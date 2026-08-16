"use client";

import { useEffect, useState } from "react";
import type { MatchSummary } from "@/app/api/match-history/route";
import { formatRelativeTime } from "@/lib/format";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function ChampionIcon({
  championName,
  ddragonVersion,
  size = 32,
}: {
  championName: string;
  ddragonVersion: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="shrink-0 rounded bg-white/10" style={{ width: size, height: size }} />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- CDN externo (Data Dragon), necesita onError
    <img
      src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${championName}.png`}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded"
      style={{ width: size, height: size }}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function ItemIcon({ itemId, ddragonVersion }: { itemId: number; ddragonVersion: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <div className="h-5 w-5 shrink-0 rounded bg-white/5" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- CDN externo (Data Dragon), necesita onError
    <img
      src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/item/${itemId}.png`}
      alt=""
      width={20}
      height={20}
      className="h-5 w-5 shrink-0 rounded"
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
          <div key={match.matchId} className="flex flex-wrap items-center gap-4 py-2.5 text-sm">
            <div className="flex w-24 shrink-0 flex-col">
              <span
                className={`font-display text-xs font-bold uppercase ${
                  match.win ? "text-win" : "text-loss"
                }`}
              >
                {match.win ? "Victoria" : "Derrota"}
              </span>
              <span className="text-xs text-text-muted">
                {formatRelativeTime(new Date(match.gameEndTimestamp).toISOString())}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <ChampionIcon championName={match.championName} ddragonVersion={ddragonVersion} />
              <span className="text-text-primary">{match.championName}</span>
            </div>

            {match.opponentChampionName && (
              <div className="flex items-center gap-1.5 text-text-secondary">
                <span className="text-xs">vs</span>
                <ChampionIcon
                  championName={match.opponentChampionName}
                  ddragonVersion={ddragonVersion}
                  size={24}
                />
              </div>
            )}

            <div className="flex w-28 shrink-0 flex-col">
              <span className="font-semibold text-text-primary">
                {match.kills}/{match.deaths}/{match.assists}
              </span>
              <span className="text-xs text-text-secondary">
                {kda === null ? "KDA perfecto" : `${kda.toFixed(2)} KDA`}
              </span>
            </div>

            <div className="flex w-[168px] shrink-0 flex-wrap gap-1">
              {match.items.length > 0 ? (
                match.items.map((itemId, i) => (
                  <ItemIcon key={`${itemId}-${i}`} itemId={itemId} ddragonVersion={ddragonVersion} />
                ))
              ) : (
                <span className="text-xs text-text-muted">Sin build</span>
              )}
            </div>

            <span className="w-14 shrink-0 text-xs text-text-secondary">
              {formatDuration(match.durationSeconds)}
            </span>

            <span
              className={`ml-auto shrink-0 text-xs font-semibold ${
                match.lpChange === null
                  ? "text-text-muted"
                  : match.lpChange > 0
                    ? "text-win"
                    : "text-loss"
              }`}
              title={
                match.lpChange === null
                  ? "No se pudo estimar el LP de esta partida (Riot no lo expone; puede haber más de una partida entre dos capturas de rango, o un cambio de división en el medio)"
                  : "Estimado cruzando la hora de la partida con nuestro historial de rango, no es un valor oficial de Riot"
              }
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
