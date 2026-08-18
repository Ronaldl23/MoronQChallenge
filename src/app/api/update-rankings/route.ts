import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateEloScore } from "@/lib/elo";
import {
  calculateKda,
  processNewMatches,
  QUEST_TARGETS,
  QUEST_TYPES,
  type MatchOutcome,
} from "@/lib/quests";
import { platformToContinent } from "@/lib/riot";
import type { Database, QuestProgress, QuestType, RankDivision, RankTier } from "@/types/database";

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

// --- Motor de misiones del sistema de Mangos (Fase 2) ---------------------
// Lógica de rachas/otorgamiento en src/lib/quests.ts (pura, testeada en
// scripts/test-quests.mjs) — acá solo vive el I/O contra Riot y Supabase.

const RANKED_SOLO_QUEUE_ID = 420;
/**
 * Ventana de partidas recientes a pedirle a Riot por corrida. Con el cron
 * cada ~15min es raro que un participante juegue más de 1-2 ranked en el
 * medio, pero 20 da margen de sobra (sesiones largas, corridas que se
 * atrasan) sin pedir de más. También es el tamaño del backfill la primera
 * vez que un participante no tiene last_processed_match_id todavía.
 */
const MATCH_HISTORY_WINDOW = 20;
/**
 * Tope de partidas NUEVAS procesadas por participante en una misma corrida
 * (cada una es 1 llamada extra a Riot con su propio sleep de espaciado).
 * Sin esto, un backfill completo (participante sin last_processed_match_id,
 * hasta MATCH_HISTORY_WINDOW partidas) multiplicado por ~20 participantes
 * puede superar fácil el maxDuration=60 de Vercel en la primera corrida
 * después de desplegar esta fase. Con el tope, el resto queda para las
 * próximas corridas — no se pierde nada, el cursor solo avanza hasta donde
 * realmente se llegó a procesar.
 */
const MAX_NEW_MATCHES_PER_RUN = 5;

interface RiotMatchParticipant {
  puuid: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
}

interface RiotMatchDetail {
  info: { participants: RiotMatchParticipant[] };
}

async function getOrCreateQuestProgress(
  supabase: SupabaseClient<Database>,
  participantId: string,
  questType: QuestType,
): Promise<QuestProgress> {
  const { data: existing, error: selectError } = await supabase
    .from("quest_progress")
    .select("*")
    .eq("participant_id", participantId)
    .eq("quest_type", questType)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from("quest_progress")
    .insert({
      participant_id: participantId,
      quest_type: questType,
      target: QUEST_TARGETS[questType],
    })
    .select()
    .single();

  if (insertError) throw insertError;
  return created;
}

async function countMangoInventory(
  supabase: SupabaseClient<Database>,
  participantId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("mangos")
    .select("id", { count: "exact", head: true })
    .eq("owner_participant_id", participantId)
    .eq("status", "in_inventory");

  if (error) throw error;
  return count ?? 0;
}

/**
 * `recentIds` viene de Riot más nueva primero. Devuelve solo las más nuevas
 * que `lastProcessedMatchId`, en orden cronológico (más vieja primero) para
 * que el motor las procese en el orden real en que se jugaron.
 *
 * Si `lastProcessedMatchId` es null (primera corrida de este participante) o
 * no aparece en la ventana actual (no jugó ranked en muchísimo tiempo y la
 * ventana no llega tan atrás), se toma TODA la ventana como "nueva" — un
 * backfill del historial reciente en vez de perder el rastro.
 */
function findNewMatchIds(
  recentIds: string[],
  lastProcessedMatchId: string | null,
): string[] {
  if (!lastProcessedMatchId) return [...recentIds].reverse();

  const idx = recentIds.indexOf(lastProcessedMatchId);
  if (idx === -1) return [...recentIds].reverse();

  return recentIds.slice(0, idx).reverse();
}

/**
 * Aislado a propósito: se llama con su propio try/catch desde el loop
 * principal — si Riot falla acá, o hay un error de datos, no debe tocar el
 * resto de la actualización de ese participante ni de los demás.
 */
