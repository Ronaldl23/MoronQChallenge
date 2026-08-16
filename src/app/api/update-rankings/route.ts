import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateEloScore } from "@/lib/elo";
import type { RankDivision, RankTier } from "@/types/database";

export const dynamic = "force-dynamic";

interface RiotLeagueEntry {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
}

interface RiotSummoner {
  profileIconId: number;
}

const APEX_TIERS = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;

  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const riotApiKey = process.env.RIOT_API_KEY;
  if (!riotApiKey) {
    return NextResponse.json(
      { error: "RIOT_API_KEY no está configurada" },
      { status: 500 },
    );
  }

  const supabase = createAdminClient();
  const { data: participants, error } = await supabase
    .from("participants")
    .select("id, puuid, region_platform, nombre_display");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{
    participant_id: string;
    nombre_display: string;
    status: string;
  }> = [];

  for (const participant of participants ?? []) {
    const platform = participant.region_platform.toLowerCase();

    // Ícono de invocador: best-effort, independiente del resultado de
    // league-v4 — un jugador unranked igual tiene un ícono que mostrar.
    try {
      const summonerRes = await fetch(
        `https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${participant.puuid}`,
        { headers: { "X-Riot-Token": riotApiKey }, cache: "no-store" },
      );
      if (summonerRes.ok) {
        const summoner = (await summonerRes.json()) as RiotSummoner;
        await supabase
          .from("participants")
          .update({ profile_icon_id: summoner.profileIconId })
          .eq("id", participant.id);
      }
    } catch {
      // Si falla, profile_icon_id se queda como estaba y la UI cae de
      // vuelta a las iniciales — no bloquea la actualización de rango.
    }

    // Estado en vivo: best-effort, igual que el ícono. 200 = está jugando,
    // 404 = no está en partida (respuesta normal, no un error). Cualquier
    // otro status (429, 5xx) no toca in_game: se resuelve en la próxima
    // corrida en vez de asumir un estado incorrecto.
    try {
      const spectatorRes = await fetch(
        `https://${platform}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${participant.puuid}`,
        { headers: { "X-Riot-Token": riotApiKey }, cache: "no-store" },
      );
      if (spectatorRes.ok) {
        await supabase
          .from("participants")
          .update({ in_game: true })
          .eq("id", participant.id);
      } else if (spectatorRes.status === 404) {
        await supabase
          .from("participants")
          .update({ in_game: false })
          .eq("id", participant.id);
      }
    } catch {
      // Red caída, etc — no bloquea el resto del update.
    }

    try {
      const res = await fetch(
        `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${participant.puuid}`,
        { headers: { "X-Riot-Token": riotApiKey }, cache: "no-store" },
      );

      if (!res.ok) {
        results.push({
          participant_id: participant.id,
          nombre_display: participant.nombre_display,
          status: `riot_api_error_${res.status}`,
        });
        continue;
      }

      const entries = (await res.json()) as RiotLeagueEntry[];
      const soloQueue = entries.find((e) => e.queueType === "RANKED_SOLO_5x5");

      if (!soloQueue) {
        results.push({
          participant_id: participant.id,
          nombre_display: participant.nombre_display,
          status: "unranked",
        });
        continue;
      }

      const tier = soloQueue.tier as RankTier;
      const division: RankDivision | null = APEX_TIERS.has(tier)
        ? null
        : (soloQueue.rank as RankDivision);

      const elo_score = calculateEloScore({
        tier,
        division,
        lp: soloQueue.leaguePoints,
      });

      const { error: insertError } = await supabase.from("snapshots").insert({
        participant_id: participant.id,
        tier,
        division,
        lp: soloQueue.leaguePoints,
        wins: soloQueue.wins,
        losses: soloQueue.losses,
        elo_score,
      });

      results.push({
        participant_id: participant.id,
        nombre_display: participant.nombre_display,
        status: insertError ? `db_error: ${insertError.message}` : "ok",
      });
    } catch (err) {
      results.push({
        participant_id: participant.id,
        nombre_display: participant.nombre_display,
        status: `fetch_error: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }

    // Stay well under Riot's per-second rate limit.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return NextResponse.json({ updated: results.length, results });
}
