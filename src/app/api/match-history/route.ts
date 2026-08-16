import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { platformToContinent } from "@/lib/riot";
import { ROLE_TO_LANE_SLUG, type MainRole } from "@/lib/lane";

export const dynamic = "force-dynamic";

const RANKED_SOLO_QUEUE_ID = 420;
const MATCH_COUNT = 10;

interface RiotMatchParticipant {
  puuid: string;
  win: boolean;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  teamId: number;
  teamPosition: string;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  item0: number;
  item1: number;
  item2: number;
  item3: number;
  item4: number;
  item5: number;
  item6: number;
}

interface RiotMatch {
  info: {
    gameDuration: number;
    gameEndTimestamp: number;
    participants: RiotMatchParticipant[];
  };
}

export interface MatchSummary {
  matchId: string;
  win: boolean;
  championName: string;
  /** Slug para el ícono de posición de Community Dragon. Null si Riot no la reportó (ARAM y otros modos sin línea fija). */
  laneSlug: string | null;
  opponentChampionName: string | null;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  /** % de los kills del equipo en los que participó (kills + assists propios / kills totales del equipo). */
  killParticipationPct: number;
  items: number[];
  durationSeconds: number;
  gameEndTimestamp: number;
  /**
   * El LP ganado/perdido no viene en match-v5 — Riot no lo expone por
   * partida en ningún campo. Se estima cruzando la hora de fin de la
   * partida contra nuestro propio historial de snapshots (el cron corre
   * cada 15 min): si hay un snapshot justo antes y otro justo después,
   * ambos del mismo tier/división, y esta es la ÚNICA partida que cae en
   * ese hueco, la diferencia de LP entre esos dos snapshots es ese
   * partido. Si hubo más de una partida en el mismo hueco de 15 min, o
   * cambió de tier/división en el medio, no se puede saber cuál se llevó
   * qué — se deja null en vez de adivinar.
   */
  lpChange: number | null;
}

interface SnapshotRow {
  tier: string;
  division: string | null;
  lp: number;
  created_at: string;
}

function correlateLpChanges(
  matches: { matchId: string; gameEndTimestamp: number }[],
  snapshots: SnapshotRow[],
): Map<string, number> {
  const result = new Map<string, number>();
  if (snapshots.length < 2) return result;

  // Comparar como epoch numérico, no como string: Postgres puede devolver
  // created_at con offset "+00:00" en vez del "Z" que arma toISOString(),
  // y una comparación de strings entre esos dos formatos no es confiable.
  const snapshotTimes = snapshots.map((s) => new Date(s.created_at).getTime());

  // matchId -> índice del primer snapshot tomado en o después de que terminó esa partida.
  const bracketOf = new Map<string, number>();
  for (const { matchId, gameEndTimestamp } of matches) {
    const nextIdx = snapshotTimes.findIndex((t) => t >= gameEndTimestamp);
    if (nextIdx <= 0) continue; // sin snapshot "antes" o "después" disponible todavía
    bracketOf.set(matchId, nextIdx);
  }

  // Si dos o más partidas caen en el mismo hueco entre snapshots, no hay
  // forma de repartir el delta entre ellas — se descartan todas del grupo.
  const countByBracket = new Map<number, number>();
  for (const idx of bracketOf.values()) {
    countByBracket.set(idx, (countByBracket.get(idx) ?? 0) + 1);
  }

  for (const [matchId, idx] of bracketOf) {
    if (countByBracket.get(idx) !== 1) continue;

    const next = snapshots[idx];
    const prev = snapshots[idx - 1];
    if (prev.tier !== next.tier || prev.division !== next.division) continue;

    result.set(matchId, next.lp - prev.lp);
  }

  return result;
}

