import { NextResponse } from "next/server";
import { PICKEM_GUEST_SESSION_COOKIE } from "@/lib/pickem-guest-auth";

export const dynamic = "force-dynamic";

/** Mismo patrón que /api/jugador/logout — las opciones tienen que coincidir con las del set original para que el navegador la borre de verdad. */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(PICKEM_GUEST_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
