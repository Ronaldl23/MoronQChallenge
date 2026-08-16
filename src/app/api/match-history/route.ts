import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { platformToContinent } from "@/lib/riot";

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
}

interface RiotMatch {
  info: {
    gameDuration: number;
    participants: RiotMatchParticipant[];
  };
}

export interface MatchSummary {
  matchId: string;
  win: boolean;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  durationSeconds: number;
  /**
   * El LP ganado/perdido no viene en match-v5 — Riot no expone LP por
   * partida en ningún endpoint público. Se deja el campo para el día que
   * haya una forma confiable de calcularlo; por ahora siempre es null y la
   * UI lo muestra como "—".
   */
  lpChange: number | null;
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

  const matches: MatchSummary[] = [];

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

      matches.push({
        matchId,
        win: mp.win,
        championName: mp.championName,
        kills: mp.kills,
        deaths: mp.deaths,
        assists: mp.assists,
        durationSeconds: match.info.gameDuration,
        lpChange: null,
      });
    } catch {
      // Una partida individual falló al traerse — se omite, no rompe el resto.
    }

    // Rate limit de Riot: mismo criterio que /api/update-rankings.
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  return NextResponse.json({ matches });
}
