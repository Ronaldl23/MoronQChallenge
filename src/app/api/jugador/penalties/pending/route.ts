import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { getChampionList } from "@/lib/champions";
import { getSummonerSpellList } from "@/lib/summoner-spells";
import { fetchPendingPunishments, type PendingPunishment } from "@/lib/pending-penalties";
import { PENALTY_GAME_LIMIT } from "@/lib/penalty";

export const dynamic = "force-dynamic";

export interface PendingPenaltiesResponse {
  punishments: PendingPunishment[];
  gamesWithoutCompliance: number;
  penaltyGameLimit: number;
}

/**
 * Detalle de los castigos pendientes propios YA revelados — lo pide
 * GlobalPenaltyAlert (ver src/components/GlobalPenaltyAlert.tsx) al abrir su
 * modal, on-demand, para no cargar campeones/hechizos/mangos en CADA página
 * del sitio (el ícono en sí solo necesita penalty_games_without_compliance,
 * que layout.tsx ya trae con el resto del chequeo de sesión). Mismo shape
 * que el banner de /jugador (fetchPendingPunishments).
 */
export async function GET() {
  const participantId = await getAuthenticatedParticipantId();
  if (!participantId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const [{ data: participant }, { data: pendingPenalties }] = await Promise.all([
    supabase
      .from("participants")
      .select("penalty_games_without_compliance")
      .eq("id", participantId)
      .maybeSingle(),
    supabase
      .from("penalty_progress")
      .select("id, mango_id")
      .eq("participant_id", participantId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);

  // Solo se piden si hace falta — la mayoría de los polls de
  // GlobalPenaltyAlert (cada 20s, en CUALQUIER página) van a encontrar cero
  // castigos pendientes, y getChampionList/getSummonerSpellList (aunque
  // cacheadas 1h) no vale la pena pedirlas para un resultado que va a ser [].
  let champions: Awaited<ReturnType<typeof getChampionList>> = [];
  let spells: Awaited<ReturnType<typeof getSummonerSpellList>> = [];
  if (pendingPenalties && pendingPenalties.length > 0) {
    try {
      [champions, spells] = await Promise.all([getChampionList(), getSummonerSpellList()]);
    } catch {
      // fetchPendingPunishments cae al id crudo dentro de resolveAssignedPunishment.
    }
  }

  const punishments = await fetchPendingPunishments(supabase, pendingPenalties ?? [], champions, spells);

  return NextResponse.json({
    punishments,
    gamesWithoutCompliance: participant?.penalty_games_without_compliance ?? 0,
    penaltyGameLimit: PENALTY_GAME_LIMIT,
  } satisfies PendingPenaltiesResponse);
}
