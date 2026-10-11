/**
 * CRM CONTACTS + ACTIVITY HISTORY — the PRODUCTION store for /api/crm (CRM
 * phases 1–2, moved behind a seam in 3c-1 test work).
 *
 * SERVER-ONLY (imports `~/db`). The six operations below are the SQL that used to
 * live inline in src/routes/api/crm.ts; the statement text, the owner predicate
 * (`user_id = ${userId}`), the ordering, the LIMITs and the archive rule are
 * UNCHANGED — this file only gives the route's handlers something to inject, so a
 * unit test can drive the real GET/POST handler end-to-end (auth → entitlement →
 * branch → response) with an in-memory store, no database and no `mock.module`.
 * Same split as `neonPipelineWorkspaceStore` (src/lib/pipeline-workspace.server.ts)
 * and `neonCrmDraftStore` (src/lib/crm-drafts.server.ts).
 *
 * WHY A SEAM AT ALL: bun's `mock.module` registry is process-global and leaks
 * across test files in one run (the pathology documented in
 * src/routes/api/subcontracts/primes.ts). An injected store is the house answer.
 *
 * NOTHING HERE DECIDES ANYTHING. Entitlement is src/lib/crm-access.server.ts ONLY,
 * and the tier/cap checks live in the route's handlers. Every method below is
 * owner-scoped by construction: `userId` is a required first argument and is the
 * WHERE clause, so a store call can never widen the caller's row set.
 *
 * MIGRATION NOTE: `createContact` calls the migration-059 function
 * `crm_create_contact(...)`, which enforces the per-account cap atomically under
 * `pg_advisory_xact_lock` — a NULL return means the cap was hit, and the route maps
 * that to its 409. `listContacts`/`listActivities`/`update`/`archive`/`addActivity`
 * need only the phase-1 tables (migration 059).
 */
import { sql } from "~/db";

/** The six writable contact columns, in the order every statement uses them. */
export interface CrmContactFields {
  name: string;
  organization: string;
  role: string;
  email: string;
  phone: string;
  notes: string;
}

/**
 * What /api/crm asks of the database. Every method is owner-scoped: `userId` is
 * the caller's own id, never a client-supplied value.
 */
export interface CrmContactsStore {
  /** The caller's own, non-archived contacts, newest-updated first (cap 1000). */
  listContacts(userId: number): Promise<Array<Record<string, unknown>>>;
  /** The caller's own activities for one of their own contacts (cap 200). */
  listActivities(userId: number, contactId: number): Promise<Array<Record<string, unknown>>>;
  /** UPDATE an owned, non-archived contact; null when no row matched (→ 404). */
  updateContact(userId: number, id: number, fields: CrmContactFields): Promise<number | null>;
  /**
   * Create through the migration-059 cap function. `limit` is the tier's
   * `contactLimit` (1000 / 100), never a client value. null ⇒ the cap was hit →
   * the route's 409.
   */
  createContact(userId: number, limit: number, fields: CrmContactFields): Promise<number | null>;
  /** Soft-archive an owned contact; null when no row matched (→ 404). */
  archiveContact(userId: number, id: number): Promise<number | null>;
  /** Log an activity on an OWNED contact (the INSERT…SELECT is the check); null → 404. */
  addActivity(
    userId: number,
    contactId: number,
    kind: string,
    body: string,
  ): Promise<number | null>;
}

export const neonCrmContactsStore: CrmContactsStore = {
  async listContacts(userId) {
    return (await sql()`
      SELECT id, name, organization, role, email, phone, notes, created_at, updated_at
      FROM crm_contacts
      WHERE user_id = ${userId} AND archived_at IS NULL
      ORDER BY updated_at DESC, id DESC
      LIMIT 1000
    `) as Array<Record<string, unknown>>;
  },

  async listActivities(userId, contactId) {
    return (await sql()`
      SELECT id, contact_id, kind, body, created_at
      FROM crm_activities
      WHERE user_id = ${userId} AND contact_id = ${contactId}
      ORDER BY created_at DESC, id DESC
      LIMIT 200
    `) as Array<Record<string, unknown>>;
  },

  async updateContact(userId, id, fields) {
    const rows = (await sql()`
      UPDATE crm_contacts SET
        name = ${fields.name}, organization = ${fields.organization}, role = ${fields.role},
        email = ${fields.email}, phone = ${fields.phone}, notes = ${fields.notes}, updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId} AND archived_at IS NULL
      RETURNING id
    `) as Array<{ id: number }>;
    return rows.length ? Number(rows[0]!.id) : null;
  },

  async createContact(userId, limit, fields) {
    const rows = (await sql()`
      SELECT crm_create_contact(
        ${userId}, ${limit}, ${fields.name}, ${fields.organization},
        ${fields.role}, ${fields.email}, ${fields.phone}, ${fields.notes}
      ) AS id
    `) as Array<{ id: number | null }>;
    const id = rows[0]?.id ?? null;
    return id === null ? null : Number(id);
  },

  async archiveContact(userId, id) {
    const rows = (await sql()`
      UPDATE crm_contacts SET archived_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId} AND archived_at IS NULL
      RETURNING id
    `) as Array<{ id: number }>;
    return rows.length ? Number(rows[0]!.id) : null;
  },

  async addActivity(userId, contactId, kind, body) {
    // The INSERT…SELECT is the ownership check: a contact that is not the
    // caller's (or is archived) yields no row, hence 404.
    const rows = (await sql()`
      INSERT INTO crm_activities (user_id, contact_id, kind, body)
      SELECT ${userId}, id, ${kind}, ${body}
      FROM crm_contacts
      WHERE id = ${contactId} AND user_id = ${userId} AND archived_at IS NULL
      RETURNING id
    `) as Array<{ id: number }>;
    return rows.length ? Number(rows[0]!.id) : null;
  },
};
