import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateEloScore } from "@/lib/elo";
import type { RankDivision, RankTier } from "@/types/database";

export const dynamic = "force-dynamic";
// Con reintentos por 429 el tiempo total ya no es 100% predecible; damos
// margen de sobra en Vercel en vez de arriesgar que corte la función a
// mitad de camino (el default sin esto es 10s en Hobby).
export const maxDuration = 60;

/**
 * Delay entre CADA llamada a Riot (no solo entre participantes — ver abajo
 * por qué eso no alcanzaba). 100ms por request mantiene el ritmo por debajo
 * de 10 req/s, cómodo incluso bajo el límite más chico que existe (Personal
 * y Production Keys tienen límites más altos, pero no hace falta apurar
 * esto: con 20 participantes × 3 llamadas el proceso igual termina en
 * segundos). Configurable por si tu key necesita ir más lento o si querés
 * acelerarlo sabiendo que tu límite real es más alto.
 */
const RIOT_REQUEST_DELAY_MS = Number(process.env.RIOT_API_REQUEST_DELAY_MS) || 100;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch a Riot con un reintento automático ante 429: espera lo que indica
 * el header Retry-After (la propia API te dice cuánto esperar, no hace
 * falta adivinar) y reintenta una sola vez, en vez de marcar al
 * participante como error definitivo por un rate limit pasajero.
 */
async function riotFetch(url: string, apiKey: string): Promise<Response> {
  const res = await fetch(url, { headers: { "X-Riot-Token": apiKey }, cache: "no-store" });
  if (res.status !== 429) return res;

  const retryAfterHeader = Number(res.headers.get("Retry-After"));
  const retryAfterSeconds = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
    ? retryAfterHeader
    : 2;
  await sleep(retryAfterSeconds * 1000 + 250);

  return fetch(url, { headers: { "X-Riot-Token": apiKey }, cache: "no-store" });
}

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
      const summonerRes = await riotFetch(
        `https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${participant.puuid}`,
        riotApiKey,
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

    // Espaciar CADA llamada, no solo entre participantes: antes las 3
    // llamadas de un mismo participante salían pegadas (sin delay entre
    // ellas) y solo se esperaba una vez al final del loop — eso arma
    // ráfagas de 3 requests simultáneas que pueden pisar el límite de
    // Riot aunque el promedio general esté bien.
    await sleep(RIOT_REQUEST_DELAY_MS);

    // Estado en vivo: best-effort, igual que el ícono. 200 = está jugando,
    // 404 = no está en partida (respuesta normal, no un error). Cualquier
    // otro status (429, 5xx) no toca in_game: se resuelve en la próxima
    // corrida en vez de asumir un estado incorrecto.
    try {
      const spectatorRes = await riotFetch(
        `https://${platform}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${participant.puuid}`,
        riotApiKey,
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

    await sleep(RIOT_REQUEST_DELAY_MS);

    try {
      const res = await riotFetch(
        `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${participant.puuid}`,
        riotApiKey,
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

    await sleep(RIOT_REQUEST_DELAY_MS);
  }

  return NextResponse.json({ updated: results.length, results });
}
