import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { getChampionList, type Champion } from "@/lib/champions";
import { resolveAssignedPunishment } from "@/lib/mango-launch";

export const dynamic = "force-dynamic";

export interface MangoNotification {
  id: string;
  championName: string;
  championIconUrl: string | null;
  senderName: string;
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
    .select("id, champion_assigned, sent_by_participant_id")
    .in(
      "id",
      pending.map((p) => p.mango_id),
    );
  const mangoById = new Map((mangos ?? []).map((m) => [m.id, m]));

  const senderIds = [...new Set((mangos ?? []).map((m) => m.sent_by_participant_id).filter((id) => id !== null))];
  const { data: senders } = senderIds.length
    ? await supabase.from("participants").select("id, nombre_display").in("id", senderIds)
    : { data: [] };
  const senderNameById = new Map((senders ?? []).map((s) => [s.id, s.nombre_display]));

  let champions: Champion[] = [];
  try {
    champions = await getChampionList();
  } catch {
    // Sin campeones no podemos resolver el nombre — se cae al id crudo abajo.
  }
  const championById = new Map(champions.map((c) => [c.id, c]));

  const notifications: MangoNotification[] = pending.map((p) => {
    const mango = mangoById.get(p.mango_id);
    const resolved = resolveAssignedPunishment(mango?.champion_assigned ?? null, championById);
    const senderName =
      (mango?.sent_by_participant_id && senderNameById.get(mango.sent_by_participant_id)) ||
      "Alguien";
    return {
      id: p.id,
      championName: resolved.name,
      championIconUrl: resolved.iconUrl,
      senderName,
    };
  });

  return NextResponse.json({ notifications });
}
