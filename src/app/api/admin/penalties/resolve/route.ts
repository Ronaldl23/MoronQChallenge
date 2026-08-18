import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * Resuelve manualmente un castigo en 'flagged_for_review' — NUNCA
 * automático (regla explícita del usuario): esta es la única forma de que
 * un castigo pase a 'disqualified' o 'pardoned'.
 *
 * Solo aplica el cambio si el estado actual sigue siendo
 * 'flagged_for_review' (el .eq de abajo, combinado con .select().maybeSingle()
 * para saber si de verdad pisó algo) — evita que un doble click o dos
 * pestañas de /admin abiertas a la vez resuelvan el mismo castigo dos veces.
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

  const { id, action } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== "string" || (action !== "disqualify" && action !== "pardon")) {
    return NextResponse.json(
      { error: "Faltan id o action (esperado 'disqualify' o 'pardon')" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const newStatus = action === "disqualify" ? "disqualified" : "pardoned";

  const { data, error } = await supabase
    .from("penalty_progress")
    .update({ status: newStatus })
    .eq("id", id)
    .eq("status", "flagged_for_review")
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "Ese castigo ya no está pendiente de revisión (¿ya se resolvió antes?)" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, status: newStatus });
}
