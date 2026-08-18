import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { getChampionList, type Champion } from "@/lib/champions";

export const dynamic = "force-dynamic";

export interface MangoNotification {
  id: string;
  championName: string;
  championIconUrl: string | null;
}

/**
 * Notificaciones de "te llegó un Mango" sin ver todavía (penalty_progress.seen
 * = false) — no las marca vistas acá (GET sin efectos secundarios): el
 * caller confirma explícito con POST /ack recién después de mostrarlas, así
 * un poll que llega justo antes de que el cliente renderice no se pierde el
 * aviso.
 */
export async function GET() {
  const participantId = await getAuthenticatedParticipantId();
  if (!participantId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: pending, error } = await supabase
    .from("penalty_progress")
    .select("id, mango_id")
    .eq("participant_id", participantId)
    .eq("seen", false)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!pending || pending.length === 0) {
    return NextResponse.json({ notifications: [] });
  }

  const { data: mangos } = await supabase
    .from("mangos")
    .select("id, champion_assigned")
    .in(
      "id",
      pending.map((p) => p.mango_id),
    );
  const championIdByMangoId = new Map((mangos ?? []).map((m) => [m.id, m.champion_assigned]));

  let champions: Champion[] = [];
  try {
    champions = await getChampionList();
  } catch {
    // Sin campeones no podemos resolver el nombre — se cae al id crudo abajo.
  }
  const championById = new Map(champions.map((c) => [c.id, c]));

  const notifications: MangoNotification[] = pending.map((p) => {
    const championId = championIdByMangoId.get(p.mango_id) ?? null;
    const champion = championId ? championById.get(championId) : undefined;
    return {
      id: p.id,
      championName: champion?.name ?? championId ?? "un campeón",
      championIconUrl: champion?.iconUrl ?? null,
    };
  });

  return NextResponse.json({ notifications });
}
