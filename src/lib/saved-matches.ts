/**
 * Saved-match ("My Pipeline") helpers.
 *
 * The `saved_matches` table has been in production since before this feature
 * (used by the dashboard's dismiss action and demo seeding), with a UNIQUE
 * constraint on (user_id, bid_id) — verified against the production schema —
 * so the upsert below is safe without app-level dedup.
 *
 * Server-only pieces (saveMatch / removeMatch / recordSaveEvent) must only be
 * imported from server code (API routes, the Google OAuth callback loader).
 * `getSavedBidIds` is a createServerFn so route loaders can resolve a user's
 * saved bid ids over RPC (loaders run on the client too — a raw `sql()` call
 * there would throw in the browser).
 */

import { createServerFn } from "@tanstack/react-start";

/** Upsert a saved match. Idempotent — safe to call repeatedly. */
export async function saveMatch(userId: number, bidId: number): Promise<void> {
  const { sql } = await import("~/db");
  await sql()`
    INSERT INTO saved_matches (user_id, bid_id, status)
    VALUES (${userId}, ${bidId}, 'saved')
    ON CONFLICT (user_id, bid_id) DO UPDATE SET status = 'saved'
  `;
}

/** Remove a saved match (un-save). No-op when the row does not exist. */
export async function removeMatch(userId: number, bidId: number): Promise<void> {
  const { sql } = await import("~/db");
  await sql()`
    DELETE FROM saved_matches WHERE user_id = ${userId} AND bid_id = ${bidId}
  `;
}

/**
 * Open-redirect guard for the `next` deep-link param: only same-site relative
 * paths are allowed (starts with "/" and not "//"). Returns null for anything
 * else so callers can fall back to /dashboard.
 */
export function safeNext(next: unknown): string | null {
  if (typeof next !== "string") return null;
  const trimmed = next.trim();
  if (trimmed.length === 0 || trimmed.length > 500) return null;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  return trimmed;
}

/**
 * Resolve the current user's saved bid ids (status = 'saved') for SSR /
 * loader rendering. Runs server-side via RPC; returns [] on any DB failure so
 * the page still renders with the button in its default (unsaved) state.
 */
export const getSavedBidIds = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { userId: number } }): Promise<number[]> => {
    try {
      const { sql } = await import("~/db");
      const rows = await sql()`
        SELECT bid_id FROM saved_matches
        WHERE user_id = ${data.userId} AND status = 'saved'
      `;
      return (rows as any[]).map((r) => Number(r.bid_id));
    } catch (err) {
      console.error("[saved-matches] getSavedBidIds failed:", err);
      return [];
    }
  },
);
