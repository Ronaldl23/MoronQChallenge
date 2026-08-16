import { cookies } from "next/headers";
import { secretsMatch } from "@/lib/secrets";

export const ADMIN_SESSION_COOKIE = "admin_session";

/**
 * Checks the admin session cookie (set by /api/admin/login), and — when a
 * Request is passed — also accepts an `Authorization: Bearer <ADMIN_SECRET>`
 * header or a `?secret=<ADMIN_SECRET>` query param, for scripting/curl
 * access or a plain browser visit without going through the login form
 * (same ergonomics as /api/update-rankings's CRON_SECRET check).
 */
export async function isAdminAuthenticated(request?: Request): Promise<boolean> {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return false;

  const cookieStore = await cookies();
  const session = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (session && secretsMatch(session, adminSecret)) return true;

  if (!request) return false;

  const authHeader = request.headers.get("authorization");
  if (authHeader && secretsMatch(authHeader, `Bearer ${adminSecret}`)) return true;

  const querySecret = new URL(request.url).searchParams.get("secret");
  if (querySecret && secretsMatch(querySecret, adminSecret)) return true;

  return false;
}
