import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { getChampionList, type Champion } from "@/lib/champions";
import { resolveAssignedPunishment } from "@/lib/mango-launch";

export const dynamic = "force-dynamic";

export type MangoNotificationKind = "received" | "flagged_for_review";

export interface MangoNotification {
  id: string;
  kind: MangoNotificationKind;
  championName: string;
  championIconUrl: string | null;
  senderName: string;
}

/**
 * Notificaciones sin ver todavía, de dos tipos independientes (pueden pasar
 * en momentos distintos para el mismo castigo, cada uno con su propio flag
 * de "ya se lo mostré" — ver 0008_penalty_review.sql):
 * - "received": te llegó un Mango (penalty_progress.seen = false).
 * - "flagged_for_review": no lo cumpliste a tiempo, quedó pendiente de
 *   revisión manual (status = 'flagged_for_review' && flagged_seen = false).
 *
 * No las marca vistas acá (GET sin efectos secundarios): el caller confirma
 * explícito con POST /ack recién después de mostrarlas, así un poll que
 * llega justo antes de que el cliente renderice no se pierde el aviso.
 */
export async function GET() {
  const participantId = await getAuthenticatedParticipantId();
  if (!participantId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const [receivedRes, flaggedRes] = await Promise.all([
    supabase
      .from("penalty_progress")
      .select("id, mango_id")
      .eq("participant_id", participantId)
      .eq("seen", false)
      .order("created_at", { ascending: true }),
    supabase
      .from("penalty_progress")
      .select("id, mango_id")
      .eq("participant_id", participantId)
      .eq("status", "flagged_for_review")
      .eq("flagged_seen", false)
      .order("created_at", { ascending: true }),
  ]);

  if (receivedRes.error) {
    return NextResponse.json({ error: receivedRes.error.message }, { status: 500 });
  }
  if (flaggedRes.error) {
    return NextResponse.json({ error: flaggedRes.error.message }, { status: 500 });
  }

  const received = (receivedRes.data ?? []).map((p) => ({ ...p, kind: "received" as const }));
  const flagged = (flaggedRes.data ?? []).map((p) => ({ ...p, kind: "flagged_for_review" as const }));
  const pending = [...received, ...flagged];

  if (pending.length === 0) {
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
      kind: p.kind,
      championName: resolved.name,
      championIconUrl: resolved.iconUrl,
      senderName,
    };
  });

  return NextResponse.json({ notifications });
}
