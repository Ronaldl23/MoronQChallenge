import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedParticipantId } from "@/lib/player-auth";

export const dynamic = "force-dynamic";

/** Marca notificaciones como vistas — llamado recién después de mostrarlas en el cliente (ver GET /api/jugador/notifications). */
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

  const { ids } = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "ids inválido" }, { status: 400 });
  }
  if (ids.length === 0) {
    return NextResponse.json({ ok: true });
  }

  const supabase = createAdminClient();
  // Scoped a participant_id, no solo a los ids: aunque estos ya vinieron de
  // un GET correctamente filtrado, un cliente malicioso podría mandar ids
  // ajenos a mano — esto es lo que en verdad lo impide.
  //
  // Marca AMBOS flags de "ya visto" (seen + flagged_seen) sin importar de
  // cuál de los dos avisos vino el id: el GET puede devolver el mismo
  // penalty_progress.id representando dos notificaciones distintas si el
  // jugador nunca vio la de "te llegó un Mango" antes de que el castigo
  // pasara a revisión — el cliente ya las trata por separado (ver
  // MangoNotifications.tsx), así que acá alcanza con limpiar los dos.
  const { error } = await supabase
    .from("penalty_progress")
    .update({ seen: true, flagged_seen: true })
    .eq("participant_id", participantId)
    .in("id", ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
