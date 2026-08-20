import { createClient } from "@/lib/supabase/server";
import { getChampionList, type Champion } from "@/lib/champions";
import { resolveAssignedPunishment } from "@/lib/mango-launch";
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
  /** status 'pending' o 'flagged_for_review' — castigos que todavía no se resolvieron. */
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
}

const TREND_WINDOW_DAYS = 7;
const MAX_TREND_GAMES = 10;

export interface Leaderboard {
  entries: LeaderboardEntry[];
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
      "id, nombre_display, riot_game_name, riot_tag, puuid, region_platform, profile_icon_id, avatar_url, opgg_url, in_game, main_role",
    );

  if (participantsError) {
    console.error("Failed to load participants:", participantsError.message);
    return { entries: [], lastUpdated: null };
  }

  if (!participants || participants.length === 0) {
    return { entries: [], lastUpdated: null };
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
      return { entries: [], lastUpdated: null };
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
    try {
      champions = await getChampionList();
    } catch {
      // Sin campeones se cae al id crudo dentro de resolveAssignedPunishment.
    }
    const championById = new Map(champions.map((c) => [c.id, c]));

    for (const row of activePenaltyRows) {
      const mango = mangoById.get(row.mango_id);
      const resolved = resolveAssignedPunishment(
        mango?.champion_assigned ?? null,
        championById,
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

  const entries: Omit<LeaderboardEntry, "rank">[] = [];

  for (const participant of participants) {
    const history = historyByParticipant.get(participant.id);
    if (!history || history.length === 0) continue;

    const latest = history[history.length - 1];

    let lpGainedTotal = 0;
    let lpLostTotal = 0;
    let winsWithLpChange = 0;
    let lossesWithLpChange = 0;
    const gameDeltas: number[] = [];
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];
      if (prev.tier !== curr.tier || prev.division !== curr.division) {
        continue; // El LP se resetea al cambiar de tier/división: no es comparable.
      }
      const delta = curr.lp - prev.lp;
      if (delta > 0) {
        lpGainedTotal += delta;
        winsWithLpChange++;
      } else if (delta < 0) {
        lpLostTotal += Math.abs(delta);
        lossesWithLpChange++;
      }
      if (delta !== 0) gameDeltas.push(delta);
    }

    const avgLpGained =
      winsWithLpChange > 0 ? Math.round(lpGainedTotal / winsWithLpChange) : 0;
    const avgLpLost =
      lossesWithLpChange > 0 ? Math.round(lpLostTotal / lossesWithLpChange) : 0;
    const gamesWithLpChange = winsWithLpChange + lossesWithLpChange;
    const netAvgLp =
      gamesWithLpChange > 0
        ? Math.round((lpGainedTotal - lpLostTotal) / gamesWithLpChange)
        : 0;

    const trend = gameDeltas
      .slice(-MAX_TREND_GAMES)
      .reduce<
        number[]
      >((acc, delta) => [...acc, acc[acc.length - 1] + delta], [0]);

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

  return {
    entries: entries
      .slice(0, limit)
      .map((entry, i) => ({ ...entry, rank: i + 1 })),
    lastUpdated,
  };
}
