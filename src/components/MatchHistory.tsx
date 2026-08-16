"use client";

import { useEffect, useState } from "react";
import type { MatchSummary } from "@/app/api/match-history/route";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Versión compacta de "hace X" (hace 3h, hace 2d) para que quepa en una
 * sola línea junto a la duración — la versión larga de formatRelativeTime
 * ("hace 3 horas") no entra en el ancho de esta columna.
 */
function formatRelativeShort(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;

  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
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

/** Ícono de línea/posición (Community Dragon). Si no hay laneSlug (ARAM y otros modos sin línea fija) o la imagen falla, no se renderiza nada — nunca rompe el layout. */
function PositionIcon({ laneSlug }: { laneSlug: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- CDN externo (Community Dragon), necesita onError
    <img
      src={`https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-${laneSlug}.png`}
      alt=""
      width={16}
      height={16}
      className="h-4 w-4 shrink-0"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function ItemIcon({ itemId, ddragonVersion }: { itemId: number; ddragonVersion: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <div className="h-7 w-7 shrink-0 rounded bg-white/5" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- CDN externo (Data Dragon), necesita onError
    <img
      src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/item/${itemId}.png`}
      alt=""
      width={28}
      height={28}
      className="h-7 w-7 shrink-0 rounded"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** Grilla fija de 7 slots (6 items + trinket) para que la build ocupe siempre el mismo ancho y las columnas de al lado no bailen entre filas. */
function ItemBuild({ items, ddragonVersion }: { items: number[]; ddragonVersion: string }) {
  const slots = Array.from({ length: 7 }, (_, i) => items[i] ?? null);

  return (
    <div className="grid shrink-0 grid-cols-4 gap-1.5">
      {slots.map((itemId, i) =>
        itemId ? (
          <ItemIcon key={`${itemId}-${i}`} itemId={itemId} ddragonVersion={ddragonVersion} />
        ) : (
          <div key={`empty-${i}`} className="h-7 w-7 shrink-0 rounded bg-white/5" />
        ),
      )}
    </div>
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
          <div
            key={match.matchId}
            className="flex w-full items-center justify-between gap-4 py-2.5 text-sm"
          >
            <div className="flex w-[84px] shrink-0 flex-col">
              <span
                className={`font-display text-xs font-bold uppercase ${
                  match.win ? "text-win" : "text-loss"
                }`}
              >
                {match.win ? "Victoria" : "Derrota"}
              </span>
              <span className="text-xs whitespace-nowrap text-text-muted">
                {formatDuration(match.durationSeconds)} ·{" "}
                {formatRelativeShort(new Date(match.gameEndTimestamp).toISOString())}
              </span>
            </div>

            <div className="flex w-[86px] shrink-0 items-center gap-1.5">
              <div className="relative shrink-0">
                <ChampionIcon championName={match.championName} ddragonVersion={ddragonVersion} size={38} />
                {match.laneSlug && (
                  <div className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-bg ring-1 ring-border-hairline">
                    <PositionIcon laneSlug={match.laneSlug} />
                  </div>
                )}
              </div>
              {match.opponentChampionName && (
                <>
                  <span className="text-[10px] text-text-muted">vs</span>
                  <ChampionIcon
                    championName={match.opponentChampionName}
                    ddragonVersion={ddragonVersion}
                    size={30}
                  />
                </>
              )}
            </div>

            <div className="flex w-[220px] shrink-0 items-baseline gap-2">
              <span className="shrink-0 font-semibold whitespace-nowrap text-text-primary">
                {match.kills} / <span className="text-loss">{match.deaths}</span> /{" "}
                {match.assists}
              </span>
              <span className="text-xs whitespace-nowrap text-text-secondary">
                {kda === null ? "Perfecto" : `${kda.toFixed(1)} KDA`} · {match.killParticipationPct}
                % KP · {match.cs} CS
              </span>
            </div>

            <ItemBuild items={match.items} ddragonVersion={ddragonVersion} />

            <span
              className={`w-[76px] shrink-0 text-right text-base font-semibold whitespace-nowrap ${
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
                ? "— LP"
                : `${match.lpChange > 0 ? "+" : ""}${match.lpChange} LP`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
