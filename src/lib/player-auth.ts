import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { secretsMatch } from "@/lib/secrets";

export const PLAYER_SESSION_COOKIE = "player_session";

function sign(participantId: string, secret: string): string {
  return createHmac("sha256", secret).update(participantId).digest("hex");
}

/**
 * A diferencia de ADMIN_SESSION_COOKIE (que guarda el secreto compartido
 * tal cual), acá cada jugador es una identidad distinta — la cookie tiene
 * que decir CUÁL participante sin que el navegador pueda falsificarlo. Se
 * firma "<participant_id>.<hmac>" con un secreto que el cliente nunca ve;
 * cambiar el id a mano invalida la firma.
 */
export function buildPlayerSessionCookie(participantId: string): string {
  const secret = process.env.PLAYER_SESSION_SECRET;
  if (!secret) throw new Error("PLAYER_SESSION_SECRET no está configurada");
  return `${participantId}.${sign(participantId, secret)}`;
}

export async function getAuthenticatedParticipantId(): Promise<string | null> {
  const secret = process.env.PLAYER_SESSION_SECRET;
  if (!secret) return null;

  const cookieStore = await cookies();
  const value = cookieStore.get(PLAYER_SESSION_COOKIE)?.value;
  if (!value) return null;

  const separatorIndex = value.lastIndexOf(".");
  if (separatorIndex === -1) return null;

  const participantId = value.slice(0, separatorIndex);
  const providedSignature = value.slice(separatorIndex + 1);
  if (!secretsMatch(providedSignature, sign(participantId, secret))) return null;

  return participantId;
}
