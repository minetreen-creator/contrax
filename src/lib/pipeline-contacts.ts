/**
 * PIPELINE CONTACTS — the shared, CLIENT-SAFE half of CRM phase 2 (owner handoff
 * 2026-10-10, remaining-work items 1–3): contacts inside the existing Pipeline
 * interface, and a saved bid linked to one of those contacts through
 * `saved_matches.crm_contact_id`.
 *
 * WHY ONE SHARED MODULE: the /pipeline UI, POST /api/pipeline-workspace and
 * GET /api/my-pipeline all need the SAME answer to two questions —
 *   * "which contact is this saved bid linked to?"  → `crmContactLink()`
 *   * "is this untrusted `crm_contact_id` acceptable?" → `parseCrmContactId()`
 * — and the same error text when it is not. Keeping the mapper, the parser and
 * the copy in one place is what stops the wire shape, the bounds and the copy
 * from drifting apart (the phase-1 habit: one `contactRow()` for both read paths).
 *
 * CLIENT-SAFE BY CONSTRUCTION — the same rule src/lib/plan-gates.ts states for
 * itself, and it is why this file does NOT import the phase-1 types from
 * src/lib/crm-access.server.ts (that module reads `~/db`): src/routes/pipeline.tsx
 * and src/components/PipelineContacts.tsx import this module, so no server module
 * may reach it. The view types below therefore MIRROR the phase-1 payloads, and
 * src/lib/pipeline-contacts.test.ts pins the mirror at runtime (the key set of a
 * real `computeCrmAccess()` result) so a phase-3 drift fails a test instead of
 * silently rendering a stale gate.
 */

/** A contact as GET /api/crm returns it (phase-1 `contactRow()`, unchanged). */
export interface CrmContactView {
  id: number;
  name: string;
  organization: string;
  role: string;
  email: string;
  phone: string;
  notes: string;
  created_at: string | null;
  updated_at: string | null;
}

/** The three CRM tiers, lowest first (mirrors CrmTier in crm-access.server.ts). */
export type CrmTierView = "basic" | "starter" | "professional";

/**
 * The server-computed access object GET /api/crm returns (mirrors CrmAccess in
 * src/lib/crm-access.server.ts). The client NEVER computes entitlement: it reads
 * `canEdit`/`contactLimit`/`tier` off this payload and renders accordingly.
 */
export interface CrmAccessView {
  tier: CrmTierView;
  canEdit: boolean;
  relationshipHistory: boolean;
  reminders: boolean;
  aiDrafts: boolean;
  contactLimit: number;
}

/** The payload of GET /api/crm?resource=contacts (default resource). */
export interface CrmContactsPayload {
  access: CrmAccessView;
  contacts: CrmContactView[];
}

/** One activity row from GET /api/crm?resource=history (Professional only). */
export interface CrmActivityView {
  id: number;
  contact_id: number;
  kind: string;
  body: string;
  created_at: string | null;
}

/** The linked-contact view a saved bid carries (never another user's row). */
export interface PipelineContactLink {
  id: number;
  name: string;
  organization: string;
}

/**
 * Server-contract error text for a rejected link, returned verbatim by
 * POST /api/pipeline-workspace and shown verbatim by the UI. Two DIFFERENT
 * failures the brief insists on distinguishing: a contact that is not the
 * caller's (404) and one that is theirs but archived (400) — the DB's composite
 * FK cannot tell those apart, so the route resolves them before the UPDATE.
 */
export const CRM_CONTACT_NOT_FOUND = "That contact was not found in your contacts.";
export const CRM_CONTACT_ARCHIVED = "That contact is archived — choose a current contact.";
export const CRM_CONTACT_INVALID = "Invalid contact link.";

/**
 * Reads the linked contact off a GET /api/my-pipeline row.
 *
 * The row carries `crm_contact_id` (from `saved_matches`) plus the contact's
 * `crm_contact_name` / `crm_contact_organization` (from the LEFT JOIN). An
 * unlinked bid has a NULL id and therefore NO contact — the honest result for the
 * migration-059 rule that the link is only ever set by an explicit user action,
 * never inferred from the pre-existing contact_name/contact_email block.
 */
export function crmContactLink(row: Record<string, unknown>): PipelineContactLink | null {
  const raw = row.crm_contact_id;
  if (raw === null || raw === undefined) return null;
  const id = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    id,
    name: String(row.crm_contact_name ?? ""),
    organization: String(row.crm_contact_organization ?? ""),
  };
}

/** The result of normalizing an untrusted `crm_contact_id` body value. */
export type CrmContactIdParse =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/**
 * Normalizes the optional `crm_contact_id` of the pipeline-workspace body.
 *
 *   absent / null / ''  → `null`  (an explicit unlink; no contact is required)
 *   positive safe int   → that id (ownership + archived are checked server-side)
 *   anything else       → 400 `CRM_CONTACT_INVALID` — never a silent coerce
 *
 * `''` is accepted as "unlink" because it is what an empty <select> submits; every
 * other non-integer (a float, a negative, a bogus string like "abc") is rejected
 * rather than guessed at. `null` is the value the UI sends for "No linked
 * contact", and nothing is inferred from the pre-existing contact_name block.
 */
export function parseCrmContactId(raw: unknown): CrmContactIdParse {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw <= 0) {
    return { ok: false, error: CRM_CONTACT_INVALID };
  }
  return { ok: true, value: raw };
}

// ── Contacts-panel copy (owner plan-gate UI conventions) ─────────────────────
/**
 * The locked state a Basic (no-entitlement) user sees in the Pipeline's Contacts
 * panel. It follows the house gate style — title / body / CTA / price note, the
 * same shape as GATE_PROMPTS in src/lib/plan-gates.ts and the Starter paywall in
 * src/components/PremiumUpgradeModal.tsx — and it claims NOTHING past the
 * ratified tier table (contacts + pipeline start at Starter $19/mo).
 *
 * ATTEMPT-ONLY comes from the caller, not from this copy: the panel renders this
 * locked card on view, and the upgrade MODAL opens only when the user clicks the
 * gated control (owner rule 8 — a prompt never fires on a page view).
 */
export const CRM_CONTACTS_LOCK_TITLE = "Contacts are a Starter feature";
export const CRM_CONTACTS_LOCK_BODY =
  "Contacts keep the people you're pursuing bids with — with notes and follow-ups — and you can link a contact to any saved bid. Your saved bids and their pipeline details are unchanged.";
export const CRM_CONTACTS_LOCK_CTA = "Upgrade to Starter →";
/** Mirrors the shipped Starter paywall note (PremiumUpgradeModal SAVE_LIMIT_PAYWALL_PRICE). */
export const CRM_CONTACTS_LOCK_PRICE = "$19/mo · 7-day Professional trial · Cancel anytime";
/**
 * Shown under the locked card: Basic is READ-ONLY for contacts, and the phase-1
 * route is auth-only on reads, so a downgraded account keeps seeing the contacts
 * it already created (`canEdit`/`contactLimit` gate writes only). No data is
 * deleted by a plan change, and this says exactly that — nothing more.
 */
export const CRM_CONTACTS_READ_ONLY_NOTE =
  "Contacts you already created stay readable — a plan change never deletes your data. Creating or editing them needs an active Starter plan.";
