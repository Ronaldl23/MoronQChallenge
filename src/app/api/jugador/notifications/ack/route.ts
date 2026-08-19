import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import type { MangoNotificationKind } from "../route";

export const dynamic = "force-dynamic";

interface AckItem {
  id: string;
  kind: MangoNotificationKind;
}

function isAckItem(value: unknown): value is AckItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    (item.kind === "received" || item.kind === "flagged_for_review" || item.kind === "launcher_reveal")
  );
}

/**
 * Marca notificaciones como vistas — llamado recién después de mostrarlas
 * en el cliente (ver GET /api/jugador/notifications). Cada `kind` vive en
 * una tabla/columna distinta, así que el ack necesita saber cuál es cuál
 * (antes alcanzaba con una lista plana de ids porque las dos únicas kinds
 * vivían en la misma fila de penalty_progress).
 */
export async function POST(request: Request) {
  const participantId = await getAuthenticatedParticipantId();
  if (!participantId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { items } = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(items) || !items.every(isAckItem)) {
    return NextResponse.json({ error: "items inválido" }, { status: 400 });
  }
  if (items.length === 0) {
    return NextResponse.json({ ok: true });
  }

  const supabase = createAdminClient();

  // received/flagged_for_review viven en penalty_progress — se marcan AMBOS
  // flags (seen + flagged_seen) sin importar de cuál vino el id, mismo
  // criterio que antes: el GET puede devolver el mismo penalty_progress.id
  // representando las dos notificaciones si el jugador nunca vio la
  // primera antes de que el castigo pasara a revisión.
  const penaltyIds = items
    .filter((item) => item.kind === "received" || item.kind === "flagged_for_review")
    .map((item) => item.id);
  // launcher_reveal vive en mangos.launcher_notified — el sent_by ahí
  // abajo es lo que impide que alguien ackee el mango de otro pasando un id
  // a mano (mismo rol que el scoping a participant_id de penalty_progress).
  const mangoIds = items.filter((item) => item.kind === "launcher_reveal").map((item) => item.id);

  const [penaltyResult, mangoResult] = await Promise.all([
    penaltyIds.length
      ? supabase
          .from("penalty_progress")
          .update({ seen: true, flagged_seen: true })
          .eq("participant_id", participantId)
          .in("id", penaltyIds)
      : Promise.resolve({ error: null }),
    mangoIds.length
      ? supabase
          .from("mangos")
          .update({ launcher_notified: true })
          .eq("sent_by_participant_id", participantId)
          .in("id", mangoIds)
      : Promise.resolve({ error: null }),
  ]);

  if (penaltyResult.error) {
    return NextResponse.json({ error: penaltyResult.error.message }, { status: 500 });
  }
  if (mangoResult.error) {
    return NextResponse.json({ error: mangoResult.error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
