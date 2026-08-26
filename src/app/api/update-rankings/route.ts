import { NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateEloScore, rankOrdinal } from "@/lib/elo";
import { postRankEventChatMessage } from "@/lib/chat-system-messages";
import {
  calculateKda,
  MIN_MATCH_DURATION_SECONDS,
  processNewMatches,
  QUEST_TARGETS,
  QUEST_TYPES,
  type MatchOutcome,
} from "@/lib/quests";
import { processPenaltyMatches, type PenaltyMatchOutcome, type PendingPenalty } from "@/lib/penalty";
import { isProbableAegisProc } from "@/lib/aegis";
import { computeLpStats, TREND_WINDOW_DAYS } from "@/lib/lp-stats";
import { correlateSingleMatchLp } from "@/lib/lp-correlation";
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
  /** Id de campeón (Data Dragon, ej. "Ahri") — para el chequeo de cumplimiento de castigos (Fase 4). */
  championName: string;
  /** "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY" — ídem, para el castigo "Support". */
  teamPosition: string;
  /** Ids NUMÉRICOS de Riot (no el id de texto de Data Dragon) de los dos hechizos de invocador llevados — para el castigo de hechizo obligatorio (o "sin Flash"). */
  summoner1Id: number;
  summoner2Id: number;
}

interface RiotMatchDetail {
  info: {
    participants: RiotMatchParticipant[];
    /** Epoch ms — para no contar contra un castigo partidas jugadas antes de que se asignara (Fase 4). */
    gameEndTimestamp: number;
    /** Segundos — remakes (alguien se desconectó al arranque) terminan en un puñado de segundos; se ignoran por completo para quests y castigos (ver MIN_MATCH_DURATION_SECONDS). */
    gameDuration: number;
  };
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
 * Señal que el motor de misiones le pasa al sistema "Aegis" (ver
 * src/lib/aegis.ts): cuántas partidas ranked SoloQ nuevas se detectaron
 * esta corrida, y si esa partida fue una victoria no-remake cuando se
 * puede aislar exactamente 1. null en los campos que no se pudieron
 * determinar (Riot no respondió, no aplica, etc.) — el caller trata eso
 * como "no evaluar Aegis esta corrida", nunca como 0.
 */
interface AegisMatchSignal {
  newMatchCount: number | null;
  singleNewMatchIsNonRemakeWin: boolean | null;
  /**
   * gameEndTimestamp (epoch ms) de esa única partida nueva — el caller lo
   * usa para anclar la correlación de LP a la hora REAL de la partida
   * (ver src/lib/lp-correlation.ts) en vez de a qué corrida del cron la
   * detectó primero. match-v5 (esto) y league-v4 (el LP) no siempre
   * propagan al mismo ritmo — sin esto, cuando match-v5 se atrasa
   * respecto a league-v4, el LP de la partida ya había quedado guardado
   * en un snapshot de una corrida anterior, y comparar contra "el
   * snapshot de la corrida anterior" (nomás) daba 0 de diferencia pese a
   * ser una partida real. null en los mismos casos que
   * singleNewMatchIsNonRemakeWin.
   */
  singleNewMatchGameEndTimestamp: number | null;
}

const UNKNOWN_AEGIS_SIGNAL: AegisMatchSignal = {
  newMatchCount: null,
  singleNewMatchIsNonRemakeWin: null,
  singleNewMatchGameEndTimestamp: null,
};

/**
 * Aislado a propósito: se llama con su propio try/catch desde el loop
 * principal — si Riot falla acá, o hay un error de datos, no debe tocar el
 * resto de la actualización de ese participante ni de los demás.
 */
async function processParticipantQuests({
  supabase,
  participant,
  riotApiKey,
  trackedPuuids,
}: {
  supabase: SupabaseClient<Database>;
  participant: {
    id: string;
    puuid: string;
    region_platform: string;
    penalty_games_without_compliance: number;
  };
  riotApiKey: string;
  /** puuids de TODOS los participantes registrados (incluido este mismo) — para la quest beat_participant, ver más abajo. */
  trackedPuuids: Set<string>;
}): Promise<AegisMatchSignal> {
  const continent = platformToContinent(participant.region_platform);
  if (!continent) return UNKNOWN_AEGIS_SIGNAL;

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
  if (!idsRes.ok) return UNKNOWN_AEGIS_SIGNAL; // best-effort — se reintenta en la próxima corrida

  const recentIds = (await idsRes.json()) as string[];
  const newMatchIds = findNewMatchIds(recentIds, referenceRow.last_processed_match_id).slice(
    0,
    MAX_NEW_MATCHES_PER_RUN,
  );
  if (newMatchIds.length === 0) {
    return { newMatchCount: 0, singleNewMatchIsNonRemakeWin: null, singleNewMatchGameEndTimestamp: null };
  }

  const outcomes: MatchOutcome[] = [];
  // Misma partida, mismo fetch — Fase 4 (cumplimiento de castigos) reusa
  // esto en vez de pedirle a Riot el detalle de las mismas partidas de nuevo.
  const penaltyMatches: PenaltyMatchOutcome[] = [];
  // Paralelo a `outcomes` (mismo índice) — para la señal de Aegis más abajo.
  const gameEndTimestamps: number[] = [];
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

    // beat_participant (Fase 6): ¿algún rival de esta partida es TAMBIÉN un
    // participante registrado del torneo? Los 10 jugadores comparten el
    // mismo `win` que su equipo — así que "perdió Y es rastreado Y no soy
    // yo" ya identifica al rival sin necesitar comparar teamId.
    const beatTrackedParticipant = match.info.participants.some(
      (p) => p.puuid !== participant.puuid && !p.win && trackedPuuids.has(p.puuid),
    );

    outcomes.push({
      matchId,
      win: mp.win,
      kda: calculateKda({ kills: mp.kills, deaths: mp.deaths, assists: mp.assists }),
      deaths: mp.deaths,
      gameDurationSeconds: match.info.gameDuration,
      beatTrackedParticipant,
    });
    gameEndTimestamps.push(match.info.gameEndTimestamp);
    penaltyMatches.push({
      matchId,
      playedAt: new Date(match.info.gameEndTimestamp).toISOString(),
      championPlayed: mp.championName,
      teamPosition: mp.teamPosition,
      summoner1Id: mp.summoner1Id,
      summoner2Id: mp.summoner2Id,
      gameDurationSeconds: match.info.gameDuration,
    });
  }

