import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * Perdona a un JUGADOR completo, sin importar por cuál de las dos vías
 * quedó descalificado (pueden darse las dos a la vez):
 *
 * 1. Castigo de mango sin cumplir a tiempo ('disqualified' automático, ver
 *    src/lib/penalty.ts) — NO se borra: se devuelve a 'pending' con
 *    `created_at` reseteado a ahora (ventana de PENALTY_GAME_LIMIT
 *    partidas fresca) para que lo tenga que cumplir de nuevo, tal como se
 *    le había asignado. Se incluye 'flagged_for_review' junto con
 *    'disqualified' para poder perdonar también filas viejas de la cola de
 *    revisión manual anterior a ese cambio.
 * 2. Descalificación manual desde /admin (ver
 *    /api/admin/participants/disqualify) — se limpia el flag y el motivo.
 *
 * Solo aplica si de verdad había algo para perdonar en AL MENOS una de las
 * dos vías (los .select() de abajo) — evita que un doble click o dos
 * pestañas de /admin resuelvan lo mismo dos veces.
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

  const [{ data: restored, error: restoreError }, { data: manualCleared, error: manualError }] =
    await Promise.all([
      supabase
        .from("penalty_progress")
        .update({
          status: "pending",
          completed: false,
          created_at: new Date().toISOString(),
        })
        .eq("participant_id", participant_id)
        .in("status", ["disqualified", "flagged_for_review"])
        .select("id"),
      supabase
        .from("participants")
        .update({ manually_disqualified: false, disqualification_reason: null })
        .eq("id", participant_id)
        .eq("manually_disqualified", true)
        .select("id"),
    ]);

  if (restoreError) {
    return NextResponse.json({ error: restoreError.message }, { status: 500 });
  }
  if (manualError) {
    return NextResponse.json({ error: manualError.message }, { status: 500 });
  }

  const restoredCount = restored?.length ?? 0;
  const manualDisqualificationCleared = (manualCleared?.length ?? 0) > 0;
  if (restoredCount === 0 && !manualDisqualificationCleared) {
    return NextResponse.json(
      { error: "Ese jugador no está descalificado (¿ya se perdonó antes?)" },
      { status: 409 },
    );
  }

  // Ventana fresca para el grupo de castigos que le acabamos de devolver —
  // mismo criterio que "sin castigos pendientes no hay contador corriendo"
  // (regla 5 de src/lib/penalty.ts), solo que acá arranca en 0 porque
  // recién le acabamos de crear pendientes de nuevo. Si lo único que había
  // era la descalificación manual (sin castigos restaurados), no hace
  // falta tocar el contador.
  if (restoredCount > 0) {
    const { error: counterError } = await supabase
      .from("participants")
      .update({ penalty_games_without_compliance: 0 })
      .eq("id", participant_id);
    if (counterError) {
      return NextResponse.json({ error: counterError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, restoredCount, manualDisqualificationCleared });
}
