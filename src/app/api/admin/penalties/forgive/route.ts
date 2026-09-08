import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * Perdona UN SOLO castigo puntual (no todo el jugador, ver
 * /api/admin/penalties/resolve para eso) — para cuando un castigo se
 * generó por un problema real (cursor mal reseteado, un bug de una
 * corrida, etc.) y no por algo que el jugador hizo. Lo marca 'completed',
 * mismo efecto visual que si lo hubiera cumplido jugando, Y resetea
 * penalty_games_without_compliance a 0 — igual que una compliance real
 * (ver processPenaltyMatches en src/lib/penalty.ts, que resetea el
 * contador compartido al cumplir CUALQUIERA del grupo). Sin este reset el
 * contador podía seguir alto de antes y agotar la ventana de nuevo con
 * las próximas partidas, generando OTRO castigo por incumplimiento en
 * cadena — bug real reportado (caso Juan Ruiz / Elise) de perdonar a mano
 * por SQL sin este segundo paso.
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

  const { penalty_progress_id } = (body ?? {}) as Record<string, unknown>;
  if (typeof penalty_progress_id !== "string") {
    return NextResponse.json({ error: "Falta penalty_progress_id" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: penalty, error: penaltyError } = await supabase
    .from("penalty_progress")
    .select("id, participant_id, status")
    .eq("id", penalty_progress_id)
    .maybeSingle();
  if (penaltyError) {
    return NextResponse.json({ error: penaltyError.message }, { status: 500 });
  }
  if (!penalty || penalty.status !== "pending") {
    return NextResponse.json({ error: "Ese castigo no está pendiente" }, { status: 409 });
  }

  const { error: updateError } = await supabase
    .from("penalty_progress")
    .update({ status: "completed", completed: true })
    .eq("id", penalty_progress_id)
    .eq("status", "pending");
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { error: counterError } = await supabase
    .from("participants")
    .update({ penalty_games_without_compliance: 0 })
    .eq("id", penalty.participant_id);
  if (counterError) {
    return NextResponse.json({ error: counterError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