  // Señal para Aegis: solo tiene sentido cuando se detectó EXACTAMENTE 1
  // partida ranked nueva Y se pudo bajar su detalle (outcomes[0] — el
  // fetch pudo haber fallado). Con 0 o 2+ partidas nuevas, o sin detalle,
  // queda en null: el caller (GET) lo trata como "no evaluar Aegis".
  const signal: AegisMatchSignal = {
    newMatchCount: newMatchIds.length,
    singleNewMatchIsNonRemakeWin:
      newMatchIds.length === 1 && outcomes.length === 1
        ? outcomes[0].win &&
          outcomes[0].gameDurationSeconds >= MIN_MATCH_DURATION_SECONDS
        : null,
    singleNewMatchGameEndTimestamp:
      newMatchIds.length === 1 && gameEndTimestamps.length === 1
        ? gameEndTimestamps[0]
        : null,
  };

  if (outcomes.length === 0) return signal;

  await processParticipantPenalties({
    supabase,
    participantId: participant.id,
    currentGamesWithoutCompliance: participant.penalty_games_without_compliance,
    penaltyMatches,
  });

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

  return signal;
}

/**
 * Fase 4 (rediseñada — contador compartido, ver src/lib/penalty.ts): revisa
 * TODOS los penalty_progress en estado 'pending' de este participante
 * contra las mismas partidas ranked nuevas que ya bajó
 * processParticipantQuests (ver comentario en el loop de arriba) — cada
 * partida cuenta simultáneamente para todos los castigos pendientes, así
 * que una sola corrida puede completar más de uno a la vez, y el contador
 * de partidas-sin-cumplir es UNO SOLO por participante (no por castigo).
 * Llamado desde adentro del mismo try/catch que envuelve
 * processParticipantQuests: un error acá tampoco debe afectar al resto de
 * la actualización.
 */
