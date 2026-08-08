/**
 * Auth helper for API routes (src/routes/api/*).
 *
 * `createFileRoute` API route handlers receive a raw `Request` and do NOT have
 * createServerFn's RPC context — `getCookie()` is unavailable there — so we
 * parse the session cookie straight from the request headers and resolve the
 * user via the sessions → users join, mirroring `getCurrentUser()` in
 * `~/lib/auth`.
 */
import { sql } from "~/db";
import { isAdminEmail } from "~/lib/admin";
import { SESSION_COOKIE, type AuthUser } from "~/lib/auth";

/** Extracts cookies from a Request's Cookie header (no parser dependency). */
export function parseCookies(request: Request): Record<string, string> {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookies: Record<string, string> = {};
  for (const pair of cookieHeader.split("; ")) {
    const eq = pair.indexOf("=");
    if (eq > 0) cookies[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return cookies;
}

/**
 * Resolves the authenticated user for an API request, or null when the request
 * is not authenticated (no session cookie, unknown token, or expired session).
 */
export async function getUserFromRequest(request: Request): Promise<AuthUser | null> {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  // Prefer the query that includes users.is_admin. Older databases that
  // predate the is_admin column will fail this query, so fall back to the
  // base columns and let the email allowlist carry admin detection.
  let rows: any[];
  try {
    rows = await sql()`
      SELECT u.id, u.email, u.created_at, COALESCE(u.is_admin, FALSE) AS is_admin
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ${token} AND s.expires_at > NOW()
      LIMIT 1
    `;
  } catch {
    rows = await sql()`
      SELECT u.id, u.email, u.created_at
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ${token} AND s.expires_at > NOW()
      LIMIT 1
    `;
  }
  if (rows.length === 0) return null;
  const user = rows[0] as { id: number; email: string; created_at: Date; is_admin?: boolean };
  return {
    id: user.id,
    email: user.email,
    created_at: String(user.created_at),
    is_admin: user.is_admin === true || isAdminEmail(user.email),
  };
}
