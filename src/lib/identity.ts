/**
 * Client-side logging-identity cache for funnel / page-view tracking.
 *
 * When a viewer is KNOWN (logged in), the tracking payloads carry their
 * `user_id` + `user_email` so the whole post-login lifecycle (save bid, score
 * RFP, radar scan, page views) stays tied to the account — and the server-side
 * backfill in /api/signup ties the pre-signup anonymous journey (radar_scan →
 * signup) to the same account. Purely additive to the existing per-visitor
 * tracking:
 *
 *   - Anonymous visitors: no user set → tracking payloads simply OMIT the
 *     fields (they are never leaked to non-logged-in viewers).
 *   - After signup: the signup flow calls setTrackingUser() with the new user's
 *     id+email (from /api/signup's returned user object), so the very next
 *     tracking call (signup_success) already carries identity.
 *   - Logged-in sessions: resolveTrackingUser() is called on app mount (and
 *     lazily on demand) using the existing getCurrentUser() auth getter, so
 *     every subsequent tracking call carries the logged-in user's id+email —
 *     no fresh signup required.
 *
 * This is a client-only, self-hosted analytics identity — it is NOT a surrogate
 * for auth, and it stays within the app's own first-party tracking. Keep this
 * module client-import-safe (no server-only imports; it only touches the auth
 * getter which is already used on the client).
 */
import { getCurrentUser } from "~/lib/auth";

export interface TrackingUser {
  id: string;
  email: string;
}

let cachedUser: TrackingUser | null = null;
let resolvePromise: Promise<TrackingUser | null> | null = null;

/** Stamp the current user into the tracking layer (call after signup/login). */
export function setTrackingUser(
  user: { id: number | string; email: string } | null,
): void {
  cachedUser =
    user && user.id != null && typeof user.email === "string" && user.email.length > 0
      ? { id: String(user.id), email: user.email }
      : null;
}

/** Clear the cached tracking identity (e.g. on logout). */
export function clearTrackingUser(): void {
  cachedUser = null;
  resolvePromise = null;
}

/** Synchronously return the currently-known tracking user (client only). */
export function getTrackingUser(): TrackingUser | null {
  return cachedUser;
}

/**
 * Resolve the current logged-in user via the existing getCurrentUser() auth
 * getter, caching the result so subsequent synchronous tracking calls carry
 * identity. Concurrent callers coalesce onto a single in-flight request. Never
 * throws — on any failure it resolves to null (identity simply absent, the
 * tracking call proceeds without user fields).
 */
export function resolveTrackingUser(): Promise<TrackingUser | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (cachedUser) return Promise.resolve(cachedUser);
  if (resolvePromise) return resolvePromise;
  resolvePromise = (async () => {
    try {
      const u = await getCurrentUser();
      if (u && u.id != null && typeof u.email === "string" && u.email.length > 0) {
        cachedUser = { id: String(u.id), email: u.email };
      }
      return cachedUser;
    } catch {
      return null;
    } finally {
      resolvePromise = null;
    }
  })();
  return resolvePromise;
}
