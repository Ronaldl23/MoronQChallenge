import { NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateEloScore, rankOrdinal } from "@/lib/elo";
import { postRankEventChatMessage } from "@/lib/chat-system-messages";
import {
  calculateKda,
  MIN_MATCH_DURATION_SECONDS,
  processNewMatches,
  questTargetsForTier,
  tierForRank,
  QUEST_TYPES,
  type MatchOutcome,
  type MissionTier,
} from "@/lib/quests";
import {
  processPenaltyMatches,
  NONCOMPLIANCE_BAN_THRESHOLD,
  type PenaltyMatchOutcome,
  type PendingPenalty,
} from "@/lib/penalty";
import {
  MAX_ACTIVE_PENALTIES,
  PROTECTION_HOURS,
  hoursFromNowIso,
  rollPenaltyOutcome,
  SUPPORT_ASSIGNMENT,
  NO_FLASH_ASSIGNMENT,
  type PunishmentOutcome,
} from "@/lib/mango-launch";
import { isProbableAegisProc } from "@/lib/aegis";
import { computeLpStats, TREND_WINDOW_DAYS } from "@/lib/lp-stats";
import { correlateLpChanges, correlateSingleMatchLp } from "@/lib/lp-correlation";
import { platformToContinent } from "@/lib/riot";
import { fetchRankOrder } from "@/lib/ranking";
import { getChampionList } from "@/lib/champions";
import { getSummonerSpellList } from "@/lib/summoner-spells";
import type { Database, QuestProgress, QuestType, RankDivision, RankTier } from "@/types/database";

/** Mismo helper que /api/jugador/mangos/launch y /discard — qué guardar en champion_assigned para cada tipo de resultado. */
function toStoredAssignment(outcome: PunishmentOutcome): string {
  if (outcome.kind === "support") return SUPPORT_ASSIGNMENT;
  if (outcome.kind === "spell") return outcome.noFlash ? NO_FLASH_ASSIGNMENT : outcome.spell.id;
  return outcome.champion.id;
}

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
 * Intentos totales de riotFetch ante 429 seguidos (el primero + reintentos)
 * antes de darse por vencido. Antes era 1 reintento (2 intentos totales) —
 * con el cron corriendo cada 5 min en vez de 15 (3x más corridas por hora
 * pegándole a la API de Riot), un segundo 429 seguido ya no es tan raro, y
 * cuando pasa en processParticipantQuests el fetch de esa partida puntual
 * queda como "fallida" — el loop corta ahí (ver el break más abajo) y el
 * cursor (last_processed_match_id) NUNCA avanza más allá de ESA partida:
 * queda reintentándose corrida tras corrida, bloqueando todo lo que venga
 * después (cumplimiento de castigos, Aegis) indefinidamente hasta que esa
 * partida puntual logre bajarse con éxito. Más intentos acá reduce mucho
 * la chance de llegar a ese punto en primer lugar.
 */
const RIOT_FETCH_MAX_ATTEMPTS = 4;

/**
 * fetch a Riot con reintento automático ante 429: espera lo que indica el
 * header Retry-After (la propia API te dice cuánto esperar, no hace falta
 * adivinar) y reintenta hasta RIOT_FETCH_MAX_ATTEMPTS veces en total, en
 * vez de marcar al participante como error definitivo por un rate limit
 * pasajero.
 */