async function processParticipantPenalties({
  supabase,
  participantId,
  currentGamesWithoutCompliance,
  penaltyMatches,
}: {
  supabase: SupabaseClient<Database>;
  participantId: string;
  currentGamesWithoutCompliance: number;
  penaltyMatches: PenaltyMatchOutcome[];
}): Promise<void> {
  const { data: pendingRows, error: pendingError } = await supabase
    .from("penalty_progress")
    .select("id, mango_id, created_at")
    .eq("participant_id", participantId)
    .eq("status", "pending");
  if (pendingError) throw pendingError;

  const mangoById = new Map<string, { champion_assigned: string | null; status: string }>();
  if (pendingRows && pendingRows.length > 0) {
    const { data: mangoRows, error: mangoError } = await supabase
      .from("mangos")
      .select("id, champion_assigned, status")
      .in(
        "id",
        pendingRows.map((row) => row.mango_id),
      );
    if (mangoError) throw mangoError;
    for (const m of mangoRows ?? []) mangoById.set(m.id, { champion_assigned: m.champion_assigned, status: m.status });
  }

  const penalties: PendingPenalty[] = (pendingRows ?? []).flatMap((row) => {
    const mango = mangoById.get(row.mango_id);
    // El mango todavía no se le reveló al jugador (status='pending_reveal',
    // ver Fase 3.5) — no se le puede exigir cumplir un castigo que todavía
    // no vio. Se salta esta corrida; se evalúa recién una vez que lo
    // revele (mango pasa a 'sent'), no antes. Sin este chequeo, esta
    // corrida podía marcar 'completed'/'disqualified' un castigo
    // fantasma para el jugador — el bug real detrás del reporte de
    // "el pending_reveal no aparece en ningún lado".
    if (!mango || mango.status !== "sent") return [];
    // No debería pasar para un mango 'sent' (siempre se le asigna un
    // castigo al lanzarlo), pero sin campeón/rol asignado no hay nada que
    // evaluar — se salta en vez de romper el resto de la corrida.
    if (!mango.champion_assigned) return [];
    return [
      {
        id: row.id,
        championAssigned: mango.champion_assigned,
        // Normalizado a ISO completo (mismo formato que playedAt abajo) para
        // que la comparación lexicográfica en processPenaltyMatches sea
        // válida — timestamptz de Supabase no siempre viene en ese formato.
        createdAt: new Date(row.created_at).toISOString(),
      },
    ];
  });

  const result = processPenaltyMatches({
    penalties,
    matches: penaltyMatches,
    gamesWithoutCompliance: currentGamesWithoutCompliance,
  });

  await Promise.all(
    result.updates
      .filter((update) => update.status !== "pending")
      .map((update) =>
        supabase
          .from("penalty_progress")
          .update({
            status: update.status,
            completed: update.status === "completed",
          })
          .eq("id", update.id),
      ),
  );

  if (result.gamesWithoutCompliance !== currentGamesWithoutCompliance) {
    const { error: counterError } = await supabase
      .from("participants")
      .update({ penalty_games_without_compliance: result.gamesWithoutCompliance })
      .eq("id", participantId);
    if (counterError) throw counterError;
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
    .select(
      "id, puuid, region_platform, nombre_display, penalty_games_without_compliance, aegis_count",
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Para la quest beat_participant (ganar contra otro participante
  // registrado) — un solo Set con TODOS los puuids del roster, armado una
  // vez acá afuera del loop en vez de una query aparte por participante.
  const trackedPuuids = new Set((participants ?? []).map((p) => p.puuid));

  // El procesamiento real (Riot + Supabase, uno por participante con sleeps
  // entre cada llamada) puede tardar bastante más de lo que un cron externo
  // gratuito está dispuesto a esperar por una respuesta (cron-job.org, por
  // ejemplo, corta a los 30s y lo marca "failed" aunque el servidor siga
  // trabajando bien) — se responde de inmediato más abajo y el trabajo
  // pesado sigue corriendo server-side vía after(), acotado por el mismo
  // maxDuration=60 de siempre (no cambia cuánto tarda esto en terminar,
  // solo evita que el cliente del cron tenga que quedarse esperando).
  after(async () => {
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
      let aegisSignal: AegisMatchSignal = UNKNOWN_AEGIS_SIGNAL;
      try {
        aegisSignal = await processParticipantQuests({
          supabase,
          participant,
          riotApiKey,
          trackedPuuids,
        });
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

        // Se pide ANTES de insertar el snapshot nuevo — si se pidiera después,
        // el snapshot recién insertado ya sería "el más reciente" y se estaría
        // comparando contra sí mismo. `recentHistory` (ascendente) ya trae
        // esta misma fila como su último elemento, así que no hace falta una
        // query aparte solo para esto.
        const aegisWindowStart = new Date(
          Date.now() - TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString();
        const { data: recentHistory } = await supabase
          .from("snapshots")
          .select("tier, division, lp, created_at")
          .eq("participant_id", participant.id)
          .gte("created_at", aegisWindowStart)
          .order("created_at", { ascending: true });
        const previousSnapshot = recentHistory?.at(-1) ?? null;

        const { error: insertError } = await supabase.from("snapshots").insert({
          participant_id: participant.id,
          tier,
          division,
          lp: soloQueue.leaguePoints,
          wins: soloQueue.wins,
          losses: soloQueue.losses,
          elo_score,
        });

        // Sistema Aegis: LP ganado en la única partida nueva de esta corrida
        // — anclado a la hora REAL de esa partida (correlateSingleMatchLp,
        // ver src/lib/lp-correlation.ts), no al snapshot "de la corrida
        // anterior". match-v5 (de dónde sale newMatchCount) y league-v4 (de
        // dónde sale el LP) no siempre propagan al mismo ritmo: cuando
        // match-v5 se atrasa un par de corridas respecto al LP nuevo en
        // league-v4, comparar contra "la corrida anterior nomás" daba 0 de
        // diferencia pese a ser una partida real (el bug reportado — un
        // Aegis real que no se detectaba). Anclar a gameEndTimestamp
        // encuentra el snapshot de ANTES de la partida sin importar cuántas
        // corridas pasaron hasta poder aislarla. Best-effort, igual que el
        // anuncio de chat de abajo — un error acá no debe tumbar el resto de
        // la corrida de este participante.
        if (!insertError) {
          try {
            let lpGainedThisMatch: number | null = null;
            let historicalAvgLpGained = 0;

            if (aegisSignal.newMatchCount === 1 && aegisSignal.singleNewMatchGameEndTimestamp !== null) {
              const snapshotsForCorrelation = [
                ...(recentHistory ?? []),
                {
                  tier,
                  division,
                  lp: soloQueue.leaguePoints,
                  created_at: new Date().toISOString(),
                },
              ];
              const correlation = correlateSingleMatchLp({
                gameEndTimestamp: aegisSignal.singleNewMatchGameEndTimestamp,
                snapshots: snapshotsForCorrelation,
              });
              lpGainedThisMatch = correlation.lpGained;
              historicalAvgLpGained = computeLpStats(correlation.priorSnapshots).avgLpGained;
            }

            if (
              isProbableAegisProc({
                newMatchCount: aegisSignal.newMatchCount,
                singleNewMatchIsNonRemakeWin: aegisSignal.singleNewMatchIsNonRemakeWin,
                lpGainedThisMatch,
                historicalAvgLpGained,
              })
            ) {
              const { error: aegisError } = await supabase
                .from("participants")
                .update({ aegis_count: participant.aegis_count + 1 })
                .eq("id", participant.id);
              if (aegisError) throw aegisError;
            }
          } catch (err) {
            console.error(
              `Aegis: fallo actualizando el contador de ${participant.nombre_display}:`,
              err instanceof Error ? err.message : err,
            );
          }
        }

        // Anuncio público en el chat — best-effort, no debe tirar abajo el
        // resto de la corrida. Sin snapshot previo (primera corrida para este
        // participante) no hay nada que comparar, así que no cuenta como
        // "cambio". rankOrdinal (no elo_score) decide la dirección: elo_score
        // mezcla LP, que se resetea al cruzar de tier — comparar elo_score
        // directamente podría marcar como "descenso" un ascenso real de
        // Master a Grandmaster si el LP arranca más bajo del otro lado.
        if (
          !insertError &&
          previousSnapshot &&
          (previousSnapshot.tier !== tier || previousSnapshot.division !== division)
        ) {
          try {
            const direction =
              rankOrdinal(tier, division) >
              rankOrdinal(previousSnapshot.tier, previousSnapshot.division)
                ? "up"
                : "down";
            await postRankEventChatMessage(supabase, {
              participantId: participant.id,
              participantName: participant.nombre_display,
              tier,
              division,
              direction,
            });
          } catch (err) {
            console.error(
              `update-rankings: fallo publicando el evento de rango de ${participant.nombre_display} en el chat:`,
              err,
            );
          }
        }

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

    // Nadie lee esta respuesta (ver el comentario de arriba) — el resumen
    // de la corrida queda en los logs de la función en Vercel, mismo lugar
    // donde ya caían los console.error de los pasos best-effort de arriba.
    console.log(`update-rankings: ${results.length} participantes procesados`, results);
  });

  return NextResponse.json({
    started: true,
    participantCount: (participants ?? []).length,
  });
}
