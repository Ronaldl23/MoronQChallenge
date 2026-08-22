import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildPickemGuestSessionCookie,
  PICKEM_GUEST_SESSION_COOKIE,
} from "@/lib/pickem-guest-auth";
import { normalizeLoginCode } from "@/lib/login-code";

export const dynamic = "force-dynamic";

/** Mismo flujo que /api/jugador/login, pero contra pickem_guests.access_code en vez de participants.login_code. */
export async function POST(request: Request) {
  if (!process.env.PICKEM_GUEST_SESSION_SECRET) {
    return NextResponse.json(
      { error: "PICKEM_GUEST_SESSION_SECRET no está configurada" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { access_code } = (body ?? {}) as Record<string, unknown>;
  if (typeof access_code !== "string" || !access_code.trim()) {
    return NextResponse.json({ error: "Ingresá tu código" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: guest, error } = await supabase
    .from("pickem_guests")
    .select("id, display_name")
    .eq("access_code", normalizeLoginCode(access_code))
    .maybeSingle();

  if (error) {
    console.error("Login de invitado de Pick'em falló:", error.message);
    return NextResponse.json({ error: "No se pudo validar el código" }, { status: 500 });
  }

  if (!guest) {
    return NextResponse.json({ error: "Código inválido" }, { status: 401 });
  }

  const response = NextResponse.json({ display_name: guest.display_name });
  response.cookies.set(
    PICKEM_GUEST_SESSION_COOKIE,
    buildPickemGuestSessionCookie(guest.id),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 días — igual que la sesión de jugador
    },
  );

  return response;
}
