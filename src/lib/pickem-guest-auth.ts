import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { secretsMatch } from "@/lib/secrets";

export const PICKEM_GUEST_SESSION_COOKIE = "pickem_guest_session";

function sign(guestId: string, secret: string): string {
  return createHmac("sha256", secret).update(guestId).digest("hex");
}

/**
 * Mismo esquema que buildPlayerSessionCookie (src/lib/player-auth.ts):
 * "<guest_id>.<hmac>". Usa su PROPIO secreto (PICKEM_GUEST_SESSION_SECRET,
 * no PLAYER_SESSION_SECRET) para que una cookie de invitado firmada nunca
 * pueda confundirse con — ni validarse contra — el espacio de ids de
 * participants; son identidades completamente distintas.
 */
export function buildPickemGuestSessionCookie(guestId: string): string {
  const secret = process.env.PICKEM_GUEST_SESSION_SECRET;
  if (!secret) throw new Error("PICKEM_GUEST_SESSION_SECRET no está configurada");
  return `${guestId}.${sign(guestId, secret)}`;
}

export async function getAuthenticatedGuestId(): Promise<string | null> {
  const secret = process.env.PICKEM_GUEST_SESSION_SECRET;
  if (!secret) return null;

  const cookieStore = await cookies();
  const value = cookieStore.get(PICKEM_GUEST_SESSION_COOKIE)?.value;
  if (!value) return null;

  const separatorIndex = value.lastIndexOf(".");
  if (separatorIndex === -1) return null;

  const guestId = value.slice(0, separatorIndex);
  const providedSignature = value.slice(separatorIndex + 1);
  if (!secretsMatch(providedSignature, sign(guestId, secret))) return null;

  return guestId;
}
