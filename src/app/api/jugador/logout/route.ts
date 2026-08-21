import { NextResponse } from "next/server";
import { PLAYER_SESSION_COOKIE } from "@/lib/player-auth";

export const dynamic = "force-dynamic";

/**
 * Invalida la cookie de sesión de /jugador (mismo cookie que setea
 * /api/jugador/login) — path/httpOnly/sameSite tienen que coincidir con
 * los del set original para que el navegador realmente la borre en vez de
 * quedarse con dos cookies del mismo nombre en paths distintos.
 */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(PLAYER_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