async function riotFetch(url: string, apiKey: string, attempt = 1): Promise<Response> {
  const res = await fetch(url, { headers: { "X-Riot-Token": apiKey }, cache: "no-store" });
  if (res.status !== 429 || attempt >= RIOT_FETCH_MAX_ATTEMPTS) return res;

  const retryAfterHeader = Number(res.headers.get("Retry-After"));
  const retryAfterSeconds = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
    ? retryAfterHeader
    : 2;
  await sleep(retryAfterSeconds * 1000 + 250);

  return riotFetch(url, apiKey, attempt + 1);
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
  tier: MissionTier,
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
      target: questTargetsForTier(tier)[questType],
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
 * src/lib/aegis.ts): TODAS las partidas ranked SoloQ nuevas detectadas
 * esta corrida (no solo "la más reciente"), con lo necesario para intentar
 * aislar el LP ganado de CADA UNA contra el historial de snapshots (ver
 * correlateLpChanges en src/lib/lp-correlation.ts).
 *
 * Antes esto solo tenía sentido cuando se detectaba EXACTAMENTE 1 partida
 * nueva en la corrida — con 2 o más (el cron se atrasó, o el jugador
 * encadenó partidas rápido) Aegis se salteaba COMPLETO para todas esas
 * partidas, sin volver a evaluarlas nunca más (el cursor de misiones ya
 * las marca como "vistas"). Ahora cada partida nueva se intenta aislar por
 * separado: si cae en un hueco de snapshots que no comparte con ninguna
 * otra (ver correlateLpChanges), se evalúa igual aunque hayan llegado
 * varias juntas en la misma corrida — solo se pierden las que de verdad
 * son ambiguas (dos partidas reales en el mismo hueco de ~10 minutos entre
 * snapshots, sin forma de repartir el LP entre ellas).
 */
interface AegisCandidateMatch {
  matchId: string;
  /**
   * gameEndTimestamp (epoch ms) — ancla la correlación de LP a la hora
   * REAL de la partida (ver src/lib/lp-correlation.ts) en vez de a qué
   * corrida del cron la detectó primero. match-v5 (esto) y league-v4 (el
   * LP) no siempre propagan al mismo ritmo.
   */
  gameEndTimestamp: number;
  isNonRemakeWin: boolean;
}

type AegisMatchSignal = AegisCandidateMatch[];

const UNKNOWN_AEGIS_SIGNAL: AegisMatchSignal = [];

/**
 * Corre el motor de misiones puro (processNewMatches, ver src/lib/quests.ts)
 * y persiste el resultado — extraído para poder llamarlo TANTO con
 * partidas nuevas de verdad COMO con `matches: []` (ver el comentario en
 * processParticipantQuests sobre por qué hace falta lo segundo): con
 * matches=[] el loop de partidas de processNewMatches no itera nada, pero
 * su primer paso (tryGrant para cada quest ANTES de procesar partidas, ver
 * quests.ts) sigue corriendo igual — es exactamente el reintento de "esta
 * quest ya está en el target, ¿ahora hay cupo de inventario libre?" que
 * antes solo se disparaba si había una partida nueva que procesar.
 */
