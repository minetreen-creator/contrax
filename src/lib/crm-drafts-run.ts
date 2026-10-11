/**
 * CRM AI FOLLOW-UP DRAFTS — the ALGORITHM and its four seams (CRM phase 3b,
 * owner handoff 2026-10-10 item 5).
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM src/lib/crm-drafts.server.ts: the draft
 * request must be testable ANYWHERE, and its unit suite must not need a database
 * driver, an OpenAI key or a network. So this module imports nothing but the pure
 * rules (src/lib/crm-drafts.ts) — no `~/db`, no `~/lib/ai`, no `~/lib/rate-limit`,
 * no `@tanstack/*`. The Neon-backed store, the REAL phase-1 entitlement reader, the
 * production usage-limit check and the shared OpenAI helper live next door in
 * crm-drafts.server.ts. Same split as `crm-reminders-sweep.ts` /
 * `crm-reminders.server.ts` in phase 3a, and the same split as
 * `computeTrialStatus` / `loadUserTrialStatus` in src/lib/trial.ts.
 *
 * THE OWNER'S SENTENCE, CLAUSE BY CLAUSE (handoff item 5): "Generate a draft
 * follow-up email for a contact from their relationship history + notes; drafts only
 * — never auto-send; server-gated to Professional (aiDrafts flag)."
 *
 *   1. "server-gated to Professional (aiDrafts flag)" — step 1 below asks the
 *      entitlement seam, which in production IS `getCrmAccess()` from
 *      src/lib/crm-access.server.ts (no tier ladder is re-implemented here). A read
 *      failure is NOT caught inside this function: it propagates, and the route
 *      answers 500 — FAIL-CLOSED. An unreadable entitlement is never treated as
 *      entitled, and no draft is ever generated for an account whose entitlement the
 *      server could not establish.
 *   2. "for a contact" — the contact is read through an OWNER-SCOPED store method,
 *      and a contact that is not the caller's (or is archived) is simply absent:
 *      404, never a cross-user read. Ownership is checked BEFORE any history is
 *      loaded, so another user's contact can never leak a single activity.
 *   3. "from their relationship history + notes" — the history read is owner-scoped
 *      too (same user_id), capped, and folded into the prompt by the pure builder.
 *   4. "a draft follow-up email … drafts only — never auto-send" — this module
 *      returns TEXT. The store interface has READ methods only, there is no mailer
 *      dependency, and no activity is ever created: a generated draft cannot be
 *      "sent", "logged" or claimed as delivered, because the capability does not
 *      exist here. (The unit suite proves that structurally: its fake store has no
 *      write methods at all, so a write would be a type error.)
 *   5. "server-gated" also covers the USAGE LIMIT: the production limit seam is the
 *      existing `checkRateLimit()` (scope `crm_draft`, key `user:<id>`, 24h window) —
 *      the per-user daily cap the AI Executive Brief route already puts in front of
 *      its own paid generation. Reaching it is an honest 429 with a retry-after, from
 *      the server, and it can never be bypassed from the client.
 *
 * NO MIGRATION, NO NEW TABLE: a draft is stateless (nothing is persisted) and the
 * usage cap lives in the pre-existing `rate_limits` table. See the phase-3b
 * evidence note in shared/crm-phase3-drafts-2026-10-11/.
 */
import {
  CRM_DRAFT_ACTIVITY_LIMIT,
  CRM_DRAFT_CONTACT_NOT_FOUND,
  CRM_DRAFT_FAILED_MESSAGE,
  CRM_DRAFT_INVALID_MESSAGE,
  CRM_DRAFT_LIMIT_MESSAGE,
  CRM_DRAFT_PRO_REQUIRED,
  buildCrmDraftPrompt,
  normalizeDraftText,
  parseDraftInstructions,
  type CrmDraftActivity,
  type CrmDraftContact,
  type CrmDraftMessages,
} from "~/lib/crm-drafts";

/** What the draft needs to know about the account — the phase-1 flag and nothing else. */
export interface CrmDraftEntitlement {
  access: { tier: string; aiDrafts: boolean };
}

export interface CrmDraftEntitlementChecker {
  check(user: { id: number; is_admin: boolean }): Promise<CrmDraftEntitlement>;
}

/**
 * The READ side of the CRM. Deliberately write-free: there is no `addActivity`, no
 * `saveContact` and no mailer on this interface, which is how "drafts only" is
 * enforced by construction rather than by remembering not to call something.
 * Both reads are owner-scoped in production (see neonCrmDraftStore).
 */
export interface CrmDraftStore {
  /** The caller's own, non-archived contact — or null (never another user's row). */
  loadContact(userId: number, contactId: number): Promise<CrmDraftContact | null>;
  /** The caller's own activities for that contact, newest first. */
  listActivities(userId: number, contactId: number): Promise<CrmDraftActivity[]>;
}

