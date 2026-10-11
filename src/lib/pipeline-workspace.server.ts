/**
 * PIPELINE WORKSPACE — the data layer of POST /api/pipeline-workspace (CRM phase 2,
 * owner handoff 2026-10-10). SERVER-ONLY (imports `~/db`); the route is its only
 * caller, and a unit test hands it a fake store instead of registering a
 * process-global module mock (see src/routes/api/pipeline-workspace.ts).
 *
 * WHAT MOVED HERE AND WHY. The route used to inline its one UPDATE. Phase 2 adds a
 * SECOND statement before it — resolving `body.crm_contact_id` to a contact the
 * caller owns and that is not archived — and both statements belong to the same
 * "the caller's own saved bid" scope. Splitting them into an injectable store is
 * exactly the seam src/routes/api/subcontracts/primes.ts uses (`primesHandler(read)`),
 * and it buys the thing the brief asks for: the OWNERSHIP / ARCHIVED / UNLINK rules
 * become unit-testable with no database and no network.
 *
 * The UPDATE's text (columns, the owner-scoped WHERE, RETURNING) is the shipped
 * one, byte for byte, with ONE additive column: `crm_contact_id` is now written
 * (and returned) in the same statement, so link and unlink travel with the fields
 * they are saved next to. `crm_contact_id = NULL` is the unlink, and the composite
 * FK `saved_matches_crm_contact_owner_fk` (migration 059) is the BACKSTOP for it —
 * the route resolves the id first so the caller gets 404/400 instead of a raw
 * constraint violation.
 */
import { sql } from "~/db";

/** The caller's contact, as the link check needs to see it. */
export interface OwnedContactLookup {
  id: number;
  /** True when the contact is in the archive (`archived_at IS NOT NULL`). */
  archived: boolean;
}

/**
 * Everything the UPDATE needs, already validated and TRIMMED by the route — the
 * store never re-implements a bound (one place decides what a field may be).
 */
export interface SavedBidUpdateInput {
  userId: number;
  bidId: number;
  pursuitStatus: string;
  notes: string;
  nextAction: string;
  followUpDate: string | null;
  contactName: string;
  contactOrganization: string;
  contactRole: string;
  contactEmail: string;
  /** The linked CRM contact, or null to unlink. */
  crmContactId: number | null;
}

/** The seam: the two statements POST /api/pipeline-workspace needs. */
export interface PipelineWorkspaceStore {
  /**
   * The contact with `contactId` IF it belongs to `userId` — archived or not, so
   * the caller can tell "not yours / does not exist" (null) apart from "yours but
   * archived" (a row with `archived: true`). Never returns another user's row.
   */
  findOwnedContact(userId: number, contactId: number): Promise<OwnedContactLookup | null>;
  /**
   * Writes every pipeline field plus the contact link on the caller's own saved
   * bid, and returns the stored row, or null when no such saved bid exists.
   */
  updateSavedBid(input: SavedBidUpdateInput): Promise<Record<string, unknown> | null>;
}

export const neonPipelineWorkspaceStore: PipelineWorkspaceStore = {
  async findOwnedContact(userId, contactId) {
    const rows = (await sql()`
      SELECT id, archived_at FROM crm_contacts
      WHERE id = ${contactId} AND user_id = ${userId}
      LIMIT 1
    `) as Array<{ id: number; archived_at: unknown }>;
    const row = rows[0];
    if (!row) return null;
    return { id: Number(row.id), archived: row.archived_at !== null && row.archived_at !== undefined };
  },

  async updateSavedBid(input) {
    const rows = (await sql()`
      UPDATE saved_matches SET
        pursuit_status = ${input.pursuitStatus}, notes = ${input.notes},
        next_action = ${input.nextAction}, follow_up_date = ${input.followUpDate},
        contact_name = ${input.contactName}, contact_organization = ${input.contactOrganization},
        contact_role = ${input.contactRole}, contact_email = ${input.contactEmail},
        crm_contact_id = ${input.crmContactId}
      WHERE user_id = ${input.userId} AND bid_id = ${input.bidId} AND status = 'saved'
      RETURNING bid_id, pursuit_status, notes, next_action, follow_up_date,
                contact_name, contact_organization, contact_role, contact_email,
                crm_contact_id
    `) as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  },
};
