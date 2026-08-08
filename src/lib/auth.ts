/**
 * Auth helpers for Contrax.
 *
 * Authentication is resolved through the /api/auth/me endpoint so this helper
 * behaves consistently during both SSR and client-side route navigation.
 */

import { isAdminEmail } from "~/lib/admin";
import { sql } from "~/db";

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
 * Uses the request's session cookie through the auth API endpoint.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  // Server-side: use the cookie that vercel-entry.ts stashed on globalThis
  if (typeof window === "undefined") {
    const cookie = (globalThis as any).__contrax_request_cookie__ as string | undefined;
    if (cookie) {
      // Parse contrax_session token from the cookie header string
      let token: string | undefined;
      for (const pair of cookie.split("; ")) {
        const eq = pair.indexOf("=");
        if (eq > 0 && pair.slice(0, eq) === SESSION_COOKIE) {
          token = pair.slice(eq + 1);
          break;
        }
      }
      if (token) {
        try {
          const rows = await sql()`
            SELECT u.id, u.email, u.created_at, COALESCE(u.is_admin, FALSE) AS is_admin
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ${token} AND s.expires_at > NOW()
            LIMIT 1
          `;
          if (rows.length > 0) {
            const u = rows[0] as any;
            return {
              id: u.id,
              email: u.email,
              created_at: String(u.created_at),
              is_admin: u.is_admin === true || isAdminEmail(u.email),
            };
          }
        } catch {}
      }
    }
    return null;
  }
  // Client-side: use the API endpoint
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) return null;
    const user = (await res.json()) as AuthUser;
    return {
      ...user,
      is_admin: user.is_admin === true || isAdminEmail(user.email),
    };
  } catch {
    return null;
  }
}

/**
 * Logout is handled by the /api/logout API route (POST). The route deletes the
 * session row and expires the httpOnly cookie server-side.
 */
export { SESSION_COOKIE };
