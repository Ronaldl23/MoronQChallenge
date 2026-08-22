import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { isChatOpenAt } from "@/lib/chat-lock";
import { TOURNAMENT_START_DATE, TOURNAMENT_END_DATE } from "@/lib/config";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_LENGTH = 500;

/**
 * Único punto de escritura del chat: chat_messages no tiene policy de
 * INSERT pública (no hay Supabase Auth acá, ver 0013_chat_messages.sql), así
 * que la cookie firmada de /jugador ES la autorización — sin sesión válida,
 * 401 y no se inserta nada.
 */
export async function POST(request: Request) {
  const participantId = await getAuthenticatedParticipantId();
  if (!participantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Chequeo real de la ventana del chat — el widget ya deshabilita el
  // formulario antes de esto, pero eso es solo cosmético: esta comparación
  // server-side es la que de verdad impide escribir fuera de la ventana
  // del torneo (antes de que arranque, o después de que termine).
  if (!isChatOpenAt(Date.now(), TOURNAMENT_START_DATE, TOURNAMENT_END_DATE)) {
    return NextResponse.json(
      { error: "El chat solo está abierto durante el torneo" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { message } = (body ?? {}) as Record<string, unknown>;
  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json(
      { error: "El mensaje no puede estar vacío" },
      { status: 400 },
    );
  }
  const trimmed = message.trim();
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      {
        error: `El mensaje no puede superar los ${MAX_MESSAGE_LENGTH} caracteres`,
      },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  // Snapshot de la identidad ACTUAL del remitente al momento de enviar —
  // ver el comentario en 0013_chat_messages.sql sobre por qué va
  // denormalizada en vez de un join en la lectura.
  const { data: participant, error: participantError } = await supabase
    .from("participants")
    .select("nombre_display, avatar_url, profile_icon_id")
    .eq("id", participantId)
    .single();

  if (participantError || !participant) {
    return NextResponse.json(
      { error: "Participante no encontrado" },
      { status: 404 },
    );
  }

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      participant_id: participantId,
      sender_name: participant.nombre_display,
      sender_avatar_url: participant.avatar_url,
      sender_profile_icon_id: participant.profile_icon_id,
      message: trimmed,
    })
    .select()
    .single();

  if (error) {
    console.error("Insert de chat_message falló:", error.code, error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: data }, { status: 201 });
}
