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
  // Un solo envío por persona, sin ediciones posteriores (pedido explícito:
  // "cuando mandas tu pickem ya no lo puedes editar") — a diferencia del
  // upsert de antes, un INSERT simple falla con 23505 (unique violation) si
  // ya existe una fila para este dueño, que es exactamente la señal que
  // necesitamos para rechazar el reenvío. La constraint unique sobre
  // participant_id/guest_id (la misma que antes usaba onConflict) es la que
  // hace de fuente de verdad real — este chequeo no depende de una lectura
  // previa que podría pisarse con una carrera entre dos pestañas.
  const { error } =
    identity.ownerType === "participant"
      ? await supabase
          .from("pickem_picks")
          .insert({ participant_id: identity.ownerId, predicted_order: validated.order, updated_at })
      : await supabase
          .from("pickem_picks")
          .insert({ guest_id: identity.ownerId, predicted_order: validated.order, updated_at });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya enviaste tu Pick'em — no se puede editar." },
        { status: 409 },
      );
    }
    console.error("Guardar Pick'em falló:", error.message);
    return NextResponse.json({ error: "No se pudo guardar el pick" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
