import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * Activa/desactiva la excepción "sin límite de partidas" de un participante
 * (unlimited_games_tracking, ver 0040_games_tracking_limit.sql) — mismo
 * patrón de toggle directo que /api/admin/participants/for-fun: el admin
 * manda el estado deseado en el mismo request.
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

  const { participant_id, unlimited_games_tracking } = (body ?? {}) as Record<string, unknown>;
  if (typeof participant_id !== "string" || typeof unlimited_games_tracking !== "boolean") {
    return NextResponse.json(
      { error: "Faltan participant_id (string) o unlimited_games_tracking (boolean)" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { data: updated, error } = await supabase
    .from("participants")
    .update({ unlimited_games_tracking })
    .eq("id", participant_id)
    .select("id, nombre_display")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Participante no encontrado" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, participant: updated, unlimited_games_tracking });
}
