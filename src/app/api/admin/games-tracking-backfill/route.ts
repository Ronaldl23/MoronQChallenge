import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { platformToContinent } from "@/lib/riot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RIOT_REQUEST_DELAY_MS = Number(process.env.RIOT_API_REQUEST_DELAY_MS) || 100;
const RANKED_SOLO_QUEUE_ID = 420;
const RIOT_FETCH_MAX_ATTEMPTS = 2;
const MAX_RETRY_AFTER_SECONDS = 3;
/** Máximo de ids por página que acepta match-v5 — se pagina con `start` creciente hasta que una página devuelva menos que esto. */
const IDS_PAGE_SIZE = 100;
/** Mismo criterio que aegis-backfill: corta antes del límite duro de Vercel para siempre devolver una respuesta, y es seguro volver a llamar (recalcula desde cero, no acumula). */
const TIME_BUDGET_MS = 40_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function riotFetch(url: string, apiKey: string, attempt = 1): Promise<Response> {
  const res = await fetch(url, { headers: { "X-Riot-Token": apiKey }, cache: "no-store" });
  if (res.status !== 429 || attempt >= RIOT_FETCH_MAX_ATTEMPTS) return res;

  const retryAfterHeader = Number(res.headers.get("Retry-After"));
  const retryAfterSeconds = Math.min(
    Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : 2,
    MAX_RETRY_AFTER_SECONDS,
  );
  await sleep(retryAfterSeconds * 1000 + 250);

  return riotFetch(url, apiKey, attempt + 1);
}

interface BackfillResult {
  nombre_display: string;
  tracked_games_played_antes: number;
  tracked_games_played_despues: number;
  estado: string;
}

/**
 * Uso único y manual (no es un cron): calcula el valor RETROACTIVO de
 * tracked_games_played (ver 0040_games_tracking_limit.sql) para el roster
 * que ya existía antes de esta columna — sin esto, todos arrancarían en 0
 * como si recién empezaran, aunque ya tengan cientos de partidas jugadas.
 *
 * Cuenta partidas ranked SoloQ vía el endpoint de ids de match-v5 con
 * `startTime=<participants.created_at en epoch segundos>` — a propósito NO
 * baja el detalle de cada partida (a diferencia del conteo incremental real
 * de /api/update-rankings, que sí excluye remakes vía MIN_MATCH_DURATION_SECONDS):
 * para un cálculo ÚNICO de arranque, contar ids alcanza y evita cientos de
 * llamadas extra a Riot — el error introducido (contar algún remake de más)
 * es de a lo sumo un puñado de partidas en participantes con mucho volumen,
 * aceptable para este propósito. De acá en más, cada corrida de
 * update-rankings suma con precisión (ver realMatchesProcessed).
 *
 * Sobreescribe tracked_games_played con el conteo recalculado (no lo suma)
 * — a propósito idempotente: correrlo de nuevo dos veces da el mismo
 * resultado, seguro si el TIME_BUDGET_MS corta antes de llegar a todos.
 *
 * Mismos query params opcionales que /api/admin/aegis-backfill: `?nombre=` o
 * `?participant_id=` para recalcular a un solo jugador puntual.
 */
export async function GET(request: Request) {
  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const riotApiKey = process.env.RIOT_API_KEY;
  if (!riotApiKey) {
    return NextResponse.json({ error: "RIOT_API_KEY no está configurada" }, { status: 500 });
  }

  const supabase = createAdminClient();
  const { data: allParticipants, error } = await supabase
    .from("participants")
    .select("id, puuid, region_platform, nombre_display, created_at, tracked_games_played");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const url = new URL(request.url);
  const nombreFilter = url.searchParams.get("nombre")?.trim().toLowerCase();
  const participantIdFilter = url.searchParams.get("participant_id");
  const participants = participantIdFilter
    ? (allParticipants ?? []).filter((p) => p.id === participantIdFilter)
    : nombreFilter
      ? (allParticipants ?? []).filter((p) => p.nombre_display.toLowerCase() === nombreFilter)
      : allParticipants;

  if ((participantIdFilter || nombreFilter) && (participants ?? []).length === 0) {
    return NextResponse.json({ error: "No se encontró ningún participante con ese filtro" }, { status: 404 });
  }

  const startedAt = Date.now();
  const budgetExceeded = () => Date.now() - startedAt > TIME_BUDGET_MS;
  const results: BackfillResult[] = [];
  let skippedByTimeBudget = 0;

  for (const participant of participants ?? []) {
    if (budgetExceeded()) {
      skippedByTimeBudget += 1;
      continue;
    }

    const continent = platformToContinent(participant.region_platform);
    if (!continent) {
      results.push({
        nombre_display: participant.nombre_display,
        tracked_games_played_antes: participant.tracked_games_played,
        tracked_games_played_despues: participant.tracked_games_played,
        estado: `region_platform inválida: ${participant.region_platform}`,
      });
      continue;
    }

    const startTimeEpochSeconds = Math.floor(new Date(participant.created_at).getTime() / 1000);

    try {
      let total = 0;
      let cutByBudget = false;
      for (let start = 0; ; start += IDS_PAGE_SIZE) {
        if (budgetExceeded()) {
          cutByBudget = true;
          break;
        }
        const idsRes = await riotFetch(
          `https://${continent}.api.riotgames.com/lol/match/v5/matches/by-puuid/${participant.puuid}/ids?start=${start}&count=${IDS_PAGE_SIZE}&queue=${RANKED_SOLO_QUEUE_ID}&startTime=${startTimeEpochSeconds}`,
          riotApiKey,
        );
        await sleep(RIOT_REQUEST_DELAY_MS);
        if (!idsRes.ok) {
          results.push({
            nombre_display: participant.nombre_display,
            tracked_games_played_antes: participant.tracked_games_played,
            tracked_games_played_despues: participant.tracked_games_played,
            estado: `Riot devolvió ${idsRes.status} al pedir el historial — volver a llamar al endpoint`,
          });
          total = -1;
          break;
        }
        const page = (await idsRes.json()) as string[];
        total += page.length;
        if (page.length < IDS_PAGE_SIZE) break;
      }
      if (total === -1) continue;

      const { error: updateError } = await supabase
        .from("participants")
        .update({ tracked_games_played: total })
        .eq("id", participant.id);
      if (updateError) throw updateError;

      results.push({
        nombre_display: participant.nombre_display,
        tracked_games_played_antes: participant.tracked_games_played,
        tracked_games_played_despues: total,
        estado: cutByBudget
          ? "ok, pero cortado por límite de tiempo antes de terminar de paginar — volver a llamar al endpoint"
          : "ok",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`games-tracking-backfill falló para ${participant.nombre_display}:`, message);
      results.push({
        nombre_display: participant.nombre_display,
        tracked_games_played_antes: participant.tracked_games_played,
        tracked_games_played_despues: participant.tracked_games_played,
        estado: `error: ${message}`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    procesados: results.length,
    total_participantes: participants?.length ?? 0,
    saltados_por_tiempo: skippedByTimeBudget,
    volver_a_llamar: skippedByTimeBudget > 0 || results.some((r) => r.estado.includes("volver a llamar")),
    results,
  });
}
