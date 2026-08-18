import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPlayerSessionCookie, PLAYER_SESSION_COOKIE } from "@/lib/player-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!process.env.PLAYER_SESSION_SECRET) {
    return NextResponse.json(
      { error: "PLAYER_SESSION_SECRET no está configurada" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { login_code } = (body ?? {}) as Record<string, unknown>;
  if (typeof login_code !== "string" || !login_code.trim()) {
    return NextResponse.json({ error: "Ingresá tu código" }, { status: 400 });
  }

  // Admin client: login_code tiene el select revocado para anon/authenticated
  // (ver 0005_mango_system_phase1.sql) — se busca con el service role.
  const supabase = createAdminClient();
  const { data: participant, error } = await supabase
    .from("participants")
    .select("id, nombre_display")
    .eq("login_code", login_code.trim().toUpperCase())
    .maybeSingle();

  if (error) {
    console.error("Login de jugador falló:", error.message);
    return NextResponse.json({ error: "No se pudo validar el código" }, { status: 500 });
  }

  if (!participant) {
    return NextResponse.json({ error: "Código inválido" }, { status: 401 });
  }

  const response = NextResponse.json({ nombre_display: participant.nombre_display });
  response.cookies.set(PLAYER_SESSION_COOKIE, buildPlayerSessionCookie(participant.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 días — no es una sesión admin, no hace falta que expire rápido
  });

  return response;
}
