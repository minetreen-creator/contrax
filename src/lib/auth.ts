/**
 * Auth helpers for Contrax.
 *
 * These server functions use `@tanstack/react-start/server` for cookie management.
 * They are safe to import from route files because `createServerFn` ensures the
 * handler code only runs on the server.
 */

import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { sql } from "~/db";
import { isAdminEmail } from "~/lib/admin";

const SESSION_COOKIE = "contrax_session";

export interface AuthUser {
  id: number;
  email: string;
  created_at: string;
  /** True when the user has admin access (email allowlist and/or users.is_admin). */
  is_admin: boolean;
}

/**
 * Returns the currently logged-in user, or null.
 * Can be called from any server function or route loader.
 */
export const getCurrentUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthUser | null> => {
    const token = getCookie(SESSION_COOKIE);
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
  },
);

/**
 * Logout is now handled by the /api/logout API route (POST) — createServerFn
 * client RPCs silently fail on production Vercel. The route deletes the session
 * row and expires the httpOnly cookie server-side.
 */
export { SESSION_COOKIE };