/** The usage-limit seam — production is `checkRateLimit` (pre-existing table). */
export interface CrmDraftLimitChecker {
  check(userId: number): Promise<{ allowed: boolean; retryAfterSec: number | null }>;
}

/** The model seam — production is `callAI` from src/lib/ai.ts. */
export interface CrmDraftGenerator {
  generate(messages: CrmDraftMessages): Promise<string>;
}

export interface CrmDraftDeps {
  entitlement: CrmDraftEntitlementChecker;
  store: CrmDraftStore;
  limit: CrmDraftLimitChecker;
  generate: CrmDraftGenerator;
  /** Injectable clock, so a test can pin `generatedAt`. */
  now?: () => Date;
}

/** The request, already authenticated by the route. */
export interface CrmDraftRequest {
  user: { id: number; is_admin: boolean };
  /** Untrusted: validated here (a positive safe integer, or nothing). */
  contactId: unknown;
  /** Untrusted: the optional instruction, normalized by the pure parser. */
  instructions?: unknown;
}

/** What the caller may do with the answer — one shape, no guessing at the status. */
export type CrmDraftOutcome =
  | {
      ok: true;
      status: 200;
      draft: { text: string; contactId: number; generatedAt: string };
    }
  | {
      ok: false;
      status: 400 | 403 | 404 | 429 | 502;
      error: string;
      retryAfterSec?: number;
      /** Diagnostics for the route's log only — never returned to the client. */
      detail?: string;
    };

/** Ids are positive safe integers everywhere in the CRM (phase-1 `positiveInt`). */
function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * ONE draft request. Pure control flow over four injected seams — no clock, no
 * database, no network of its own, and no `mock.module` needed to test it.
 *
 * STEP ORDER MATTERS and is deliberate:
 *   1. entitlement (Professional `aiDrafts`) — before anything is even validated,
 *      so a non-Professional account cannot probe contact ids or spend a unit;
 *   2. the request shape (contactId, then instructions);
 *   3. the OWNER-SCOPED contact read (404 when it is not the caller's);
 *   4. the usage cap (429 with a retry-after; honest copy);
 *   5. the owner-scoped history read, the pure prompt, the model, and the
 *      normalizer. A model error or an empty answer is a 502 — never a partial,
 *      empty or invented draft.
 */
export async function runCrmDraft(
  deps: CrmDraftDeps,
  request: CrmDraftRequest,
): Promise<CrmDraftOutcome> {
  const { user } = request;

  // 1. The Professional gate. A throw here propagates (fail-closed → the route's
  //    500); only a successfully-read `aiDrafts === false` is a 403.
  const { access } = await deps.entitlement.check({ id: user.id, is_admin: user.is_admin === true });
  if (!access || access.aiDrafts !== true) {
    return { ok: false, status: 403, error: CRM_DRAFT_PRO_REQUIRED };
  }

  // 2. The request shape. `contactId` is never coerced from a string: the CRM ids
  //    are integers on every surface, and a float/negative/'' is a 400.
  const contactId = positiveInt(request.contactId);
  if (contactId === null) return { ok: false, status: 400, error: CRM_DRAFT_INVALID_MESSAGE };
  const instructions = parseDraftInstructions(request.instructions);
  if (instructions === null) return { ok: false, status: 400, error: CRM_DRAFT_INVALID_MESSAGE };

  // 3. OWNERSHIP FIRST: no history read, no prompt, no model call until the contact
  //    is confirmed to be this user's own.
  const contact = await deps.store.loadContact(user.id, contactId);
  if (!contact) return { ok: false, status: 404, error: CRM_DRAFT_CONTACT_NOT_FOUND };

  // 4. The existing usage cap (server-side; the client cannot reach past it).
  const limit = await deps.limit.check(user.id);
  if (!limit.allowed) {
    return {
      ok: false,
      status: 429,
      error: CRM_DRAFT_LIMIT_MESSAGE,
      retryAfterSec: limit.retryAfterSec ?? 3600,
    };
  }

  // 5. History (owner-scoped, capped) → prompt → model → normalize.
  const activities = await deps.store.listActivities(user.id, contactId);
  const messages = buildCrmDraftPrompt({
    contact,
    activities: activities.slice(0, CRM_DRAFT_ACTIVITY_LIMIT),
    instructions,
  });
  let answer: string;
  try {
    answer = await deps.generate.generate(messages);
  } catch (error) {
    return { ok: false, status: 502, error: CRM_DRAFT_FAILED_MESSAGE, detail: describe(error) };
  }
  const text = normalizeDraftText(answer);
  if (text === null) {
    return {
      ok: false,
      status: 502,
      error: CRM_DRAFT_FAILED_MESSAGE,
      detail: "the model returned an empty draft",
    };
  }
  return {
    ok: true,
    status: 200,
    draft: {
      text,
      contactId,
      generatedAt: (deps.now?.() ?? new Date()).toISOString(),
    },
  };
}

/** A short, log-safe description of a failure (never returned to the client). */
function describe(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
}