/**
 * Historial reciente bajo demanda: se llama solo cuando el usuario abre el
 * acordeón de un jugador puntual, nunca desde /api/update-rankings ni
 * precargado para todos los participantes — cada apertura son ~11 llamadas
 * a Riot (1 de ids + hasta 10 de detalle), y no queremos multiplicar eso
 * por todo el leaderboard en cada carga de página.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const participantId = url.searchParams.get("participantId");
  if (!participantId) {
    return NextResponse.json({ error: "Falta participantId" }, { status: 400 });
  }

  const riotApiKey = process.env.RIOT_API_KEY;
  if (!riotApiKey) {
    return NextResponse.json(
      { error: "RIOT_API_KEY no está configurada" },
      { status: 500 },
    );
  }

  const supabase = createAdminClient();
  const { data: participant, error } = await supabase
    .from("participants")
    .select("puuid, region_platform")
    .eq("id", participantId)
    .single();

  if (error || !participant) {
    return NextResponse.json({ error: "Participante no encontrado" }, { status: 404 });
  }

  const continent = platformToContinent(participant.region_platform);
  if (!continent) {
    return NextResponse.json(
      { error: `region_platform desconocida: ${participant.region_platform}` },
      { status: 400 },
    );
  }

  let matchIds: string[];
  try {
    const idsRes = await fetch(
      `https://${continent}.api.riotgames.com/lol/match/v5/matches/by-puuid/${participant.puuid}/ids?start=0&count=${MATCH_COUNT}&queue=${RANKED_SOLO_QUEUE_ID}`,
      {
        headers: { "X-Riot-Token": riotApiKey },
        // La lista de partidas cambia con cada game nueva, pero no vale la
        // pena pedirla de nuevo si el jugador cierra y reabre el acordeón
        // en la misma sesión de scroll.
        next: { revalidate: 120 },
      },
    );
    if (!idsRes.ok) {
      return NextResponse.json(
        { error: `Riot API respondió ${idsRes.status} al pedir la lista de partidas` },
        { status: 502 },
      );
    }
    matchIds = (await idsRes.json()) as string[];
  } catch {
    return NextResponse.json(
      { error: "No se pudo contactar a la API de Riot" },
      { status: 502 },
    );
  }

  const matches: Omit<MatchSummary, "lpChange">[] = [];

  for (const matchId of matchIds) {
    try {
      const matchRes = await fetch(
        `https://${continent}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
        {
          headers: { "X-Riot-Token": riotApiKey },
          // Una partida terminada no cambia nunca: cachear agresivo, sobre
          // todo porque varios jugadores del leaderboard pueden compartir
          // la misma partida y así evitamos pedirla varias veces.
          next: { revalidate: 86400 },
        },
      );
      if (!matchRes.ok) continue;

      const match = (await matchRes.json()) as RiotMatch;
      const mp = match.info.participants.find((p) => p.puuid === participant.puuid);
      if (!mp) continue;

      const opponent = mp.teamPosition
        ? match.info.participants.find(
            (p) => p.teamId !== mp.teamId && p.teamPosition === mp.teamPosition,
          )
        : undefined;

      const items = [mp.item0, mp.item1, mp.item2, mp.item3, mp.item4, mp.item5, mp.item6].filter(
        (id) => id !== 0,
      );

      const teamKills = match.info.participants
        .filter((p) => p.teamId === mp.teamId)
        .reduce((sum, p) => sum + p.kills, 0);
      const killParticipationPct =
        teamKills > 0 ? Math.round(((mp.kills + mp.assists) / teamKills) * 100) : 0;

      matches.push({
        matchId,
        win: mp.win,
        championName: mp.championName,
        laneSlug: ROLE_TO_LANE_SLUG[mp.teamPosition as MainRole] ?? null,
        opponentChampionName: opponent?.championName ?? null,
        kills: mp.kills,
        deaths: mp.deaths,
        assists: mp.assists,
        cs: mp.totalMinionsKilled + mp.neutralMinionsKilled,
        killParticipationPct,
        items,
        durationSeconds: match.info.gameDuration,
        gameEndTimestamp: match.info.gameEndTimestamp,
      });
    } catch {
      // Una partida individual falló al traerse — se omite, no rompe el resto.
    }

    // Rate limit de Riot: mismo criterio que /api/update-rankings.
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  let lpChanges = new Map<string, number>();
  if (matches.length > 0) {
    const oldestGameEnd = Math.min(...matches.map((m) => m.gameEndTimestamp));
    const snapshotsSince = new Date(oldestGameEnd - 30 * 60 * 1000).toISOString();

    const { data: snapshots } = await supabase
      .from("snapshots")
      .select("tier, division, lp, created_at")
      .eq("participant_id", participantId)
      .gte("created_at", snapshotsSince)
      .order("created_at", { ascending: true });

    if (snapshots) {
      lpChanges = correlateLpChanges(matches, snapshots);
    }
  }

  const withLp: MatchSummary[] = matches.map((match) => ({
    ...match,
    lpChange: lpChanges.get(match.matchId) ?? null,
  }));

  return NextResponse.json({ matches: withLp });
}
