/**
 * CROSS-CLIENT DASHBOARD — the data layer (Agency tier phase 2, owner decision
 * 2026-10-20). SERVER-ONLY (imports `~/db`); GET /api/agency-overview is its only
 * caller.
 *
 * ONE STATEMENT, SCOPED TWICE OVER. The rollup is a single `SELECT` over
 * `workspaces w`, and BOTH ends of every count are pinned to the same client:
 *   * `w.user_id = <authenticated user id>` — an account can only ever roll up the
 *     workspaces it owns, so a workspace id from another account is unreachable
 *     (there is nothing to pass in but the session's user id);
 *   * `saved_matches.workspace_id = w.id` / `crm_contacts.workspace_id = w.id` —
 *     the join condition IS the per-client scope, so one client's row can never
 *     contain another client's bids. This is the same predicate phase 1's
 *     `workspaceScopeClause()` expresses for a single active workspace; no new
 *     scoping rule is invented here.
 * Rows with `workspace_id IS NULL` (bids and contacts saved in the account's own,
 * unfiled context) are deliberately NOT counted — they belong to no client, and
 * folding them into the first client would be a lie. The UI says so in one line.
 *
 * COUNTS ARE COMPUTED IN THE DATABASE, not by shipping rows to the app: a
 * consultant with ten busy clients would otherwise pull thousands of saved bids
 * over the wire to render six numbers. The window (`today .. today + 7`) arrives as
 * two bound parameters from `dayWindow()` so the semantics are testable in pure
 * code and no server-clock/time-zone guess is made inside SQL.
 *
 * Reads are never entitlement-gated (phase 1's "reads survive a downgrade" policy):
 * a downgraded account keeps seeing the clients it already has.
 */
import { sql } from "~/db";
import { isoTimestamp, type AgencyOverviewWindow, type WorkspaceStats } from "~/lib/agency-overview";

/** What GET /api/agency-overview asks of the database. */
export interface AgencyOverviewStore {
  /** One statistics row per workspace `userId` owns, in any order. */
  rollup(userId: number, window: AgencyOverviewWindow): Promise<WorkspaceStats[]>;
}

/** A JSONB array column as a string[] — only real strings survive (the phase-1 rule). */
function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** A JSONB object column as a count map — only finite numbers survive. */
function countMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

/**
 * A timestamptz column as an ISO-8601 string. The Neon driver parses timestamptz
 * into a JS `Date`, and `String(date)` is "Mon Oct 19 2026 09:00:00 GMT+0000" — not
 * ISO, which would silently break the client's newest-of-two comparison (it sorts
 * the strings lexically). `isoTimestamp()` in src/lib/agency-overview.ts does the
 * normalisation once, and a test pins it.
 */
function timestamp(value: unknown): string | null {
  return isoTimestamp(value);
}

export const neonAgencyOverviewStore: AgencyOverviewStore = {
  async rollup(userId, window) {
    // Each LATERAL is an aggregate over ZERO OR MORE rows for THIS workspace, so a
    // client with no saved bids or no contacts still returns its row (with zeros),
    // rather than disappearing from the dashboard — "no activity" is information a
    // consultant needs.
    const rows = (await sql()`
      SELECT
        w.id,
        w.name,
        bp.locations,
        bp.service_categories,
        bids.saved_bids,
        bids.due_in_window,
        bids.overdue,
        pursuit.by_pursuit,
        bids.last_saved_at,
        contacts.contacts,
        activity.last_activity_at
      FROM workspaces w
      LEFT JOIN business_profiles bp ON bp.id = w.profile_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS saved_bids,
          COUNT(*) FILTER (
            WHERE b.due_date IS NOT NULL
              AND b.due_date::date >= ${window.today}::date
              AND b.due_date::date <= ${window.weekEnd}::date
          )::int AS due_in_window,
          COUNT(*) FILTER (
            WHERE b.due_date IS NOT NULL
              AND b.due_date::date < ${window.today}::date
          )::int AS overdue,
          MAX(sm.created_at) AS last_saved_at
        FROM saved_matches sm
        JOIN bids b ON b.id = sm.bid_id
        WHERE sm.user_id = ${userId}
          AND sm.workspace_id = w.id
          AND sm.status = 'saved'
      ) bids ON TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_object_agg(ps, n) AS by_pursuit
        FROM (
          SELECT COALESCE(sm.pursuit_status, 'evaluating') AS ps, COUNT(*)::int AS n
          FROM saved_matches sm
          WHERE sm.user_id = ${userId}
            AND sm.workspace_id = w.id
            AND sm.status = 'saved'
          GROUP BY 1
        ) grouped
      ) pursuit ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS contacts
        FROM crm_contacts c
        WHERE c.user_id = ${userId}
          AND c.workspace_id = w.id
          AND c.archived_at IS NULL
      ) contacts ON TRUE
      LEFT JOIN LATERAL (
        SELECT MAX(a.created_at) AS last_activity_at
        FROM crm_activities a
        JOIN crm_contacts c ON c.user_id = a.user_id AND c.id = a.contact_id
        WHERE a.user_id = ${userId}
          AND c.workspace_id = w.id
      ) activity ON TRUE
      WHERE w.user_id = ${userId}
      ORDER BY w.created_at, w.id
    `) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name ?? ""),
      states: textArray(r.locations),
      trades: textArray(r.service_categories),
      savedBids: Number(r.saved_bids ?? 0),
      dueInWindow: Number(r.due_in_window ?? 0),
      overdue: Number(r.overdue ?? 0),
      byPursuit: countMap(r.by_pursuit),
      lastSavedAt: timestamp(r.last_saved_at),
      contacts: Number(r.contacts ?? 0),
      lastCrmActivityAt: timestamp(r.last_activity_at),
    }));
  },
};
