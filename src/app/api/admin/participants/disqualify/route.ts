import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * Descalificación manual — independiente del sistema de castigos de
 * mangos (ver src/lib/penalty.ts, que descalifica automático por no
 * cumplir uno a tiempo). Esta vía es para motivos que no tienen mango de
 * por medio (trampa, conducta, etc.): un admin la dispara a mano, con un
 * motivo en texto libre que solo ve el admin (ver
 * 0019_manual_disqualification.sql — disqualification_reason no es
 * pública). Perdonarlo es el mismo botón "Perdonar jugador" de siempre
 * (ver /api/admin/penalties/resolve), que limpia esta vía junto con
 * cualquier castigo 'disqualified' que tenga.
 */
export async function POST(request: Request) {
  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { participant_id, reason } = (body ?? {}) as Record<string, unknown>;
  if (typeof participant_id !== "string" || typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json(
      { error: "Faltan participant_id o reason (el motivo no puede estar vacío)" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { data: updated, error } = await supabase
    .from("participants")
    .update({ manually_disqualified: true, disqualification_reason: reason.trim() })
    .eq("id", participant_id)
    .select("id, nombre_display")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Participante no encontrado" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, participant: updated });
}
