/**
 * PER-CLIENT CSV EXPORT — the data layer (Agency tier phase 3, owner decision
 * 2026-10-20). SERVER-ONLY (imports `~/db`); GET /api/workspace-export is its only
 * caller.
 *
 * ONE CLIENT AT A TIME, SCOPED TWICE OVER — the same pin phase 2's rollup uses:
 *   * `workspaces.user_id = <authenticated user id>` — the workspace id in the URL
 *     is resolved against the SESSION's owner, so another account's client id finds
 *     no row (the endpoint answers 404, and returns no data at all);
 *   * `workspace_id = <that workspace id>` on BOTH row reads — the predicate IS the
 *     per-client scope, so one client's file can never contain another client's
 *     bids or contacts. Rows with `workspace_id IS NULL` (the account's own, unfiled
 *     context) are deliberately excluded: they belong to no client, and folding them
 *     into a client's deliverable would be a lie.
 *
 * READS ARE NEVER ENTITLEMENT-GATED (phase 1's "reads survive a downgrade"): a
 * downgraded account still exports the clients it already has, exactly as it still
 * GETs /api/workspaces and /api/agency-overview. There is NO write path here and no
 * cap arithmetic — nothing new is granted.
 *
 * DATES. The two DATE columns are formatted to `YYYY-MM-DD` text IN SQL
 * (`to_char`), so a driver that parses `date` into a JS Date at local midnight can
 * never shift a deadline across a day. Timestamps go through `isoTimestamp()` (the
 * phase-2 helper) for a UTC ISO-8601 string, so no `Date#toString()` leaks into a
 * cell a spreadsheet cannot parse.
 */
import { sql } from "~/db";
import { isoTimestamp } from "~/lib/agency-overview";
import type {
  WorkspaceExportBid,
  WorkspaceExportBundle,
  WorkspaceExportContact,
} from "~/lib/workspace-export";

/** What GET /api/workspace-export asks of the database. */
export interface WorkspaceExportStore {
  /**
   * ONE client's rows for owner `userId`, or null when that account owns no such
   * workspace. null ⇒ 404, and never a partial bundle.
   */
  load(userId: number, workspaceId: number): Promise<WorkspaceExportBundle | null>;
}

/** A TEXT column as a string; NULL stays null rather than becoming "null". */
function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** A TEXT column as a string, with the empty string for NULL (the contact columns). */
function plainText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export const neonWorkspaceExportStore: WorkspaceExportStore = {
  async load(userId, workspaceId) {
    // 1. Resolve the client. BOTH halves of the predicate are required: the id from
    //    the URL is only ever matched against a workspace THIS account owns.
    const owned = (await sql()`
      SELECT w.id, w.name
      FROM workspaces w
      WHERE w.id = ${workspaceId} AND w.user_id = ${userId}
    `) as Array<Record<string, unknown>>;
    const workspaceRow = owned[0];
    if (!workspaceRow) return null;

    // 2./3. The two row sets, each pinned to the same owner AND the same client.
    //    Independent reads, so they run together.
    const [bidRows, contactRows] = await Promise.all([
      sql()`
        SELECT b.title, b.agency, b.location, b.source_url,
               to_char(b.due_date, 'YYYY-MM-DD') AS due_date,
               sm.pursuit_status, sm.next_action,
               to_char(sm.follow_up_date, 'YYYY-MM-DD') AS follow_up_date,
               sm.created_at,
               c.name AS contact_name
        FROM saved_matches sm
        JOIN bids b ON b.id = sm.bid_id
        LEFT JOIN crm_contacts c
          ON c.user_id = sm.user_id AND c.id = sm.crm_contact_id
        WHERE sm.user_id = ${userId}
          AND sm.workspace_id = ${workspaceId}
          AND sm.status = 'saved'
        ORDER BY b.due_date ASC NULLS LAST, sm.created_at DESC NULLS LAST, sm.bid_id
      `,
      sql()`
        SELECT c.name, c.organization, c.role, c.email, c.phone, c.notes, c.created_at,
               (
                 SELECT MAX(a.created_at)
                 FROM crm_activities a
                 WHERE a.user_id = c.user_id AND a.contact_id = c.id
               ) AS last_activity_at
        FROM crm_contacts c
        WHERE c.user_id = ${userId}
          AND c.workspace_id = ${workspaceId}
          AND c.archived_at IS NULL
        ORDER BY c.updated_at DESC NULLS LAST, c.id
      `,
    ]);

    const bids: WorkspaceExportBid[] = (bidRows as Array<Record<string, unknown>>).map((r) => ({
      title: plainText(r.title),
      agency: text(r.agency),
      location: text(r.location),
      due_date: text(r.due_date),
      pursuit_status: text(r.pursuit_status),
      next_action: text(r.next_action),
      follow_up_date: text(r.follow_up_date),
      saved_at: isoTimestamp(r.created_at),
      source_url: text(r.source_url),
      contact_name: text(r.contact_name),
    }));

    const contacts: WorkspaceExportContact[] = (contactRows as Array<Record<string, unknown>>).map(
      (r) => ({
        name: plainText(r.name),
        organization: plainText(r.organization),
        role: plainText(r.role),
        email: plainText(r.email),
        phone: plainText(r.phone),
        notes: plainText(r.notes),
        created_at: isoTimestamp(r.created_at),
        last_activity_at: isoTimestamp(r.last_activity_at),
      }),
    );

    return {
      workspace: { id: Number(workspaceRow.id), name: plainText(workspaceRow.name) },
      bids,
      contacts,
    };
  },
};
