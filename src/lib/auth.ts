/**
 * Auth helpers for Contrax.
 *
 * These server functions use `@tanstack/react-start/server` for cookie management.
 * They are safe to import from route files because `createServerFn` ensures the
 * handler code only runs on the server.
 */

import { createServerFn } from "@tanstack/react-start";
import { getCookie, deleteCookie } from "@tanstack/react-start/server";
import { sql } from "~/db";

const SESSION_COOKIE = "contrax_session";

export interface AuthUser {
  id: number;
  email: string;
  created_at: string;
}

/**
 * Returns the currently logged-in user, or null.
 * Can be called from any server function or route loader.
 */
export const getCurrentUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthUser | null> => {
    const token = getCookie(SESSION_COOKIE);
    if (!token) return null;

    const rows = await sql()`
      SELECT u.id, u.email, u.created_at
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ${token} AND s.expires_at > NOW()
      LIMIT 1
    `;

    if (rows.length === 0) return null;
    const user = rows[0] as { id: number; email: string; created_at: Date };
    return {
      id: user.id,
      email: user.email,
      created_at: String(user.created_at),
    };
  },
);

/**
 * Destroys the current session and clears the cookie.
 */
export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const token = getCookie(SESSION_COOKIE);
  if (token) {
    await sql()`DELETE FROM sessions WHERE token = ${token}`;
  }
  deleteCookie(SESSION_COOKIE);
  return { success: true };
});

export { SESSION_COOKIE };
