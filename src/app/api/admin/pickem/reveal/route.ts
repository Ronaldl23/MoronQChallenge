import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("pickem_settings")
    .select("results_revealed, revealed_at")
    .eq("id", true)
    .maybeSingle();

  return NextResponse.json({
    results_revealed: data?.results_revealed ?? false,
    revealed_at: data?.revealed_at ?? null,
  });
}

/**
 * Activado a mano desde /admin cuando el torneo termina de verdad — nunca
 * automático por fecha. Una vez en true no hay endpoint para volver a
 * false: es una acción de un solo sentido (revelar), consistente con el
 * pedido ("yo activo manualmente... cuando el torneo termina de verdad").
 */
export async function POST(request: Request) {
  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("pickem_settings")
    .update({ results_revealed: true, revealed_at: new Date().toISOString() })
    .eq("id", true);

  if (error) {
    console.error("Revelar resultados de Pick'em falló:", error.message);
    return NextResponse.json({ error: "No se pudo revelar los resultados" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