async function processParticipantQuests({
  supabase,
  participant,
  riotApiKey,
}: {
  supabase: SupabaseClient<Database>;
  participant: { id: string; puuid: string; region_platform: string };
  riotApiKey: string;
}): Promise<void> {
  const continent = platformToContinent(participant.region_platform);
  if (!continent) return;

  const questRows = new Map<QuestType, QuestProgress>(
    await Promise.all(
      QUEST_TYPES.map(
        async (questType) =>
          [questType, await getOrCreateQuestProgress(supabase, participant.id, questType)] as const,
      ),
    ),
  );
  // Todas las quests siempre se persisten con el mismo last_processed_match_id
  // (se procesan juntas, de la misma lista, en cada corrida) — la del primer
  // tipo es la referencia, pero en teoría nunca deberían divergir entre sí.
  const referenceRow = questRows.get(QUEST_TYPES[0])!;

  const idsRes = await riotFetch(
    `https://${continent}.api.riotgames.com/lol/match/v5/matches/by-puuid/${participant.puuid}/ids?start=0&count=${MATCH_HISTORY_WINDOW}&queue=${RANKED_SOLO_QUEUE_ID}`,
    riotApiKey,
  );
  await sleep(RIOT_REQUEST_DELAY_MS);
  if (!idsRes.ok) return; // best-effort — se reintenta en la próxima corrida

  const recentIds = (await idsRes.json()) as string[];
  const newMatchIds = findNewMatchIds(recentIds, referenceRow.last_processed_match_id).slice(
    0,
    MAX_NEW_MATCHES_PER_RUN,
  );
  if (newMatchIds.length === 0) return;

  const outcomes: MatchOutcome[] = [];
  for (const matchId of newMatchIds) {
    const matchRes = await riotFetch(
      `https://${continent}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
      riotApiKey,
    );
    await sleep(RIOT_REQUEST_DELAY_MS);

    // Corta en el primer error en vez de saltear-y-seguir: así el cursor
    // (lastProcessedMatchId, calculado como la última de `outcomes`) nunca
    // avanza más allá de una partida que en verdad no se pudo procesar, y
    // esa partida se reintenta íntegra en la próxima corrida en vez de
    // quedar salteada para siempre.
    if (!matchRes.ok) break;

    const match = (await matchRes.json()) as RiotMatchDetail;
    const mp = match.info.participants.find((p) => p.puuid === participant.puuid);
    if (!mp) break;

    outcomes.push({
      matchId,
      win: mp.win,
      kda: calculateKda({ kills: mp.kills, deaths: mp.deaths, assists: mp.assists }),
      deaths: mp.deaths,
    });
  }

  if (outcomes.length === 0) return;

  const mangoCount = await countMangoInventory(supabase, participant.id);

  const progress = Object.fromEntries(
    QUEST_TYPES.map((questType) => [questType, questRows.get(questType)!.current_progress]),
  ) as Record<QuestType, number>;

  const result = processNewMatches({
    progress,
    matches: outcomes,
    mangoCount,
  });

  const lastProcessedMatchId = result.lastProcessedMatchId ?? referenceRow.last_processed_match_id;
  const updatedAt = new Date().toISOString();

  await Promise.all(
    QUEST_TYPES.map((questType) =>
      supabase
        .from("quest_progress")
        .update({
          current_progress: result.progress[questType],
          last_processed_match_id: lastProcessedMatchId,
          updated_at: updatedAt,
        })
        .eq("id", questRows.get(questType)!.id),
    ),
  );

  if (result.grants.length > 0) {
    const { error: mangoInsertError } = await supabase.from("mangos").insert(
      result.grants.map(() => ({
        owner_participant_id: participant.id,
        status: "in_inventory" as const,
      })),
    );
    if (mangoInsertError) throw mangoInsertError;
  }
}

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

    // Motor de misiones del sistema de Mangos — antes del bloque de
    // league-v4 a propósito: ese bloque tiene `continue` para unranked/error
    // que se saltearían esto si fuera después. Aislado en su propio
    // try/catch: si falla acá, no debe afectar el snapshot de rango de este
    // participante ni tocar a los demás. Sus propias llamadas a Riot ya
    // espacian con sleep(RIOT_REQUEST_DELAY_MS) internamente.
    try {
      await processParticipantQuests({ supabase, participant, riotApiKey });
    } catch (err) {
      console.error(
        `Motor de misiones falló para ${participant.nombre_display}:`,
        err instanceof Error ? err.message : err,
      );
    }

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
