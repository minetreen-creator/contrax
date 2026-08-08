/**
 * Auth helpers for Contrax.
 *
 * Authentication is resolved through the /api/auth/me endpoint so this helper
 * behaves consistently during both SSR and client-side route navigation.
 */

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
 * Uses the request's session cookie through the auth API endpoint.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
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
