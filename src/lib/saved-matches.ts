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
import { workspaceScopeClause } from "~/lib/workspaces";

/**
 * The caller's ACTIVE client workspace id, or null (no workspace = the account's own
 * context). Fail-soft: a lookup error reads "none" (see resolveActiveWorkspaceId).
 *
 * SCOPE MATTERS (build): this lookup lives in a createServerFn HANDLER body on purpose.
 * `~/lib/workspaces.server` is a `*.server.*` module and the import-protection plugin
 * denies it in the CLIENT environment; this module is reachable from client code
 * (router.tsx -> routeTree.gen.ts -> routes/awards.tsx -> lib/saved-matches), so the
 * import fails the build from anywhere else in the file — even as a dynamic
 * `await import(...)`. Server-fn handler bodies are stripped from the client bundle,
 * which is why the import is safe here (the same shape routes/awards.tsx uses for its
 * own head-start lookup).
 */
const getActiveWorkspaceId = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { userId: number })
  .handler(async ({ data }: { data: { userId: number } }): Promise<number | null> => {
    const { resolveActiveWorkspaceId } = await import("~/lib/workspaces.server");
    return resolveActiveWorkspaceId(data.userId);
  });

/**
 * Upsert a saved match. Idempotent — safe to call repeatedly.
 *
 * WORKSPACE (Agency tier, migration 068): the row is filed under the caller's ACTIVE
 * client workspace, resolved here so every save path (dashboard, Radar, bulk save-all)
 * stamps it with no call-site change. `workspace_id` stays NULL for an account with no
 * active workspace — every Starter/Professional account, whose behaviour is unchanged.
 *
 * The `ON CONFLICT (user_id, bid_id)` unique key is the pre-existing one, so a bid is
 * still saved at most once per account. `COALESCE(workspace_id, EXCLUDED.workspace_id)`
 * means re-saving an UNSCOPED (legacy/NULL) row while a workspace is active files it
 * under that workspace, and a row already filed under a client is never silently
 * moved to another client. (Saving the same bid under two clients at once needs a
 * per-workspace unique key — a phase-2 change to the constraint.)
 */
export async function saveMatch(userId: number, bidId: number): Promise<void> {
  const { sql } = await import("~/db");
  const workspaceId = await getActiveWorkspaceId({ data: { userId } });
  await sql()`
    INSERT INTO saved_matches (user_id, bid_id, status, workspace_id)
    VALUES (${userId}, ${bidId}, 'saved', ${workspaceId})
    ON CONFLICT (user_id, bid_id) DO UPDATE SET
      status = 'saved',
      workspace_id = COALESCE(saved_matches.workspace_id, EXCLUDED.workspace_id)
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
export const getSavedBidIds = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { userId: number })
  .handler(
  async ({ data }: { data: { userId: number } }): Promise<number[]> => {
    try {
      const { sql } = await import("~/db");
      const { resolveActiveWorkspaceId } = await import("~/lib/workspaces.server");
      // Scoped to the caller's ACTIVE client workspace (null = the account's own
      // context), so the "saved" state the pages render follows the same client the
      // rest of the page is showing.
      const workspaceId = await resolveActiveWorkspaceId(data.userId);
      const rows = await sql()`
        SELECT bid_id FROM saved_matches
        WHERE user_id = ${data.userId} AND status = 'saved'
          AND ${sql().unsafe(workspaceScopeClause(workspaceId))}
      `;
      return (rows as any[]).map((r) => Number(r.bid_id));
    } catch (err) {
      console.error("[saved-matches] getSavedBidIds failed:", err);
      return [];
    }
  },
);
