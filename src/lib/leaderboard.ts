import { createClient } from "@/lib/supabase/server";
import { getChampionList, type Champion } from "@/lib/champions";
import { getSummonerSpellList, type SummonerSpell } from "@/lib/summoner-spells";
import { resolveAssignedPunishment } from "@/lib/mango-launch";
import { computeLpStats, TREND_WINDOW_DAYS } from "@/lib/lp-stats";
import { computeRankChanges } from "@/lib/rank-change";
import type { Participant, Snapshot } from "@/types/database";

/**
 * login_code no viaja acá — el leaderboard público nunca lo selecciona (ver
 * getLeaderboard). penalty_games_without_compliance y last_seen_at tampoco:
 * son datos de contexto de /jugador (contador compartido de castigos,
 * presencia online), no algo que el leaderboard público necesite mostrar
 * por jugador — ninguna de las dos columnas se pide en el select de abajo.
 */
type PublicParticipant = Omit<
  Participant,
  "login_code" | "penalty_games_without_compliance" | "last_seen_at"
>;

/** Un castigo pendiente o en revisión, en formato listo para mostrar (Fase 5) — mismo shape que el banner de /jugador. */
export interface PendingPenaltySummary {
  id: string;
  championName: string;
  championIconUrl: string | null;
  senderName: string;
}

export interface LeaderboardEntry {
  rank: number;
  participant: PublicParticipant;
  latest: Snapshot;
  /** status 'pending' (o 'flagged_for_review', legacy) — castigos que todavía no se resolvieron. */
  pendingPenalties: PendingPenaltySummary[];
  /** mangos en inventario propio (status='in_inventory'), sin lanzar todavía. */
  mangoCount: number;
  /** true si tiene AL MENOS UN penalty_progress en status='disqualified' (confirmado por el admin). */
  isDisqualified: boolean;
  /**
   * Promedio de LP ganado POR VICTORIA (subidas de LP entre snapshots
   * consecutivos del MISMO tier/división, ventana de 7 días, dividido por
   * la cantidad de esas subidas). Los saltos de tier/división se excluyen
   * a propósito: el LP se resetea al subir o bajar, así que comparar el lp
   * crudo entre snapshots de tiers distintos no tiene sentido (mostraría
   * una "caída" enorme al ascender, por ejemplo). 0 si no hubo ninguna
   * victoria con cambio de LP detectado en la ventana.
   */
  avgLpGained: number;
  /** Igual que avgLpGained pero promedio de LP perdido POR DERROTA (número positivo). 0 si no hubo ninguna derrota con cambio de LP detectado en la ventana. */
  avgLpLost: number;
  /**
   * Promedio neto de LP por partida jugada en la ventana (ganado en
   * victorias menos perdido en derrotas, dividido por el total de
   * partidas con cambio de LP detectado) — equivalente a ponderar
   * avgLpGained/avgLpLost por winrate/lossrate de la ventana. Es el
   * criterio que usa el header "±LP" de la tabla para ordenar: sube con
   * más LP ganado por victoria, con más LP perdido por derrota baja, y
   * también responde a CUÁNTO de cada uno pasa (ganar mucho pero poco
   * seguido pesa menos que ganar seguido). 0 si no hay ninguna partida con
   * cambio de LP detectado en la ventana.
   */
  netAvgLp: number;
  /**
   * Swing acumulado de LP de las últimas partidas con cambio real de LP
   * (más vieja → más nueva), arrancando en 0 — no elo_score crudo por
   * snapshot. Cada paso es un delta de LP entre dos snapshots consecutivos
   * del MISMO tier/división (mismo criterio que lpGained/lpLost); los
   * pares sin cambio de LP (nadie jugó entre esas dos corridas del cron)
   * se descartan para que la línea refleje partidas, no simples muestreos
   * cada 15 min. Sube en verde si viene ganando LP, baja en rojo si lo
   * viene perdiendo — así la mini-gráfica es un "cómo viene la cuenta
   * ahora mismo" real, no solo la forma del elo_score.
   */
  trend: number[];
  /**
   * Cuántas posiciones subió (positivo) o bajó (negativo) en el ranking
   * desde la corrida anterior de /api/update-rankings — 0 si se mantuvo
   * igual, null si no había un snapshot previo con el que comparar (recién
   * apareció en el ranking). Se calcula comparando el rank actual (por
   * elo_score del snapshot más reciente de cada participante) contra el
   * rank que hubiera tenido ese mismo grupo de participantes usando el
   * snapshot ANTERIOR de cada uno — no es "la posición hace exactamente 15
   * minutos", es "la posición antes de la última actualización de cada
   * quien conforma el ranking actual".
   */
  rankChange: number | null;
}

const MAX_TREND_GAMES = 10;

/**
 * Participante sin ningún snapshot en la ventana de TREND_WINDOW_DAYS —
 * típicamente porque todavía no jugó ninguna ranked SoloQ esta temporada
 * (unranked en league-v4, ver /api/update-rankings: ahí ni se inserta
 * snapshot para estos casos). Sin Snapshot no hay tier/división/LP/winrate
 * que mostrar — solo datos propios del participante, independientes del
 * rango.
 */
