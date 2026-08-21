import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedParticipantId } from "@/lib/player-auth";

export const dynamic = "force-dynamic";

const HISTORY_LIMIT = 50;

/**
 * Gateado a sesión de /jugador igual que /api/chat/send — aunque la tabla
 * en sí tiene SELECT público a nivel de RLS (requisito técnico para que
 * Realtime funcione, ver la migración), esta ruta es el camino "oficial" de
 * la app y no se lo damos a un visitante sin sesión: el chat es exclusivo
 * entre jugadores registrados, no un chat público de lectura libre.
 */
export async function GET() {
  const participantId = await getAuthenticatedParticipantId();
  if (!participantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) {
    console.error("Failed to load chat_messages:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Se pidió más nuevo primero (para el .limit tomar los últimos 50) — se
  // invierte acá para que el cliente los reciba en orden cronológico normal.
  return NextResponse.json({ messages: (data ?? []).reverse() });
}
