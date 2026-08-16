import { createClient } from "@/lib/supabase/server";
import type { Participant, Snapshot } from "@/types/database";

export interface LeaderboardEntry {
  rank: number;
  participant: Participant;
  latest: Snapshot;
  /**
   * Suma de subidas del LP real entre snapshots consecutivos del MISMO
   * tier/división (ventana de 7 días). Los saltos de tier/división se
   * excluyen a propósito: el LP se resetea al subir o bajar, así que
   * comparar el lp crudo entre snapshots de tiers distintos no tiene
   * sentido (mostraría una "caída" enorme al ascender, por ejemplo).
   */
  lpGained: number;
  /** Igual que lpGained pero para bajadas, como número positivo. */
  lpLost: number;
  /**
   * elo_score de los últimos snapshots (más viejo → más nuevo), solo para
   * la mini-gráfica de tendencia (la forma de la línea, sin números). Se
   * usa elo_score aquí — no lp — porque es comparable a través de cambios
   * de tier, y por eso no "rompe" la línea en cada ascenso/descenso.
   */
  trend: number[];
}

const TREND_WINDOW_DAYS = 7;
const MAX_TREND_POINTS = 12;

export interface Leaderboard {
  entries: LeaderboardEntry[];
  /** created_at del snapshot más reciente de todo el leaderboard, para el indicador "actualizado hace X". */
  lastUpdated: string | null;
}

export async function getLeaderboard(limit = 50): Promise<Leaderboard> {
  const supabase = await createClient();

  const { data: participants, error: participantsError } = await supabase
    .from("participants")
    .select("*");

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

  const { data: snapshots, error: snapshotsError } = await supabase
    .from("snapshots")
    .select("*")
    .in(
      "participant_id",
      participants.map((p) => p.id),
    )
    .gte("created_at", windowStart)
    .order("created_at", { ascending: true });

  if (snapshotsError) {
    console.error("Failed to load snapshots:", snapshotsError.message);
    return { entries: [], lastUpdated: null };
  }

  const historyByParticipant = new Map<string, Snapshot[]>();
  let lastUpdated: string | null = null;
  for (const snapshot of snapshots ?? []) {
    const history = historyByParticipant.get(snapshot.participant_id) ?? [];
    history.push(snapshot);
    historyByParticipant.set(snapshot.participant_id, history);
    if (!lastUpdated || snapshot.created_at > lastUpdated) {
      lastUpdated = snapshot.created_at;
    }
  }

  const entries: Omit<LeaderboardEntry, "rank">[] = [];

  for (const participant of participants) {
    const history = historyByParticipant.get(participant.id);
    if (!history || history.length === 0) continue;

    const latest = history[history.length - 1];

    let lpGained = 0;
    let lpLost = 0;
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];
      if (prev.tier !== curr.tier || prev.division !== curr.division) {
        continue; // El LP se resetea al cambiar de tier/división: no es comparable.
      }
      const delta = curr.lp - prev.lp;
      if (delta > 0) lpGained += delta;
      else lpLost += Math.abs(delta);
    }

    const trend = history.slice(-MAX_TREND_POINTS).map((s) => s.elo_score);

    entries.push({ participant, latest, lpGained, lpLost, trend });
  }

  entries.sort((a, b) => b.latest.elo_score - a.latest.elo_score);

  return {
    entries: entries.slice(0, limit).map((entry, i) => ({ ...entry, rank: i + 1 })),
    lastUpdated,
  };
}