export interface UnrankedLeaderboardEntry {
  participant: PublicParticipant;
  pendingPenalties: PendingPenaltySummary[];
  mangoCount: number;
  isDisqualified: boolean;
}

export interface Leaderboard {
  entries: LeaderboardEntry[];
  /**
   * Participantes sin rango, para que el torneo pueda confirmar antes de
   * arrancar que todos quedaron bien registrados aunque todavía no tengan
   * partidas — SIEMPRE van al final de la tabla y NUNCA entran al podio
   * (no hay LP real con qué compararlos), por eso viven en un array aparte
   * en vez de mezclarse con `entries`.
   */
  unrankedEntries: UnrankedLeaderboardEntry[];
  /** created_at del snapshot más reciente de todo el leaderboard, para el indicador "actualizado hace X". */
  lastUpdated: string | null;
}

export async function getLeaderboard(limit = 50): Promise<Leaderboard> {
  const supabase = await createClient();

  // Columnas explícitas, sin login_code: esa columna le tiene el select
  // revocado a anon/authenticated (ver 0005_mango_system_phase1.sql) — es
  // el código personal de acceso a /jugador, no algo que el leaderboard
  // público deba poder leer. select("*") rompería con un permission denied.
  const { data: participants, error: participantsError } = await supabase
    .from("participants")
    .select(
      "id, nombre_display, riot_game_name, riot_tag, puuid, region_platform, profile_icon_id, avatar_url, opgg_url, in_game, main_role, aegis_count",
    );

  if (participantsError) {
    console.error("Failed to load participants:", participantsError.message);
    return { entries: [], unrankedEntries: [], lastUpdated: null };
  }

  if (!participants || participants.length === 0) {
    return { entries: [], unrankedEntries: [], lastUpdated: null };
  }

  const windowStart = new Date(
    Date.now() - TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  /**
   * PostgREST corta cada response en 1000 filas por default (db-max-rows).
   * Con 20 participantes y el cron corriendo cada 15min, una ventana de 7
   * días junta bastante más que eso — un .select() sin paginar se queda
   * truncado en las primeras 1000 filas por created_at ascendente, es decir
   * las MÁS VIEJAS, cortando justo los snapshots recientes de quien se haya
   * sumado hace poco (pocas filas propias, todas cerca del final de la
   * ventana) y dejándolo afuera del leaderboard sin ningún error visible.
   * Se pagina explícitamente con .range() hasta agotar los resultados.
   */
  const PAGE_SIZE = 1000;
  const snapshots: Snapshot[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error: snapshotsError } = await supabase
      .from("snapshots")
      .select("*")
      .in(
        "participant_id",
        participants.map((p) => p.id),
      )
      .gte("created_at", windowStart)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (snapshotsError) {
      console.error("Failed to load snapshots:", snapshotsError.message);
      return { entries: [], unrankedEntries: [], lastUpdated: null };
    }

    snapshots.push(...(page ?? []));
    if (!page || page.length < PAGE_SIZE) break;
  }

  const historyByParticipant = new Map<string, Snapshot[]>();
  let lastUpdated: string | null = null;
  for (const snapshot of snapshots) {
    const history = historyByParticipant.get(snapshot.participant_id) ?? [];
    history.push(snapshot);
    historyByParticipant.set(snapshot.participant_id, history);
    if (!lastUpdated || snapshot.created_at > lastUpdated) {
      lastUpdated = snapshot.created_at;
    }
  }

  // --- Sistema de Mangos (Fase 5): castigos pendientes, inventario y
  // descalificación — best-effort, un error acá no debe tumbar todo el
  // leaderboard (a diferencia de participants/snapshots, esto es
  // informativo, no el dato central de la página).
  const participantIds = participants.map((p) => p.id);

  const [penaltyRowsRes, inventoryRes] = await Promise.all([
    supabase
      .from("penalty_progress")
      .select("id, participant_id, mango_id, status")
      .in("participant_id", participantIds)
      // 'flagged_for_review' ya no lo escribe nada (la descalificación es
      // automática, ver src/lib/penalty.ts) — se sigue pidiendo acá solo
      // por si queda alguna fila vieja de antes de ese cambio.
      .in("status", ["pending", "flagged_for_review", "disqualified"]),
    supabase
      .from("mangos")
      .select("owner_participant_id")
      .eq("status", "in_inventory")
      .in("owner_participant_id", participantIds),
  ]);

  if (penaltyRowsRes.error) {
    console.error(
      "Failed to load penalty_progress:",
      penaltyRowsRes.error.message,
    );
  }
  if (inventoryRes.error) {
    console.error(
      "Failed to load mango inventory:",
      inventoryRes.error.message,
    );
  }

  const mangoCountByParticipant = new Map<string, number>();
  for (const row of inventoryRes.data ?? []) {
    mangoCountByParticipant.set(
      row.owner_participant_id,
      (mangoCountByParticipant.get(row.owner_participant_id) ?? 0) + 1,
    );
  }

  const penaltyRows = penaltyRowsRes.data ?? [];
  const disqualifiedParticipantIds = new Set(
    penaltyRows
      .filter((r) => r.status === "disqualified")
      .map((r) => r.participant_id),
  );
  const activePenaltyRows = penaltyRows.filter(
    (r) => r.status === "pending" || r.status === "flagged_for_review",
  );

  const pendingByParticipant = new Map<string, PendingPenaltySummary[]>();
  if (activePenaltyRows.length > 0) {
    const { data: mangoDetails } = await supabase
      .from("mangos")
      .select("id, champion_assigned, sent_by_participant_id")
      .in(
        "id",
        activePenaltyRows.map((r) => r.mango_id),
      );
    const mangoById = new Map((mangoDetails ?? []).map((m) => [m.id, m]));
    // Ya tenemos a TODOS los participantes cargados arriba — alcanza para
    // resolver el nombre del remitente, no hace falta una query aparte.
    const nameById = new Map(participants.map((p) => [p.id, p.nombre_display]));

    let champions: Champion[] = [];
    let spells: SummonerSpell[] = [];
    try {
      [champions, spells] = await Promise.all([getChampionList(), getSummonerSpellList()]);
    } catch {
      // Sin campeones/hechizos se cae al id crudo dentro de resolveAssignedPunishment.
    }
    const championById = new Map(champions.map((c) => [c.id, c]));
    const spellById = new Map(spells.map((s) => [s.id, s]));

    for (const row of activePenaltyRows) {
      const mango = mangoById.get(row.mango_id);
      const resolved = resolveAssignedPunishment(
        mango?.champion_assigned ?? null,
        championById,
        spellById,
      );
      const senderName =
        (mango?.sent_by_participant_id &&
          nameById.get(mango.sent_by_participant_id)) ||
        "Alguien";
      const list = pendingByParticipant.get(row.participant_id) ?? [];
      list.push({
        id: row.id,
        championName: resolved.name,
        championIconUrl: resolved.iconUrl,
        senderName,
      });
      pendingByParticipant.set(row.participant_id, list);
    }
  }

  const entries: Omit<LeaderboardEntry, "rank" | "rankChange">[] = [];
  const unrankedEntries: UnrankedLeaderboardEntry[] = [];
  // elo_score del snapshot ANTERIOR al más reciente de cada participante,
  // para rankChange más abajo — aparte de `entries` (que no lo necesita en
  // su forma pública) en vez de embebido y después descartado.
  const previousEloScoreByParticipantId = new Map<string, number>();

  for (const participant of participants) {
    const history = historyByParticipant.get(participant.id);
    if (!history || history.length === 0) {
      // Sin snapshot en la ventana = todavía no jugó ranked (o
      // /api/update-rankings nunca corrió para él) — va a la lista aparte,
      // nunca a `entries` (que alimenta el podio).
      unrankedEntries.push({
        participant,
        pendingPenalties: pendingByParticipant.get(participant.id) ?? [],
        mangoCount: mangoCountByParticipant.get(participant.id) ?? 0,
        isDisqualified: disqualifiedParticipantIds.has(participant.id),
      });
      continue;
    }

    const latest = history[history.length - 1];

    const { avgLpGained, avgLpLost, netAvgLp, gameDeltas } =
      computeLpStats(history);

    const trend = gameDeltas
      .slice(-MAX_TREND_GAMES)
      .reduce<
        number[]
      >((acc, delta) => [...acc, acc[acc.length - 1] + delta], [0]);

    if (history.length >= 2) {
      previousEloScoreByParticipantId.set(
        participant.id,
        history[history.length - 2].elo_score,
      );
    }

    entries.push({
      participant,
      latest,
      avgLpGained,
      avgLpLost,
      netAvgLp,
      trend,
      pendingPenalties: pendingByParticipant.get(participant.id) ?? [],
      mangoCount: mangoCountByParticipant.get(participant.id) ?? 0,
      isDisqualified: disqualifiedParticipantIds.has(participant.id),
    });
  }

  entries.sort((a, b) => b.latest.elo_score - a.latest.elo_score);

  const rankChangeByParticipantId = computeRankChanges(
    entries.map((e) => ({
      id: e.participant.id,
      currentEloScore: e.latest.elo_score,
      previousEloScore: previousEloScoreByParticipantId.get(e.participant.id) ?? null,
    })),
  );

  // Sin LP con qué ordenarlos entre sí — alfabético, mismo criterio que
  // /participantes, para un orden estable y predecible en vez de lo que sea
  // que devuelva la query.
  unrankedEntries.sort((a, b) =>
    a.participant.nombre_display.localeCompare(b.participant.nombre_display, "es"),
  );

  return {
    entries: entries.slice(0, limit).map((entry, i) => ({
      ...entry,
      rank: i + 1,
      rankChange: rankChangeByParticipantId.get(entry.participant.id) ?? null,
    })),
    unrankedEntries,
    lastUpdated,
  };
}
