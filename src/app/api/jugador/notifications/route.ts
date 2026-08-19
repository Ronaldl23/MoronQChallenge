import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { getChampionList, type Champion } from "@/lib/champions";
import { resolveAssignedPunishment } from "@/lib/mango-launch";

export const dynamic = "force-dynamic";

export type MangoNotificationKind = "received" | "flagged_for_review" | "launcher_reveal";

export interface MangoNotification {
  id: string;
  kind: MangoNotificationKind;
  /** 'received': quién te lo envió. 'launcher_reveal': quién lo recibió. 'flagged_for_review': no se usa (vacío). */
  otherPartyName: string;
  /**
   * 'flagged_for_review' y 'launcher_reveal': el campeón/Support real, ya
   * es seguro mostrarlo (o vos ya lo revelaste, o es TU notificación sobre
   * lo que le tocó a otro). 'received': vacío a propósito — el castigo
   * todavía no se reveló, mostrarlo acá lo arruinaría.
   */
  championName: string;
  championIconUrl: string | null;
}

export interface NotificationsResponse {
  notifications: MangoNotification[];
  /**
   * Verdad actual (no un evento "nuevo" como `notifications`) de si hay un
   * mango 'pending_reveal' esperando a este participante — independiente de
   * si ya se mostró el toast de "received" (ese se ackea y no vuelve a
   * aparecer; esto sigue reportándose en cada poll mientras siga pendiente,
   * así un dismiss del modal de revelación no lo pierde — se vuelve a
   * ofrecer solo, o desde el banner manual de /jugador).
   */
  pendingReveal: { mangoId: string } | null;
}

/**
 * Notificaciones sin ver todavía, de tres tipos independientes, cada uno
 * con su propio flag de "ya se lo mostré":
 * - "received": te llegó un Mango (penalty_progress.seen = false). Ya NO
 *   revela el castigo — eso pasa recién cuando la persona gira SU PROPIA
 *   ruleta (ver MangoRevealModal), disparada después de este toast, nunca
 *   antes ni en su lugar.
 * - "flagged_for_review": no lo cumpliste a tiempo, quedó pendiente de
 *   revisión manual (status = 'flagged_for_review' && flagged_seen = false).
 * - "launcher_reveal": alguien reveló un mango que VOS lanzaste
 *   (mangos.sent_by_participant_id = vos, status = 'sent',
 *   launcher_notified = false) — acá sí se muestra el resultado, es tu
 *   propia notificación de "a quién le tocó qué", no un spoiler de nada.
 *
 * Efecto secundario en cada corrida (no relacionado a las notificaciones en
 * sí): actualiza participants.last_seen_at — este es el ÚNICO lugar que lo
 * hace, reusando el poll de 20s de MangoNotifications en vez de agregar un
 * endpoint/poller nuevo solo para presencia (ver src/lib/presence.ts).
 *
 * No marca nada vista acá (GET sin efectos secundarios sobre las
 * notificaciones ni sobre pendingReveal): el caller confirma explícito con
 * POST /ack recién después de mostrar cada notificación; pendingReveal no
 * se "ackea" nunca por diseño — deja de aparecer solo cuando el mango deja
 * de estar 'pending_reveal' (se revela).
 */
