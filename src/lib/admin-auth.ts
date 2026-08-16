import { cookies } from "next/headers";
import { secretsMatch } from "@/lib/secrets";

export const ADMIN_SESSION_COOKIE = "admin_session";

/**
 * Checks the admin session cookie (set by /api/admin/login), and — when a
 * Request is passed — also accepts an `Authorization: Bearer <ADMIN_SECRET>`
 * header, for scripting/curl access without going through the login form.
 */
export async function isAdminAuthenticated(request?: Request): Promise<boolean> {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return false;

  const cookieStore = await cookies();
  const session = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (session && secretsMatch(session, adminSecret)) return true;

  const authHeader = request?.headers.get("authorization");
  if (authHeader && secretsMatch(authHeader, `Bearer ${adminSecret}`)) return true;

  return false;
}
