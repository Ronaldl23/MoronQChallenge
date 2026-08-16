import { createClient } from "@/lib/supabase/server";
import type { Participant, Snapshot } from "@/types/database";

export interface LeaderboardEntry {
  rank: number;
  participant: Participant;
  latest: Snapshot;
  /** Suma de subidas de elo_score entre snapshots consecutivos (ventana de 7 días). */
  lpGained: number;
  /** Suma de bajadas de elo_score entre snapshots consecutivos (ventana de 7 días), como número positivo. */
  lpLost: number;
  /** elo_score de los últimos snapshots (más viejo → más nuevo), para la mini-gráfica de tendencia. */
  trend: number[];
}

const TREND_WINDOW_DAYS = 7;
const MAX_TREND_POINTS = 12;

export async function getLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
  const supabase = await createClient();

  const { data: participants, error: participantsError } = await supabase
    .from("participants")
    .select("*");

  if (participantsError) {
    console.error("Failed to load participants:", participantsError.message);
    return [];
  }

  if (!participants || participants.length === 0) {
    return [];
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
    return [];
  }

  const historyByParticipant = new Map<string, Snapshot[]>();
  for (const snapshot of snapshots ?? []) {
    const history = historyByParticipant.get(snapshot.participant_id) ?? [];
    history.push(snapshot);
    historyByParticipant.set(snapshot.participant_id, history);
  }

  const entries: Omit<LeaderboardEntry, "rank">[] = [];

  for (const participant of participants) {
    const history = historyByParticipant.get(participant.id);
    if (!history || history.length === 0) continue;

    const latest = history[history.length - 1];

    let lpGained = 0;
    let lpLost = 0;
    for (let i = 1; i < history.length; i++) {
      const delta = history[i].elo_score - history[i - 1].elo_score;
      if (delta > 0) lpGained += delta;
      else lpLost += Math.abs(delta);
    }

    const trend = history.slice(-MAX_TREND_POINTS).map((s) => s.elo_score);

    entries.push({ participant, latest, lpGained, lpLost, trend });
  }

  entries.sort((a, b) => b.latest.elo_score - a.latest.elo_score);

  return entries.slice(0, limit).map((entry, i) => ({ ...entry, rank: i + 1 }));
}
