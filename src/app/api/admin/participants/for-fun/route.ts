import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * Activa/desactiva el modo "For Fun" de un participante (ver
 * 0039_for_fun_mode.sql) — a diferencia de descalificar (que es
 * unidireccional, se revierte desde "Perdonar jugador"), esto es un toggle
 * directo: el admin manda el estado deseado (`for_fun: true` o `false`) en
 * el mismo request.
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

  const { participant_id, for_fun } = (body ?? {}) as Record<string, unknown>;
  if (typeof participant_id !== "string" || typeof for_fun !== "boolean") {
    return NextResponse.json(
      { error: "Faltan participant_id (string) o for_fun (boolean)" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { data: updated, error } = await supabase
    .from("participants")
    .update({ for_fun })
    .eq("id", participant_id)
    .select("id, nombre_display")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Participante no encontrado" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, participant: updated, for_fun });
}