export async function GET() {
  const participantId = await getAuthenticatedParticipantId();
  if (!participantId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { error: presenceError } = await supabase
    .from("participants")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", participantId);
  if (presenceError) {
    console.error("Failed to update last_seen_at:", presenceError.message);
    // No es crítico para las notificaciones — se sigue igual.
  }

  const [receivedRes, flaggedRes, launcherRevealRes, activePenaltiesRes] = await Promise.all([
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
    supabase
      .from("mangos")
      .select("id, champion_assigned")
      .eq("sent_by_participant_id", participantId)
      .eq("status", "sent")
      .eq("launcher_notified", false)
      .order("created_at", { ascending: true }),
    supabase
      .from("penalty_progress")
      .select("mango_id")
      .eq("participant_id", participantId)
      .eq("status", "pending"),
  ]);

  if (receivedRes.error) {
    return NextResponse.json({ error: receivedRes.error.message }, { status: 500 });
  }
  if (flaggedRes.error) {
    return NextResponse.json({ error: flaggedRes.error.message }, { status: 500 });
  }
  if (launcherRevealRes.error) {
    return NextResponse.json({ error: launcherRevealRes.error.message }, { status: 500 });
  }
  if (activePenaltiesRes.error) {
    return NextResponse.json({ error: activePenaltiesRes.error.message }, { status: 500 });
  }

  const received = receivedRes.data ?? [];
  const flagged = flaggedRes.data ?? [];
  const launcherReveals = launcherRevealRes.data ?? [];
  const activePenalties = activePenaltiesRes.data ?? [];

  let pendingReveal: { mangoId: string } | null = null;
  if (activePenalties.length > 0) {
    const { data: pendingRevealMango } = await supabase
      .from("mangos")
      .select("id")
      .in(
        "id",
        activePenalties.map((p) => p.mango_id),
      )
      .eq("status", "pending_reveal")
      .limit(1)
      .maybeSingle();
    if (pendingRevealMango) pendingReveal = { mangoId: pendingRevealMango.id };
  }

  if (received.length === 0 && flagged.length === 0 && launcherReveals.length === 0) {
    return NextResponse.json({ notifications: [], pendingReveal } satisfies NotificationsResponse);
  }

  const penaltyRows = [...received, ...flagged];
  const { data: mangos } = penaltyRows.length
    ? await supabase
        .from("mangos")
        .select("id, champion_assigned, sent_by_participant_id")
        .in(
          "id",
          penaltyRows.map((p) => p.mango_id),
        )
    : { data: [] };
  const mangoById = new Map((mangos ?? []).map((m) => [m.id, m]));

  // Nombres: remitentes (para received/flagged, vía mango.sent_by) y
  // receptores (para launcher_reveal, vía penalty_progress del mango).
  const senderIds = [...new Set((mangos ?? []).map((m) => m.sent_by_participant_id).filter((id) => id !== null))];

  let recipientByMangoId = new Map<string, string>();
  if (launcherReveals.length > 0) {
    const { data: recipientPenalties } = await supabase
      .from("penalty_progress")
      .select("mango_id, participant_id")
      .in(
        "mango_id",
        launcherReveals.map((m) => m.id),
      );
    recipientByMangoId = new Map((recipientPenalties ?? []).map((p) => [p.mango_id, p.participant_id]));
  }
  const recipientIds = [...new Set(recipientByMangoId.values())];

  const nameIds = [...new Set([...senderIds, ...recipientIds])];
  const { data: participantsData } = nameIds.length
    ? await supabase.from("participants").select("id, nombre_display").in("id", nameIds)
    : { data: [] };
  const nameById = new Map((participantsData ?? []).map((p) => [p.id, p.nombre_display]));

  let champions: Champion[] = [];
  if (flagged.length > 0 || launcherReveals.length > 0) {
    try {
      champions = await getChampionList();
    } catch {
      // Sin campeones se cae al id crudo dentro de resolveAssignedPunishment.
    }
  }
  const championById = new Map(champions.map((c) => [c.id, c]));

  const notifications: MangoNotification[] = [
    ...received.map((p): MangoNotification => {
      const mango = mangoById.get(p.mango_id);
      const senderName = (mango?.sent_by_participant_id && nameById.get(mango.sent_by_participant_id)) || "Alguien";
      return {
        id: p.id,
        kind: "received",
        otherPartyName: senderName,
        championName: "",
        championIconUrl: null,
      };
    }),
    ...flagged.map((p): MangoNotification => {
      const mango = mangoById.get(p.mango_id);
      const resolved = resolveAssignedPunishment(mango?.champion_assigned ?? null, championById);
      return {
        id: p.id,
        kind: "flagged_for_review",
        otherPartyName: "",
        championName: resolved.name,
        championIconUrl: resolved.iconUrl,
      };
    }),
    ...launcherReveals.map((m): MangoNotification => {
      const resolved = resolveAssignedPunishment(m.champion_assigned, championById);
      const recipientId = recipientByMangoId.get(m.id);
      const recipientName = (recipientId && nameById.get(recipientId)) || "Alguien";
      return {
        id: m.id,
        kind: "launcher_reveal",
        otherPartyName: recipientName,
        championName: resolved.name,
        championIconUrl: resolved.iconUrl,
      };
    }),
  ];

  return NextResponse.json({ notifications, pendingReveal } satisfies NotificationsResponse);
}
