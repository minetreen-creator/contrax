/**
 * CRM AI FOLLOW-UP DRAFTS — the PRODUCTION half (CRM phase 3b, owner handoff
 * 2026-10-10 item 5). Four production adapters for the seams declared in
 * src/lib/crm-drafts-run.ts, plus the one call the route makes.
 *
 * SERVER-ONLY (imports `~/db`, `~/lib/ai`). The ALGORITHM lives in
 * src/lib/crm-drafts-run.ts, which imports no database driver, no HTTP client and
 * no clock, so its unit suite is deterministic, network-free and database-free.
 *
 * EVERY DEFAULT HERE IS AN EXISTING MECHANISM — nothing in this feature invents a
 * tier, a credit or a table:
 *
 *   entitlement → `getCrmAccess()` (src/lib/crm-access.server.ts). The phase-1
 *                 reader is the ONLY entitlement source for the whole CRM; this
 *                 module never re-implements the ladder and never reads a pricing
 *                 or Stripe path. `access.aiDrafts` is Professional-only, which is
 *                 what the owner's "server-gated to Professional" means here.
 *   store       → `crm_contacts` + `crm_activities`, both queried with
 *                 `user_id = ${userId}`, so a draft can only ever read the
 *                 caller's own contact and the caller's own history. READ-ONLY:
 *                 this file contains no INSERT/UPDATE/DELETE for this feature —
 *                 a draft is never persisted, never logged as an activity and
 *                 never sent.
 *   limit       → `checkRateLimit()` (src/lib/rate-limit.ts, scope `crm_draft`,
 *                 key `user:<id>`) over the PRE-EXISTING `rate_limits` table —
 *                 the same per-user daily cap the AI Executive Brief route
 *                 already applies to its own paid generation (scope
 *                 `analyze_daily`). NO MIGRATION and no new table: a draft is
 *                 stateless, so the phase-3b brief's "should not need one" holds.
 *   generator   → `callAI()` (src/lib/ai.ts) — the shared OpenAI helper every
 *                 Contrax AI feature uses (gpt-4o-mini, bounded retry). Passed the
 *                 two prompt messages from the pure builder, nothing else.
 */
import { sql } from "~/db";
import { callAI } from "~/lib/ai";
import { getCrmAccess } from "~/lib/crm-access.server";
import {
  CRM_DRAFT_ACTIVITY_LIMIT,
  CRM_DRAFT_MAX_PER_DAY,
  CRM_DRAFT_WINDOW_SEC,
} from "~/lib/crm-drafts";
import {
  runCrmDraft,
  type CrmDraftDeps,
  type CrmDraftOutcome,
  type CrmDraftStore,
} from "~/lib/crm-drafts-run";
import { checkRateLimit } from "~/lib/rate-limit";

/**
 * The scope name of this feature's usage cap. A closed literal (never user input),
 * so the counter can never be shared with another feature's window.
 */
export const CRM_DRAFT_LIMIT_SCOPE = "crm_draft";

/**
 * The read store. Both queries carry the owner predicate — the phase-1/2 habit:
 * the `user_id` in the WHERE clause IS the access control, and the archived rule
 * matches every other contact surface (an archived contact is not offered for a
 * new follow-up).
 */
export const neonCrmDraftStore: CrmDraftStore = {
  async loadContact(userId, contactId) {
    const rows = (await sql()`
      SELECT id, name, organization, role, notes
      FROM crm_contacts
      WHERE id = ${contactId} AND user_id = ${userId} AND archived_at IS NULL
      LIMIT 1
    `) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      name: String(row.name ?? ""),
      organization: String(row.organization ?? ""),
      role: String(row.role ?? ""),
      notes: String(row.notes ?? ""),
    };
  },
  async listActivities(userId, contactId) {
    // Newest first, and already bounded at the source: the same cap the pure
    // builder re-applies, so neither a huge history nor a caller can widen it.
    const rows = (await sql()`
      SELECT kind, body, created_at
      FROM crm_activities
      WHERE user_id = ${userId} AND contact_id = ${contactId}
      ORDER BY created_at DESC, id DESC
      LIMIT ${CRM_DRAFT_ACTIVITY_LIMIT}
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      kind: String(r.kind ?? ""),
      body: String(r.body ?? ""),
      created_at: r.created_at ? String(r.created_at) : null,
    }));
  },
};

/** Every production adapter, in one object the route (or a CLI) can pass through. */
export const neonCrmDraftDeps: CrmDraftDeps = {
  entitlement: {
    async check(user) {
      // The REAL phase-1 reader. A throw propagates to the route as a 500
      // (fail-closed: an unreadable entitlement never produces a draft).
      const access = await getCrmAccess(user);
      return { access };
    },
  },
  store: neonCrmDraftStore,
  limit: {
    async check(userId) {
      // `checkRateLimit` increments the window and reports the allowance — the
      // house per-user cap. It fails OPEN on a database blip (availability: a Neon
      // error must not lock a paying user out of their own tooling) and the
      // ENTITLEMENT gate above is what fails CLOSED. Both are server-side; the
      // client has no path around either.
      return checkRateLimit({
        scope: CRM_DRAFT_LIMIT_SCOPE,
        key: `user:${userId}`,
        limit: CRM_DRAFT_MAX_PER_DAY,
        windowSec: CRM_DRAFT_WINDOW_SEC,
      });
    },
  },
  generate: {
    async generate(messages) {
      return callAI(
        [
          { role: "system", content: messages.system },
          { role: "user", content: messages.user },
        ],
        // A draft is short by construction (the prompt asks for <180 words); the
        // headroom only stops a runaway completion from being truncated mid-word.
        { max_tokens: 600, temperature: 0.4 },
      );
    },
  },
};

/**
 * Generates one follow-up draft for the AUTHENTICATED user. The route's entry point;
 * everything decision-shaped happens in src/lib/crm-drafts-run.ts.
 */
export async function generateCrmDraft(
  user: { id: number; is_admin?: boolean },
  body: { contactId?: unknown; instructions?: unknown },
): Promise<CrmDraftOutcome> {
  return runCrmDraft(neonCrmDraftDeps, {
    user: { id: user.id, is_admin: user.is_admin === true },
    contactId: body.contactId,
    instructions: body.instructions,
  });
}
