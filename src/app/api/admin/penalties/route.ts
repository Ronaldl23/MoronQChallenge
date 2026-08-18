import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getChampionList, type Champion } from "@/lib/champions";
import { resolveAssignedPunishment } from "@/lib/mango-launch";

export const dynamic = "force-dynamic";

export interface FlaggedPenalty {
  id: string;
  participantName: string;
  senderName: string;
  championName: string;
  championIconUrl: string | null;
  gamesWithoutCompliance: number;
  createdAt: string;
}

/**
 * Fase 4: cola de revisión manual. Castigos en 'flagged_for_review' — se
 * pasaron de las PENALTY_GAME_LIMIT partidas sin cumplirse (ver
 * src/lib/penalty.ts y su integración en /api/update-rankings) y esperan
 * que el admin confirme la descalificación o perdone acá.
 */
export async function GET(request: Request) {
  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: flagged, error } = await supabase
    .from("penalty_progress")
    .select("id, participant_id, mango_id, games_without_compliance, created_at")
    .eq("status", "flagged_for_review")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!flagged || flagged.length === 0) {
    return NextResponse.json({ penalties: [] });
  }

  const { data: mangos } = await supabase
    .from("mangos")
    .select("id, champion_assigned, sent_by_participant_id")
    .in(
      "id",
      flagged.map((f) => f.mango_id),
    );
  const mangoById = new Map((mangos ?? []).map((m) => [m.id, m]));

  const participantIds = [
    ...new Set([
      ...flagged.map((f) => f.participant_id),
      ...(mangos ?? [])
        .map((m) => m.sent_by_participant_id)
        .filter((id): id is string => id !== null),
    ]),
  ];
  const { data: participants } = participantIds.length
    ? await supabase.from("participants").select("id, nombre_display").in("id", participantIds)
    : { data: [] };
  const nameById = new Map((participants ?? []).map((p) => [p.id, p.nombre_display]));

  let champions: Champion[] = [];
  try {
    champions = await getChampionList();
  } catch {
    // Sin campeones no podemos resolver el nombre — se cae al id crudo abajo.
  }
  const championById = new Map(champions.map((c) => [c.id, c]));

  const penalties: FlaggedPenalty[] = flagged.map((f) => {
    const mango = mangoById.get(f.mango_id);
    const resolved = resolveAssignedPunishment(mango?.champion_assigned ?? null, championById);
    const senderName =
      (mango?.sent_by_participant_id && nameById.get(mango.sent_by_participant_id)) || "Alguien";
    return {
      id: f.id,
      participantName: nameById.get(f.participant_id) ?? "Desconocido",
      senderName,
      championName: resolved.name,
      championIconUrl: resolved.iconUrl,
      gamesWithoutCompliance: f.games_without_compliance,
      createdAt: f.created_at,
    };
  });

  return NextResponse.json({ penalties });
}
