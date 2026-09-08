import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { calculateEloScore } from "@/lib/elo";
import type { RankDivision, RankTier } from "@/types/database";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RANKED_SOLO_QUEUE_ID_FILTER = "RANKED_SOLO_5x5";
const APEX_TIERS = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

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

/**
 * Uso único y manual (no es un cron): fuerza un snapshot de rango para UN
 * SOLO participante, sin esperar a la próxima corrida de
 * /api/update-rankings (que procesa a TODO el roster junto y puede tardar
 * en llegarle a alguien puntual si el roster creció mucho — cada
 * participante hace varias llamadas a Riot con espaciado, y con
 * maxDuration=60 en Vercel eso puede no alcanzar a completar el loop
 * entero en una sola corrida). Pensado para diagnosticar/arreglar rápido
 * un caso puntual tipo "a Fulano no le detecta el rango" sin tocar a nadie
 * más — no corre el motor de misiones, cumplimiento de castigos, ni Aegis
 * (eso lo termina de poner al día la próxima corrida normal del cron que sí
 * llegue a procesarlo).
 *
 * Query param: `?nombre=Nombre` (nombre_display, sin distinguir mayúsculas)
 * — obligatorio.
 */
export async function GET(request: Request) {
  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const riotApiKey = process.env.RIOT_API_KEY;
  if (!riotApiKey) {
    return NextResponse.json({ error: "RIOT_API_KEY no está configurada" }, { status: 500 });
  }

  const url = new URL(request.url);
  const nombre = url.searchParams.get("nombre");
  if (!nombre) {
    return NextResponse.json({ error: "Falta ?nombre=Nombre" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: participants, error: participantsError } = await supabase
    .from("participants")
    .select("id, puuid, region_platform, nombre_display")
    .ilike("nombre_display", nombre);
  if (participantsError) {
    return NextResponse.json({ error: participantsError.message }, { status: 500 });
  }
  const participant = participants?.[0];
  if (!participant) {
    return NextResponse.json({ error: `No se encontró ningún participante "${nombre}"` }, { status: 404 });
  }

  const platform = participant.region_platform.toLowerCase();

  // Ícono de invocador: best-effort, igual que en el cron principal.
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
    // No crítico — el resto sigue igual.
  }

  const leagueRes = await fetch(
    `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${participant.puuid}`,
    { headers: { "X-Riot-Token": riotApiKey }, cache: "no-store" },
  );
  if (!leagueRes.ok) {
    return NextResponse.json(
      {
        ok: false,
        nombre_display: participant.nombre_display,
        status: `riot_api_error_${leagueRes.status}`,
        detail: await leagueRes.text().catch(() => null),
      },
      { status: 502 },
    );
  }

  const entries = (await leagueRes.json()) as RiotLeagueEntry[];
  const soloQueue = entries.find((e) => e.queueType === RANKED_SOLO_QUEUE_ID_FILTER);
  if (!soloQueue) {
    return NextResponse.json({
      ok: true,
      nombre_display: participant.nombre_display,
      status: "unranked",
      entradas_devueltas_por_riot: entries.map((e) => e.queueType),
    });
  }

  const tier = soloQueue.tier as RankTier;
  const division: RankDivision | null = APEX_TIERS.has(tier) ? null : (soloQueue.rank as RankDivision);
  const elo_score = calculateEloScore({ tier, division, lp: soloQueue.leaguePoints });

  const { error: insertError } = await supabase.from("snapshots").insert({
    participant_id: participant.id,
    tier,
    division,
    lp: soloQueue.leaguePoints,
    wins: soloQueue.wins,
    losses: soloQueue.losses,
    elo_score,
  });
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    nombre_display: participant.nombre_display,
    status: "ok",
    tier,
    division,
    lp: soloQueue.leaguePoints,
    wins: soloQueue.wins,
    losses: soloQueue.losses,
  });
}
