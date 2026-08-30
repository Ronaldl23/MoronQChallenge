import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { isProbableAegisProc } from "@/lib/aegis";
import { computeLpStats } from "@/lib/lp-stats";
import { correlateLpChanges, correlateSingleMatchLp } from "@/lib/lp-correlation";
import { platformToContinent } from "@/lib/riot";
import { MIN_MATCH_DURATION_SECONDS } from "@/lib/quests";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RIOT_REQUEST_DELAY_MS = Number(process.env.RIOT_API_REQUEST_DELAY_MS) || 100;
const RANKED_SOLO_QUEUE_ID = 420;
/**
 * Ventana a re-examinar por participante. Más angosta que
 * MATCH_HISTORY_WINDOW (20) de /api/update-rankings a propósito: esto pide
 * el detalle COMPLETO de cada partida de la ventana, para TODOS los
 * participantes, en una sola invocación — con 20 participantes × 20
 * partidas cada uno no entraría cómodo en maxDuration=60. 15 alcanza de
 * sobra para "las últimas partidas" sin arriesgar el límite de tiempo.
 */
const BACKFILL_WINDOW = 15;
/** Corta el loop de participantes si se acerca al límite de Vercel, en vez de arriesgar que la función se corte a mitad de un participante. Volver a llamar al endpoint es seguro (ver el comentario de GREATEST más abajo) — retoma los que quedaron sin procesar. */
const TIME_BUDGET_MS = 48_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function riotFetch(url: string, apiKey: string): Promise<Response> {
  return fetch(url, { headers: { "X-Riot-Token": apiKey }, cache: "no-store" });
}

interface RiotMatchParticipant {
  puuid: string;
  win: boolean;
}

interface RiotMatchDetail {
  info: {
    participants: RiotMatchParticipant[];
    gameEndTimestamp: number;
    gameDuration: number;
  };
}

interface BackfillResult {
  nombre_display: string;
  aegis_count_antes: number;
  aegis_count_despues: number;
  candidatas_encontradas: number;
}

/**
 * Uso único y manual (no es un cron): reescanea las últimas BACKFILL_WINDOW
 * partidas ranked de CADA participante contra su historial de snapshots ya
 * guardado, buscando Aegis que el chequeo incremental de
 * /api/update-rankings se haya perdido — sobre todo instancias de ANTES de
 * hoy, cuando ese chequeo solo evaluaba una corrida si llegaba EXACTAMENTE 1
 * partida nueva a la vez (ver isProbableAegisProc en src/lib/aegis.ts).
 *
 * Nunca resta aegis_count, solo lo sube si esta pasada encuentra más
 * candidatas de Aegis de las que ya estaban contadas (Math.max, no suma
 * directa) — evita descontar créditos legítimos de partidas más viejas que
 * ya salieron de la ventana de BACKFILL_WINDOW, y evita re-acreditar dos
 * veces una partida que ya se había detectado correctamente antes (si
 * sigue dentro de la ventana, se vuelve a encontrar y el máximo con el
 * valor actual no la duplica).
 *
 * Seguro de correr más de una vez: si se corta por el TIME_BUDGET_MS antes
 * de llegar a todos los participantes, simplemente volvé a pedir esta
 * misma URL — los que ya se procesaron no se tocan de más (Math.max ya
 * reconoce lo que encontró la vez anterior).
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
  const { data: participants, error } = await supabase
    .from("participants")
    .select("id, puuid, region_platform, nombre_display, aegis_count");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const startedAt = Date.now();
  const results: BackfillResult[] = [];
  let skippedByTimeBudget = 0;

  for (const participant of participants ?? []) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      skippedByTimeBudget += 1;
      continue;
    }

    const continent = platformToContinent(participant.region_platform);
    if (!continent) continue;

    try {
      const idsRes = await riotFetch(
        `https://${continent}.api.riotgames.com/lol/match/v5/matches/by-puuid/${participant.puuid}/ids?start=0&count=${BACKFILL_WINDOW}&queue=${RANKED_SOLO_QUEUE_ID}`,
        riotApiKey,
      );
      await sleep(RIOT_REQUEST_DELAY_MS);
      if (!idsRes.ok) continue; // best-effort — se reintenta llamando de nuevo al endpoint

      const matchIds = (await idsRes.json()) as string[];

      const candidates: Array<{ matchId: string; gameEndTimestamp: number; isNonRemakeWin: boolean }> = [];
      for (const matchId of matchIds) {
        const matchRes = await riotFetch(
          `https://${continent}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
          riotApiKey,
        );
        await sleep(RIOT_REQUEST_DELAY_MS);
        if (!matchRes.ok) continue; // best-effort por partida puntual, no corta el resto de este jugador

        const match = (await matchRes.json()) as RiotMatchDetail;
        const mp = match.info.participants.find((p) => p.puuid === participant.puuid);
        if (!mp) continue;

        candidates.push({
          matchId,
          gameEndTimestamp: match.info.gameEndTimestamp,
          isNonRemakeWin: mp.win && match.info.gameDuration >= MIN_MATCH_DURATION_SECONDS,
        });
      }

      if (candidates.length === 0) {
        results.push({
          nombre_display: participant.nombre_display,
          aegis_count_antes: participant.aegis_count,
          aegis_count_despues: participant.aegis_count,
          candidatas_encontradas: 0,
        });
        continue;
      }

      const { data: snapshotHistory } = await supabase
        .from("snapshots")
        .select("tier, division, lp, created_at")
        .eq("participant_id", participant.id)
        .order("created_at", { ascending: true });

      const lpByMatch = correlateLpChanges(
        candidates.map((c) => ({ matchId: c.matchId, gameEndTimestamp: c.gameEndTimestamp })),
        snapshotHistory ?? [],
      );

      let aegisFound = 0;
      for (const candidate of candidates) {
        const lpGained = lpByMatch.get(candidate.matchId) ?? null;
        if (lpGained === null) continue;

        const historicalAvgLpGained = computeLpStats(
          correlateSingleMatchLp({
            gameEndTimestamp: candidate.gameEndTimestamp,
            snapshots: snapshotHistory ?? [],
          }).priorSnapshots,
        ).avgLpGained;

        if (
          isProbableAegisProc({
            isNonRemakeWin: candidate.isNonRemakeWin,
            lpGained,
            historicalAvgLpGained,
          })
        ) {
          aegisFound += 1;
        }
      }

      const newCount = Math.max(participant.aegis_count, aegisFound);
      if (newCount !== participant.aegis_count) {
        const { error: updateError } = await supabase
          .from("participants")
          .update({ aegis_count: newCount })
          .eq("id", participant.id);
        if (updateError) throw updateError;
      }

      results.push({
        nombre_display: participant.nombre_display,
        aegis_count_antes: participant.aegis_count,
        aegis_count_despues: newCount,
        candidatas_encontradas: aegisFound,
      });
    } catch (err) {
      console.error(
        `Aegis backfill falló para ${participant.nombre_display}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    procesados: results.length,
    total_participantes: participants?.length ?? 0,
    saltados_por_tiempo: skippedByTimeBudget,
    volver_a_llamar: skippedByTimeBudget > 0,
    results,
  });
}
