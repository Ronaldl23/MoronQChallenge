import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * Perdona a un JUGADOR completo (ya no existe perdón por castigo
 * individual — la descalificación ahora es automática, ver
 * src/lib/penalty.ts, así que tampoco hace falta un "confirmar
 * descalificación" acá: eso ya pasó solo).
 *
 * Perdonar NO borra los castigos por los que se descalificó — se los
 * devuelve a 'pending' con `created_at` reseteado a ahora (ventana de
 * PENALTY_GAME_LIMIT partidas fresca, contando desde este momento) para
 * que los tenga que cumplir de nuevo, tal como se le habían asignado. Se
 * incluye 'flagged_for_review' junto con 'disqualified' para poder
 * perdonar también filas viejas de la cola de revisión manual anterior a
 * este cambio.
 *
 * Solo aplica si de verdad había algo para perdonar (el .select() de
 * abajo, igual que el resto de las rutas de mangos) — evita que un doble
 * click o dos pestañas de /admin resuelvan lo mismo dos veces.
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

  const { participant_id } = (body ?? {}) as Record<string, unknown>;
  if (typeof participant_id !== "string") {
    return NextResponse.json({ error: "Falta participant_id" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: restored, error: restoreError } = await supabase
    .from("penalty_progress")
    .update({
      status: "pending",
      completed: false,
      created_at: new Date().toISOString(),
    })
    .eq("participant_id", participant_id)
    .in("status", ["disqualified", "flagged_for_review"])
    .select("id");

  if (restoreError) {
    return NextResponse.json({ error: restoreError.message }, { status: 500 });
  }
  if (!restored || restored.length === 0) {
    return NextResponse.json(
      { error: "Ese jugador no está descalificado (¿ya se perdonó antes?)" },
      { status: 409 },
    );
  }

  // Ventana fresca para el grupo de castigos que le acabamos de devolver —
  // mismo criterio que "sin castigos pendientes no hay contador corriendo"
  // (regla 5 de src/lib/penalty.ts), solo que acá arranca en 0 porque
  // recién le acabamos de crear pendientes de nuevo.
  const { error: counterError } = await supabase
    .from("participants")
    .update({ penalty_games_without_compliance: 0 })
    .eq("id", participant_id);
  if (counterError) {
    return NextResponse.json({ error: counterError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, restoredCount: restored.length });
}