async function grantCompletedQuests({
  supabase,
  participant,
  questRows,
  referenceRow,
  matches,
  tier,
}: {
  supabase: SupabaseClient<Database>;
  participant: { id: string };
  questRows: Map<QuestType, QuestProgress>;
  referenceRow: QuestProgress;
  matches: MatchOutcome[];
  /** Categoría ACTUAL del participante — decide los targets/umbral de esta corrida (ver quests.ts) y se persiste en quest_progress.target en cada corrida, para que la UI de /jugador siempre muestre el target vigente aunque no haya partidas nuevas (p.ej. subió/bajó de categoría desde la corrida anterior). */
  tier: MissionTier;
}): Promise<void> {
  const mangoCount = await countMangoInventory(supabase, participant.id);

  const progress = Object.fromEntries(
    QUEST_TYPES.map((questType) => [questType, questRows.get(questType)!.current_progress]),
  ) as Record<QuestType, number>;

  const result = processNewMatches({ progress, matches, mangoCount, tier });
  const targets = questTargetsForTier(tier);

  // Sin partidas nuevas (matches=[]), result.lastProcessedMatchId queda
  // null (nunca se pisa dentro del loop, que no itera nada) — el cursor
  // existente se mantiene tal cual en vez de borrarse.
  const lastProcessedMatchId = result.lastProcessedMatchId ?? referenceRow.last_processed_match_id;
  const updatedAt = new Date().toISOString();

  await Promise.all(
    QUEST_TYPES.map((questType) =>
      supabase
        .from("quest_progress")
        .update({
          current_progress: result.progress[questType],
          target: targets[questType],
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
  tier,
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
  /** Categoría de dificultad ACTUAL del participante (ver tierForRank en src/lib/quests.ts), calculada UNA vez por corrida en GET a partir del ranking en vivo — decide targets/umbral de las misiones. */
  tier: MissionTier;
}): Promise<AegisMatchSignal> {
  const continent = platformToContinent(participant.region_platform);
  if (!continent) return UNKNOWN_AEGIS_SIGNAL;

  const questRows = new Map<QuestType, QuestProgress>(
    await Promise.all(
      QUEST_TYPES.map(
        async (questType) =>
          [questType, await getOrCreateQuestProgress(supabase, participant.id, questType, tier)] as const,
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
    // Sin partidas ranked nuevas esta corrida no significa "nada para
    // hacer": una quest puede haber llegado a su target en una corrida
    // ANTERIOR sin cupo de inventario libre en ese momento (ver tryGrant en
    // quests.ts). Si ese cupo se liberó después (lanzó o le revelaron un
    // mango) pero el jugador no volvió a jugar ranked, ese reintento nunca
    // se disparaba antes de este fix — la misión quedaba pegada en el
    // target indefinidamente, con el inventario visiblemente vacío, hasta
    // la próxima partida (el bug reportado).
    await grantCompletedQuests({ supabase, participant, questRows, referenceRow, matches: [], tier });
    return [];
  }

  const outcomes: MatchOutcome[] = [];
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
      kills: mp.kills,
      deaths: mp.deaths,
      gameDurationSeconds: match.info.gameDuration,
      beatTrackedParticipant,
    });
    gameEndTimestamps.push(match.info.gameEndTimestamp);
  }

  // Señal para Aegis: UNA candidata por cada partida nueva de la que se
  // pudo bajar el detalle (puede ser 0, 1, o varias — el caller intenta
  // aislar el LP de cada una por separado, ver el comentario de
  // AegisCandidateMatch arriba).
  const signal: AegisMatchSignal = outcomes.map((outcome, i) => ({
    matchId: outcome.matchId,
    gameEndTimestamp: gameEndTimestamps[i],
    isNonRemakeWin: outcome.win && outcome.gameDurationSeconds >= MIN_MATCH_DURATION_SECONDS,
  }));

  if (outcomes.length === 0) return signal;

  await grantCompletedQuests({ supabase, participant, questRows, referenceRow, matches: outcomes, tier });

  return signal;
}

/**
 * Fase 4 (rediseñada — contador compartido, ver src/lib/penalty.ts), y
 * DESACOPLADA del cursor incremental de misiones (last_processed_match_id):
 * antes esta función reusaba las mismas partidas "nuevas" que ya había
 * bajado processParticipantQuests, con su mismo tope de
 * MAX_NEW_MATCHES_PER_RUN y su mismo `break` ante el primer fetch fallido
 * — el problema real (bug reportado) es que si UNA sola partida fallaba al
 * bajarse (ej. un 429 de Riot que agotó los reintentos), el cursor nunca
 * avanzaba más allá de esa partida puntual, y todo lo que dependiera de
 * partidas posteriores (justo esto: cumplimiento de castigos) quedaba
 * trabado corrida tras corrida sin ninguna forma de autocorregirse — había
 * que ir a la base a mano a destrabarlo.
 *
 * Ahora esta función pide SU PROPIA ventana de partidas directo a Riot y
 * lleva SU PROPIO cursor por match id (penalty_last_processed_match_id,
 * ver 0024_penalty_cursor_by_match_id.sql) — mismo criterio que
 * quest_progress.last_processed_match_id (findNewMatchIds), no una
 * comparación de horas. Antes usaba un cursor por timestamp
 * (penalty_check_since) con el `startTime` de match-v5, pero ese parámetro
 * es inclusivo del lado de Riot: la misma partida ya evaluada podía volver
 * a aparecer y recontarse. Con IDs exactos esa ambigüedad no existe. Si
 * UNA partida puntual falla al bajarse, se corta ahí (no se saltea) para
 * no dejar un hueco en el medio — la próxima corrida retoma desde el mismo
 * cursor, con RIOT_FETCH_MAX_ATTEMPTS reintentos por partida. El costo
 * extra de pedirle a Riot esto de nuevo en cada corrida es chico: solo
 * corre para participantes que YA tienen algún castigo pendiente (la
 * mayoría no), acotado por PENALTY_GAME_LIMIT partidas reales antes de la
 * descalificación automática.
 *
 * Cada partida cuenta simultáneamente para todos los castigos pendientes,
 * así que una sola corrida puede completar más de uno a la vez, y el
 * contador de partidas-sin-cumplir es UNO SOLO por participante (no por
 * castigo). También activa la protección de PROTECTION_HOURS contra mangos
 * nuevos (ver src/lib/mango-launch.ts) si el participante tenía sus
 * MAX_ACTIVE_PENALTIES castigos activos a la vez y esta corrida le cumplió
 * alguno. Llamada con su propio try/catch desde el loop principal: un error
 * acá no debe afectar el resto de la actualización de este participante ni
 * de los demás.
 */
async function checkPenaltyCompliance({
  supabase,
  participant,
  riotApiKey,
}: {
  supabase: SupabaseClient<Database>;
  participant: {
    id: string;
    puuid: string;
    region_platform: string;
    nombre_display: string;
    penalty_games_without_compliance: number;
    /** Cursor propio por match id (ver 0024_penalty_cursor_by_match_id.sql) — última partida ya evaluada contra el grupo de castigos pendientes ACTUAL. Evita recontar la misma partida en corridas sucesivas (el bug real detrás de una descalificación con muchas menos de PENALTY_GAME_LIMIT partidas jugadas). */
    penalty_last_processed_match_id: string | null;
    /** Contador PRIVADO por día (ver NONCOMPLIANCE_BAN_THRESHOLD en src/lib/penalty.ts) — nunca se expone por ninguna API de cara al jugador. */
    noncompliance_penalty_count: number;
    noncompliance_penalty_last_date: string | null;
    manually_disqualified: boolean;
    /** Acumulado de castigos RECIBIDOS desde la última protección (ver 0030_penalty_received_count.sql) — reemplaza el viejo criterio "cuántos pendientes tiene ahora" para decidir cuándo se gana la protección de PROTECTION_HOURS. */
    penalty_received_count: number;
  };
  riotApiKey: string;
}): Promise<void> {
  const participantId = participant.id;

  // Rastro de diagnóstico (ver 0025_penalty_check_debug.sql) — se pisa cada
  // corrida con qué pasó, para poder ver la causa de un cursor trabado con
  // una consulta SQL directa en vez de depender de los logs de Vercel (que
  // el usuario no revisa). Best-effort: si esto falla, no debe tumbar el
  // resto del chequeo real.
  async function writeDebug(message: string) {
    const { error } = await supabase
      .from("participants")
      .update({ penalty_check_debug: `${new Date().toISOString()} ${message}` })
      .eq("id", participantId);
    if (error) {
      console.error(`No se pudo guardar penalty_check_debug para ${participantId}:`, error.message);
    }
  }

  const { data: pendingRows, error: pendingError } = await supabase
    .from("penalty_progress")
    .select("id, mango_id, created_at")
    .eq("participant_id", participantId)
    .eq("status", "pending");
  if (pendingError) throw pendingError;

  // Regla 5 (src/lib/penalty.ts): sin castigos pendientes no hay contador
  // corriendo. Reset barato (sin pedirle nada a Riot) si quedó un resto de
  // un grupo anterior — evita que un valor viejo le robe intentos reales a
  // la próxima tanda de castigos que le lleguen. penalty_last_processed_match_id
  // también se resetea: un grupo nuevo arranca fresco, sin arrastrar el
  // progreso de evaluación de un grupo ya resuelto.
  async function resetGroupState() {
    const patch: { penalty_games_without_compliance?: number; penalty_last_processed_match_id?: null } = {};
    if (participant.penalty_games_without_compliance !== 0) patch.penalty_games_without_compliance = 0;
    if (participant.penalty_last_processed_match_id !== null) patch.penalty_last_processed_match_id = null;
    if (Object.keys(patch).length === 0) return;
    const { error } = await supabase.from("participants").update(patch).eq("id", participantId);
    if (error) throw error;
  }

  if (!pendingRows || pendingRows.length === 0) {
    await resetGroupState();
    await writeDebug("sin castigos pendientes");
    return;
  }

  const { data: mangoRows, error: mangoError } = await supabase
    .from("mangos")
    .select("id, champion_assigned, status")
    .in(
      "id",
      pendingRows.map((row) => row.mango_id),
    );
  if (mangoError) throw mangoError;
  const mangoById = new Map((mangoRows ?? []).map((m) => [m.id, m]));

  const penalties: PendingPenalty[] = pendingRows.flatMap((row) => {
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

  if (penalties.length === 0) {
    await resetGroupState();
    await writeDebug(
      `${pendingRows.length} castigo(s) pendiente(s) pero ningún mango evaluable todavía (pending_reveal o sin campeón asignado)`,
    );
    return;
  }

  const continent = platformToContinent(participant.region_platform);
  if (!continent) {
    await writeDebug(`region_platform inválida: "${participant.region_platform}"`);
    return; // no debería pasar — se reintenta solo la próxima corrida
  }

  const idsRes = await riotFetch(
    `https://${continent}.api.riotgames.com/lol/match/v5/matches/by-puuid/${participant.puuid}/ids?start=0&count=${MATCH_HISTORY_WINDOW}&queue=${RANKED_SOLO_QUEUE_ID}`,
    riotApiKey,
  );
  await sleep(RIOT_REQUEST_DELAY_MS);
  if (!idsRes.ok) {
    await writeDebug(`Riot devolvió ${idsRes.status} al pedir el historial de partidas`);
    return; // best-effort — se reintenta entera en la próxima corrida, mismo cursor
  }

  const recentIds = (await idsRes.json()) as string[]; // más nueva primero
  // Mismo helper que usa el motor de misiones (findNewMatchIds) — cursor
  // null (grupo recién arrancado) toma TODA la ventana reciente como
  // "nueva", igual que el backfill de misiones; processPenaltyMatches ya
  // ignora sola cualquier partida jugada antes de earliestCreatedAt, así
  // que traer de más acá no rompe nada, solo avanza el cursor de una.
  const newMatchIds = findNewMatchIds(recentIds, participant.penalty_last_processed_match_id);
  if (newMatchIds.length === 0) {
    await writeDebug(
      `sin partidas nuevas (Riot devolvió ${recentIds.length} en la ventana, cursor actual: ${participant.penalty_last_processed_match_id ?? "null"})`,
    );
    return; // nada nuevo desde la última vez que se evaluó este grupo
  }

  const penaltyMatches: PenaltyMatchOutcome[] = [];
  // Último match id evaluado CON ÉXITO y en orden esta corrida — se
  // persiste al final como el nuevo penalty_last_processed_match_id. Corta
  // (no saltea) en el primer fetch fallido para no dejar un hueco sin
  // evaluar en el medio: la próxima corrida reintenta desde ahí, con
  // RIOT_FETCH_MAX_ATTEMPTS reintentos por partida.
  let advancedTo: string | null = null;
  for (const matchId of newMatchIds) {
    const matchRes = await riotFetch(
      `https://${continent}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
      riotApiKey,
    );
    await sleep(RIOT_REQUEST_DELAY_MS);
    if (!matchRes.ok) break;

    const match = (await matchRes.json()) as RiotMatchDetail;
    const mp = match.info.participants.find((p) => p.puuid === participant.puuid);
    if (!mp) break;

    penaltyMatches.push({
      matchId,
      playedAt: new Date(match.info.gameEndTimestamp).toISOString(),
      championPlayed: mp.championName,
      teamPosition: mp.teamPosition,
      summoner1Id: mp.summoner1Id,
      summoner2Id: mp.summoner2Id,
      gameDurationSeconds: match.info.gameDuration,
    });
    advancedTo = matchId;
  }

  // Ni una sola partida se pudo bajar (falló la primera de la lista) — no
  // hay nada que persistir, ni counter ni cursor; se reintenta desde el
  // mismo cursor la próxima corrida.
  if (penaltyMatches.length === 0) {
    await writeDebug(
      `${newMatchIds.length} partida(s) nueva(s) detectada(s) pero falló bajar el detalle de la primera (${newMatchIds[0]})`,
    );
    return;
  }

  const result = processPenaltyMatches({
    penalties,
    matches: penaltyMatches,
    gamesWithoutCompliance: participant.penalty_games_without_compliance,
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

  // Si el grupo se resolvió del todo esta corrida (todos completed — ya no
  // existe la salida "disqualified", ver nonComplianceGrants),
  // penalty_last_processed_match_id queda sin sentido para lo que siga — se
  // resetea a null en vez de guardar `advancedTo`, así el próximo grupo (si
  // hay uno) arranca fresco, sin heredar el progreso de evaluación de este.
  const groupFullyResolved = result.updates.every((update) => update.status !== "pending");

  const patch: { penalty_games_without_compliance?: number; penalty_last_processed_match_id: string | null } = {
    penalty_last_processed_match_id: groupFullyResolved ? null : advancedTo,
  };
  if (result.gamesWithoutCompliance !== participant.penalty_games_without_compliance) {
    patch.penalty_games_without_compliance = result.gamesWithoutCompliance;
  }
  const { error: persistError } = await supabase.from("participants").update(patch).eq("id", participantId);
  if (persistError) throw persistError;

  await writeDebug(
    `ok: ${penaltyMatches.length} partida(s) evaluada(s), ${result.updates.filter((u) => u.status === "completed").length} completada(s), ${result.nonComplianceGrants} castigo(s) nuevo(s) por incumplimiento, contador ${result.gamesWithoutCompliance}, cursor ${patch.penalty_last_processed_match_id ?? "null"}`,
  );

  // Ya no hay descalificación automática (ver nonComplianceGrants en
  // src/lib/penalty.ts): agotar la ventana sin cumplir NINGÚN castigo
  // pendiente otorga uno más por cada vez que pasó esta corrida — sin
  // techo. Autoinfligido (sent_by = el propio participante), 'pending_reveal'
  // igual que cualquier mango recién asignado (su propia sesión dispara la
  // ruleta) y SIN balde de rebote (rollPenaltyOutcome no lo tiene, a
  // diferencia de rollMangoOutcome) — regla explícita del usuario. Best
  // effort: un fallo acá no debe tumbar el resto de esta corrida, ya se
  // persistió todo lo demás arriba.
  if (result.nonComplianceGrants > 0) {
    // Cuántos de los nonComplianceGrants pedidos se llegaron a otorgar de
    // verdad esta corrida — si algo falla a mitad de camino, el contador
    // oculto de abajo (y el chequeo de baneo) solo debe contar los que
    // realmente se insertaron, no los que se pidieron.
    let grantsInserted = 0;
    try {
      const [champions, spells] = await Promise.all([getChampionList(), getSummonerSpellList()]);
      for (let i = 0; i < result.nonComplianceGrants; i++) {
        const outcome = rollPenaltyOutcome(champions, spells);
        const { data: newMango, error: mangoInsertError } = await supabase
          .from("mangos")
          .insert({
            owner_participant_id: participantId,
            sent_by_participant_id: participantId,
            status: "pending_reveal",
            champion_assigned: toStoredAssignment(outcome),
            is_noncompliance_penalty: true,
          })
          .select("id")
          .single();
        if (mangoInsertError) throw mangoInsertError;

        const { error: penaltyInsertError } = await supabase.from("penalty_progress").insert({
          participant_id: participantId,
          mango_id: newMango.id,
        });
        if (penaltyInsertError) throw penaltyInsertError;
        grantsInserted++;
      }
    } catch (err) {
      console.error(
        `Castigo por incumplimiento falló para ${participant.nombre_display}:`,
        err instanceof Error ? err.message : err,
      );
    }

    // Baneo silencioso al llegar a NONCOMPLIANCE_BAN_THRESHOLD EN EL DÍA
    // (ver el comentario largo en src/lib/penalty.ts) — contador PRIVADO,
    // nunca expuesto por ninguna API/UI a propósito. Se reinicia solo al
    // cambiar de día (UTC): si noncompliance_penalty_last_date no es hoy,
    // el contador de ayer (o de cualquier día anterior) no cuenta, arranca
    // de 0 antes de sumar lo de esta corrida. Si ya estaba baneado
    // (manualmente o por esto mismo antes), no se pisa el motivo ni se
    // vuelve a evaluar.
    //
    // El castigo que hace que se llegue al umbral (el 3ro del día) YA se
    // otorgó de verdad arriba (mango + penalty_progress + chat, como
    // cualquier otro) — el baneo no lo cancela ni lo reemplaza, se suman
    // las dos cosas: le cae el castigo Y queda descalificado, sin excepción
    // — a partir de ahí lo revisa la administración (perdonar o no desde
    // /admin, mismo flujo que un ban manual).
    if (grantsInserted > 0 && !participant.manually_disqualified) {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
      const countBeforeToday =
        participant.noncompliance_penalty_last_date === today ? participant.noncompliance_penalty_count : 0;
      const newCount = countBeforeToday + grantsInserted;
      const patch: {
        noncompliance_penalty_count: number;
        noncompliance_penalty_last_date: string;
        // Cada castigo por incumplimiento cuenta también como "castigo
        // recibido" (ver penalty_received_count/MAX_ACTIVE_PENALTIES en
        // /api/jugador/mangos/launch) — misma razón que ahí: acumulado
        // desde la última protección, para que tampoco sirva de vía
        // indirecta para esquivarla.
        penalty_received_count: number;
        manually_disqualified?: true;
        disqualification_reason?: string;
      } = {
        noncompliance_penalty_count: newCount,
        noncompliance_penalty_last_date: today,
        penalty_received_count: participant.penalty_received_count + grantsInserted,
      };
      if (newCount >= NONCOMPLIANCE_BAN_THRESHOLD) {
        patch.manually_disqualified = true;
        patch.disqualification_reason = "Acumulaste demasiados castigos sin cumplir a tiempo.";
      }
      const { error: banCounterError } = await supabase
        .from("participants")
        .update(patch)
        .eq("id", participantId);
      if (banCounterError) {
        console.error(
          `No se pudo actualizar noncompliance_penalty_count para ${participant.nombre_display}:`,
          banCounterError.message,
        );
      }
    }
  }

  // Protección de PROTECTION_HOURS contra mangos nuevos (ver
  // src/lib/mango-launch.ts) — SOLO si ya no podía recibir uno más (target
  // check en /api/jugador/mangos/launch bloquea desde
  // penalty_received_count en MAX_ACTIVE_PENALTIES en adelante) Y esta
  // corrida cumplió AL MENOS uno. penalty_received_count es un ACUMULADO
  // desde la última protección (0030_penalty_received_count.sql), no
  // "cuántos tiene pendientes ahora" — a propósito: ese criterio viejo
  // dejaba coordinar lanzamientos para que nunca llegara a tener 3
  // pendientes A LA VEZ (aunque en total le mandaran muchos más) y la
  // protección nunca se disparaba. Con el acumulado, aunque los vaya
  // cumpliendo de a uno sin juntar 3 pendientes nunca, al 3er RECIBIDO
  // alcanza con cumplir cualquiera de los que le queden para ganarla.
  // Cumplir un castigo sin haber llegado nunca a ese acumulado no da
  // protección — regla explícita del usuario.
  if (
    participant.penalty_received_count >= MAX_ACTIVE_PENALTIES &&
    result.updates.some((update) => update.status === "completed")
  ) {
    const { error: protectionError } = await supabase
      .from("participants")
      .update({ mango_protection_until: hoursFromNowIso(PROTECTION_HOURS), penalty_received_count: 0 })
      .eq("id", participantId);
    if (protectionError) throw protectionError;
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
      "id, puuid, region_platform, nombre_display, penalty_games_without_compliance, penalty_last_processed_match_id, aegis_count, noncompliance_penalty_count, noncompliance_penalty_last_date, manually_disqualified, penalty_received_count",
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

    // Categorías de misiones (ver MissionTier en src/lib/quests.ts): se
    // calcula UNA vez por corrida, no por participante — mismo ranking en
    // vivo que ve el leaderboard público (computeRankOrder), para que "Top
    // 1-10" acá signifique lo mismo que "Top 1-10" en la tabla.
    const rankOrder = await fetchRankOrder(supabase);

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
        const tier = tierForRank(rankOrder.get(participant.id) ?? null);
        aegisSignal = await processParticipantQuests({
          supabase,
          participant,
          riotApiKey,
          trackedPuuids,
          tier,
        });
      } catch (err) {
        console.error(
          `Motor de misiones falló para ${participant.nombre_display}:`,
          err instanceof Error ? err.message : err,
        );
      }

      // Independiente del motor de misiones de arriba a propósito — su
      // propio try/catch, para que un fallo acá no afecte quests/Aegis ni
      // viceversa (ver el comentario largo en checkPenaltyCompliance sobre
      // por qué se desacopló del cursor incremental de misiones).
      try {
        await checkPenaltyCompliance({ supabase, participant, riotApiKey });
      } catch (err) {
        console.error(
          `Cumplimiento de castigos falló para ${participant.nombre_display}:`,
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

        // Recién salió de placements: `rankOrder` se calculó ANTES de este
        // insert (arriba del loop), así que si este participante no estaba
        // ahí es porque hasta este momento no tenía ningún snapshot dentro
        // de TREND_WINDOW_DAYS — el mismo criterio que usan inPlacements en
        // /jugador/page.tsx y el 403 de /api/jugador/mangos/launch. Mientras
        // estuvo en placements sus mangos en inventario no podían pudrirse
        // (vencimiento "nunca" del lado del cliente); para que el conteo de
        // 24h real arranque justo cuando ya puede lanzarlos, y no desde que
        // originalmente entraron al inventario, se resetea inventory_since
        // a ahora en este momento — una sola vez, al cruzar la frontera.
        if (!insertError && !rankOrder.has(participant.id)) {
          const { error: inventoryResetError } = await supabase
            .from("mangos")
            .update({ inventory_since: new Date().toISOString() })
            .eq("owner_participant_id", participant.id)
            .eq("status", "in_inventory");
          if (inventoryResetError) {
            console.error(
              `Reset de inventory_since al salir de placements falló para ${participant.nombre_display}:`,
              inventoryResetError.message,
            );
          }
        }

        // Sistema Aegis: LP ganado en CADA partida nueva de esta corrida —
        // anclado a la hora REAL de cada una (correlateLpChanges, ver
        // src/lib/lp-correlation.ts), no al snapshot "de la corrida
        // anterior". match-v5 (de dónde salen las candidatas) y league-v4
        // (de dónde sale el LP) no siempre propagan al mismo ritmo: cuando
        // match-v5 se atrasa respecto al LP nuevo en league-v4, comparar
        // contra "la corrida anterior nomás" daba 0 de diferencia pese a
        // ser una partida real. Antes esto solo evaluaba la corrida cuando
        // se detectaba EXACTAMENTE 1 partida nueva — con 2+ juntas (cron
        // atrasado, o el jugador encadenó partidas rápido) Aegis se
        // salteaba entero para todas, sin poder recuperarlas después (el
        // bug reportado). Ahora se intenta aislar cada candidata por
        // separado; correlateLpChanges descarta sola las que de verdad son
        // ambiguas (dos partidas reales en el mismo hueco entre
        // snapshots). Best-effort, igual que el anuncio de chat de abajo —
        // un error acá no debe tumbar el resto de la corrida de este
        // participante.
        if (!insertError && aegisSignal.length > 0) {
          try {
            const snapshotsForCorrelation = [
              ...(recentHistory ?? []),
              {
                tier,
                division,
                lp: soloQueue.leaguePoints,
                created_at: new Date().toISOString(),
              },
            ];

            const lpByMatch = correlateLpChanges(
              aegisSignal.map((c) => ({ matchId: c.matchId, gameEndTimestamp: c.gameEndTimestamp })),
              snapshotsForCorrelation,
            );

            let aegisProcs = 0;
            for (const candidate of aegisSignal) {
              const lpGained = lpByMatch.get(candidate.matchId) ?? null;
              if (lpGained === null) continue; // no se pudo aislar sin ambigüedad

              const historicalAvgLpGained = computeLpStats(
                correlateSingleMatchLp({
                  gameEndTimestamp: candidate.gameEndTimestamp,
                  snapshots: snapshotsForCorrelation,
                }).priorSnapshots,
              ).avgLpGained;

              if (
                isProbableAegisProc({
                  isNonRemakeWin: candidate.isNonRemakeWin,
                  lpGained,
                  historicalAvgLpGained,
                })
              ) {
                aegisProcs += 1;
              }
            }

            if (aegisProcs > 0) {
              const { error: aegisError } = await supabase
                .from("participants")
                .update({ aegis_count: participant.aegis_count + aegisProcs })
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
