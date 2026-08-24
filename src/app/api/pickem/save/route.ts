import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getPickemViewerIdentity,
  getPickemRoster,
  isPickemLocked,
  validatePredictedOrder,
} from "@/lib/pickem";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await getPickemViewerIdentity();
  if (!identity) {
    return NextResponse.json({ error: "No hay sesión activa" }, { status: 401 });
  }

  // Chequeo real de bloqueo — la UI ya deshabilita el botón antes de esto,
  // pero eso es solo cosmético: esta comparación server-side es la que de
  // verdad impide guardar/editar una vez que pasó PICKEM_LOCK_DATE (3 días
  // de gracia después del inicio del torneo, ver src/lib/config.ts), sin
  // importar si quien pega acá es jugador o invitado.
  if (isPickemLocked()) {
    return NextResponse.json(
      { error: "El Pick'em ya está bloqueado — pasó la fecha límite" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { order } = (body ?? {}) as Record<string, unknown>;
  const roster = await getPickemRoster();
  const validated = validatePredictedOrder(order, roster.map((p) => p.id));
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const supabase = createAdminClient();
  const updated_at = new Date().toISOString();
  const { error } =
    identity.ownerType === "participant"
      ? await supabase
          .from("pickem_picks")
          .upsert(
            { participant_id: identity.ownerId, predicted_order: validated.order, updated_at },
            { onConflict: "participant_id" },
          )
      : await supabase
          .from("pickem_picks")
          .upsert(
            { guest_id: identity.ownerId, predicted_order: validated.order, updated_at },
            { onConflict: "guest_id" },
          );

  if (error) {
    console.error("Guardar Pick'em falló:", error.message);
    return NextResponse.json({ error: "No se pudo guardar el pick" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
