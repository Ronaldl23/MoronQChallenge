import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { generateLoginCode } from "@/lib/login-code";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

const ACCESS_CODE_ATTEMPTS = 5;

/** Mismo patrón de reintento-ante-choque que insertParticipantWithLoginCode (src/app/api/participants/route.ts). */
async function insertGuestWithAccessCode(supabase: SupabaseClient<Database>, displayName: string) {
  let lastError: { code?: string; message: string } | null = null;

  for (let attempt = 0; attempt < ACCESS_CODE_ATTEMPTS; attempt++) {
    const access_code = generateLoginCode();
    const { data, error } = await supabase
      .from("pickem_guests")
      .insert({ display_name: displayName, access_code })
      .select()
      .single();

    if (!error) return { data, error: null };
    if (error.code === "23505" && error.message.includes("access_code")) {
      lastError = error;
      continue;
    }
    return { data: null, error };
  }

  return { data: null, error: lastError ?? { message: "No se pudo generar un código único" } };
}

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

  const { display_name } = (body ?? {}) as Record<string, unknown>;
  if (typeof display_name !== "string" || !display_name.trim()) {
    return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: guest, error } = await insertGuestWithAccessCode(supabase, display_name.trim());

  if (error || !guest) {
    console.error("Crear invitado de Pick'em falló:", error?.message);
    return NextResponse.json({ error: "No se pudo crear el invitado" }, { status: 500 });
  }

  return NextResponse.json({ guest });
}
