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
 * participantes, en una sola invocación. Bajada de 15 a 8 después de que
 * una corrida real se colgara: con varios participantes recibiendo 429 de
 * Riot y reintentando, hasta 15 partidas × ~20 participantes no entraba ni
 * cerca de maxDuration=60 — Vercel mató la función a los 60s con un 504
 * antes de que llegara a devolver ninguna respuesta. 8 alcanza para "las
 * últimas partidas" con bastante más margen.
 */
const BACKFILL_WINDOW = 8;
/**
 * Corta el trabajo (entre participantes Y en el medio de uno solo, ver los
 * chequeos de budgetExceeded() más abajo) si se acerca al límite de
 * Vercel, en vez de arriesgar que la función se corte de golpe sin
 * devolver nada (el 504 real que pasó). Volver a llamar al endpoint es
 * seguro (ver el comentario de GREATEST más abajo) — retoma los que
 * quedaron sin procesar.
 */
const TIME_BUDGET_MS = 40_000;

/**
 * Más bajo que el de /api/update-rankings (4) a propósito: con el
 * presupuesto de tiempo tan ajustado acá (hay que dejar margen para
 * devolver una respuesta antes de los 60s duros de Vercel), esperar el
 * backoff completo de un 429 varias veces seguidas puede comerse todo el
 * presupuesto en una sola llamada. Mejor fallar rápido y que el usuario
 * vuelva a llamar al endpoint (seguro, es idempotente) que colgarse.
 */
const RIOT_FETCH_MAX_ATTEMPTS = 2;
/** Tope duro al backoff de un 429, aunque Retry-After pida más — mismo motivo que RIOT_FETCH_MAX_ATTEMPTS más bajo. */
const MAX_RETRY_AFTER_SECONDS = 3;

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
  /** "ok", o el motivo por el que no se pudo evaluar del todo — nunca se descarta un participante en silencio. */
  estado: string;
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
  const budgetExceeded = () => Date.now() - startedAt > TIME_BUDGET_MS;
  const results: BackfillResult[] = [];
  let skippedByTimeBudget = 0;
  let anyCutByBudget = false;

  for (const participant of participants ?? []) {
    if (budgetExceeded()) {
      skippedByTimeBudget += 1;
      continue;
    }

    const continent = platformToContinent(participant.region_platform);
    if (!continent) {
      results.push({
        nombre_display: participant.nombre_display,
        aegis_count_antes: participant.aegis_count,
        aegis_count_despues: participant.aegis_count,
        candidatas_encontradas: 0,
        estado: `region_platform inválida: ${participant.region_platform}`,
      });
      continue;
    }

    try {
      const idsRes = await riotFetch(
        `https://${continent}.api.riotgames.com/lol/match/v5/matches/by-puuid/${participant.puuid}/ids?start=0&count=${BACKFILL_WINDOW}&queue=${RANKED_SOLO_QUEUE_ID}`,
        riotApiKey,
      );
      await sleep(RIOT_REQUEST_DELAY_MS);
      if (!idsRes.ok) {
        results.push({
          nombre_display: participant.nombre_display,
          aegis_count_antes: participant.aegis_count,
          aegis_count_despues: participant.aegis_count,
          candidatas_encontradas: 0,
          estado: `Riot devolvió ${idsRes.status} al pedir el historial — volver a llamar al endpoint`,
        });
        continue;
      }

      const matchIds = (await idsRes.json()) as string[];

      const candidates: Array<{ matchId: string; gameEndTimestamp: number; isNonRemakeWin: boolean }> = [];
      let matchFetchFailures = 0;
      let cutByBudget = false;
      for (const matchId of matchIds) {
        if (budgetExceeded()) {
          cutByBudget = true;
          break; // no arrancar una llamada más — hay que dejar margen para devolver la respuesta
        }

        const matchRes = await riotFetch(
          `https://${continent}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
          riotApiKey,
        );
        await sleep(RIOT_REQUEST_DELAY_MS);
        if (!matchRes.ok) {
          matchFetchFailures += 1;
          continue; // best-effort por partida puntual, no corta el resto de este jugador
        }

        const match = (await matchRes.json()) as RiotMatchDetail;
        const mp = match.info.participants.find((p) => p.puuid === participant.puuid);
        if (!mp) continue;

        candidates.push({
          matchId,
          gameEndTimestamp: match.info.gameEndTimestamp,
          isNonRemakeWin: mp.win && match.info.gameDuration >= MIN_MATCH_DURATION_SECONDS,
        });
      }

      if (cutByBudget) anyCutByBudget = true;

      if (candidates.length === 0) {
        results.push({
          nombre_display: participant.nombre_display,
          aegis_count_antes: participant.aegis_count,
          aegis_count_despues: participant.aegis_count,
          candidatas_encontradas: 0,
          estado: cutByBudget
            ? "cortado por límite de tiempo antes de bajar ninguna partida — volver a llamar al endpoint"
            : matchFetchFailures > 0
              ? `sin partidas evaluables — ${matchFetchFailures} fallaron al bajarse`
              : "sin partidas ranked en la ventana",
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
        estado: cutByBudget
          ? "ok, pero cortado por límite de tiempo antes de revisar toda la ventana — volver a llamar al endpoint"
          : "ok",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Aegis backfill falló para ${participant.nombre_display}:`, message);
      results.push({
        nombre_display: participant.nombre_display,
        aegis_count_antes: participant.aegis_count,
        aegis_count_despues: participant.aegis_count,
        candidatas_encontradas: 0,
        estado: `error: ${message}`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    procesados: results.length,
    total_participantes: participants?.length ?? 0,
    saltados_por_tiempo: skippedByTimeBudget,
    volver_a_llamar: skippedByTimeBudget > 0 || anyCutByBudget,
    results,
  });
}
