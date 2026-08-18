import { createClient } from "@/lib/supabase/server";
import type { Participant, Snapshot } from "@/types/database";

/** login_code no viaja acá — el leaderboard público nunca lo selecciona (ver getLeaderboard). */
type PublicParticipant = Omit<Participant, "login_code">;

export interface LeaderboardEntry {
  rank: number;
  participant: PublicParticipant;
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

  const entries: Omit<LeaderboardEntry, "rank">[] = [];

  for (const participant of participants) {
    const history = historyByParticipant.get(participant.id);
    if (!history || history.length === 0) continue;

    const latest = history[history.length - 1];

    let lpGained = 0;
    let lpLost = 0;
    const gameDeltas: number[] = [];
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];
      if (prev.tier !== curr.tier || prev.division !== curr.division) {
        continue; // El LP se resetea al cambiar de tier/división: no es comparable.
      }
      const delta = curr.lp - prev.lp;
      if (delta > 0) lpGained += delta;
      else lpLost += Math.abs(delta);
      if (delta !== 0) gameDeltas.push(delta);
    }

    const trend = gameDeltas
      .slice(-MAX_TREND_GAMES)
      .reduce<number[]>((acc, delta) => [...acc, acc[acc.length - 1] + delta], [0]);

    entries.push({ participant, latest, lpGained, lpLost, trend });
  }

  entries.sort((a, b) => b.latest.elo_score - a.latest.elo_score);

  return {
    entries: entries.slice(0, limit).map((entry, i) => ({ ...entry, rank: i + 1 })),
    lastUpdated,
  };
}
