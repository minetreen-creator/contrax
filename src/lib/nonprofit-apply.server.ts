/**
 * Nonprofit Free phase 2 — the apply flow's server half.
 *
 * TWO responsibilities, deliberately in one file so the apply route holds no logic:
 *
 *  1. `saveNonprofitApplicationOutcome(outcome, input)` — THE SINGLE AUDITED WRITER.
 *     Every column the Phase-1 engine produced is written from `outcome.signals` +
 *     `outcome.evidence`: one INSERT … ON CONFLICT (user_id) DO UPDATE, so a re-apply
 *     updates the applicant's own row and the audit trail cannot fork (migration 045).
 *     The DB's UNIQUE index (partial since 046) is the backstop: a 23505 is converted
 *     into the SAME applicant-facing 409 message as the pre-write claim check.
 *     No UPDATE path exists elsewhere; phase-2 unit B's admin transitions add guarded
 *     UPDATEs, and they too write through this module's shape.
 *
 *  2. `applyForNonprofitFree(input, deps)` — the pure-ish order of operations from the
 *     build plan §1, with every side effect injectable. That is what lets the unit suite
 *     prove "a malformed EIN writes nothing" and "a duplicate EIN never calls the engine"
 *     with no database. The route (src/routes/api/nonprofit/apply.ts) does authentication
 *     and rate limiting and then calls this function.
 *
 * ORDER OF OPERATIONS (build plan §1 — the route owns 1-2, this function owns 3-7):
 *   1. authenticated user (route; 401 otherwise)
 *   2. rate limits BEFORE any DB write (route)
 *   3. validate fields → 400 per-field, NO row and NO decision
 *   4. claim check on the EIN → 409 with the neutral message, and NO IRS lookup at all
 *   5. verification against the LOCAL IRS mirror only (fail-closed to manual review)
 *   6. persist via the single audited writer
 *   7. status from the decision, plus the applicant email (approved / not granted)
 *
 * NOTHING here touches Stripe, a card, a price, a plan tier or a subscription: Nonprofit
 * Free is an internal entitlement record (owner spec: no credit card, ever). A test
 * asserts this file contains no billing token at all.
 */
import { sql } from "~/db";
import {
  NONPROFIT_EIN_CLAIMED_MESSAGE,
  computeReverifyDueAt,
  evaluateNonprofitEinClaim,
  getNonprofitApplicationByEin,
  type NonprofitStatus,
} from "~/lib/nonprofit.server";
import {
  normalizeEin,
  verifyNonprofitApplication,
  type NonprofitVerificationOutcome,
  type VerifyNonprofitApplicationInput,
} from "~/lib/nonprofit-verification.server";
import { US_STATES } from "~/lib/states";
import {
  NONPROFIT_APPLY_REVIEW_WINDOW,
  NONPROFIT_APPLY_VALIDATION,
  nonprofitSubmittedCopy,
  statusCopyFor,
  verificationWording,
} from "~/lib/nonprofit-copy";

// ── Field validation (form-level, never a decision) ───────────────────────────
export const NONPROFIT_APPLY_CAPS = {
  orgName: 120,
  workEmail: 254,
  website: 250,
  contactName: 120,
  contactRole: 120,
} as const;

export interface NonprofitApplyFieldValues {
  orgName: string;
  workEmail: string;
  website: string | null;
  /** The NORMALISED 9-character EIN, as a string (leading zeros preserved). */
  ein: string;
  state: string | null;
  contactName: string;
  contactRole: string | null;
  orgUseConfirmed: boolean;
}

export interface NonprofitApplyValidation {
  ok: boolean;
  /** One message per invalid field — rendered next to the field. */
  errors: Record<string, string>;
  value: NonprofitApplyFieldValues | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Validate the owner's field list (spec item 3: "Legal org name, EIN, Website, Work
 * email, State, Applicant name+role"). Returns per-field messages and NO value when
 * anything fails, so the caller cannot accidentally write a partial row.
 *
 * EIN: `normalizeEin` is the single normaliser — it refuses a JSON NUMBER outright
 * (a number has already lost a leading zero), zero-pads to nine characters and rejects
 * the test-form patterns. A malformed EIN is FORM VALIDATION: no row, no decision.
 */
export function validateNonprofitApplyFields(body: unknown): NonprofitApplyValidation {
  const errors: Record<string, string> = {};
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const orgName = asString(raw.orgName ?? raw.org_name);
  if (orgName.length < 2 || orgName.length > NONPROFIT_APPLY_CAPS.orgName) {
    errors.orgName = NONPROFIT_APPLY_VALIDATION.orgName;
  }

  const einRaw = raw.ein;
  const ein = normalizeEin(typeof einRaw === "string" ? einRaw : (einRaw as string | number | null));
  if (!ein.ok) {
    // The normaliser's message says exactly what is wrong (missing / not 9 digits /
    // leading-zero lost / test pattern) — reused verbatim rather than re-worded here.
    errors.ein = ein.message || NONPROFIT_APPLY_VALIDATION.ein;
  }

  const workEmail = asString(raw.workEmail ?? raw.work_email).toLowerCase();
  if (workEmail.length > NONPROFIT_APPLY_CAPS.workEmail || !EMAIL_PATTERN.test(workEmail)) {
    errors.workEmail = NONPROFIT_APPLY_VALIDATION.workEmail;
  }

  const websiteRaw = asString(raw.website);
  let website: string | null = null;
  if (websiteRaw.length > 0) {
    const withScheme = /^https?:\/\//i.test(websiteRaw) ? websiteRaw : `https://${websiteRaw}`;
    if (websiteRaw.length > NONPROFIT_APPLY_CAPS.website || !/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(withScheme)) {
      errors.website = NONPROFIT_APPLY_VALIDATION.website;
    } else {
      website = withScheme;
    }
  }

  const stateRaw = asString(raw.state).toUpperCase();
  const state = stateRaw.length > 0 && (US_STATES as readonly string[]).includes(stateRaw) ? stateRaw : null;
  if (!state) errors.state = NONPROFIT_APPLY_VALIDATION.state;

  const contactName = asString(raw.contactName ?? raw.contact_name);
  if (contactName.length < 1 || contactName.length > NONPROFIT_APPLY_CAPS.contactName) {
    errors.contactName = NONPROFIT_APPLY_VALIDATION.contactName;
  }

  const contactRoleRaw = asString(raw.contactRole ?? raw.contact_role);
  const contactRole = contactRoleRaw.length > 0 ? contactRoleRaw.slice(0, NONPROFIT_APPLY_CAPS.contactRole) : null;
  if (contactRoleRaw.length > NONPROFIT_APPLY_CAPS.contactRole) {
    errors.contactRole = NONPROFIT_APPLY_VALIDATION.contactRole;
  }

  // The owner's two-tier permission line: the applicant declares they may act for the
  // organization. Required — an authorization tick that defaults to "yes" is not honest.
  const orgUseConfirmed = raw.orgUseConfirmed === true || raw.org_use_confirmed === true;
  if (!orgUseConfirmed) errors.orgUseConfirmed = NONPROFIT_APPLY_VALIDATION.orgUseConfirmed;

  const ok = Object.keys(errors).length === 0 && ein.ok;
  return {
    ok,
    errors,
    value: ok
      ? {
          orgName,
          workEmail,
          website,
          ein: ein.ok ? ein.ein : "",
          state,
          contactName,
          contactRole,
          orgUseConfirmed,
        }
      : null,
  };
}

// ── The single audited writer ─────────────────────────────────────────────────
export interface NonprofitApplicationWriteInput extends NonprofitApplyFieldValues {
  userId: number;
  /** Injectable clock so `granted_at` / `reverify_due_at` are deterministic in tests. */
  now?: Date;
}

export type SaveNonprofitApplicationResult =
  | { ok: true; applicationId: number | null; status: NonprofitStatus }
  | { ok: false; reason: "ein_claimed"; message: string };

/** The Postgres text-array literal for the engine's flag strings (all `[a-z_]` tokens). */
function pgTextArray(values: readonly string[]): string {
  if (values.length === 0) return "{}";
  return `{${values
    .map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",")}}`;
}
/** `irs_eo_bmf@2026-09-08` — which mirrored file/date produced the verdict. */
export function bmfSourceRefFor(outcome: NonprofitVerificationOutcome): string | null {
  const postingDate = outcome.signals.bmfPostingDate;
  if (!postingDate) return null;
  // The BMF is the only source whose rows decide; the date is the mirror's posting date.
  return `irs_eo_bmf@${String(postingDate).slice(0, 10)}`;
}

/**
 * EVERY column the engine's decision produces — as a pure, testable object.
 *
 * WHY IT IS SEPARATE FROM THE SQL. "Write every audit column from outcome.signals +
 * outcome.evidence" is an owner requirement (migration 045's audit list is what makes the
 * annual reverify and the right to revoke auditable), and a missing column would be
 * invisible in a SQL literal. Here the mapping is an object the unit suite can assert
 * column by column — including the decision → status/`granted_at`/`reverify_due_at`
 * mapping — with no database.
 */
export interface NonprofitApplicationColumns {
  status: NonprofitStatus;
  verification_method: string | null;
  submitted_name_normalized: string | null;
  matched_bmf_name: string | null;
  bmf_name_tier: string | null;
  bmf_status: string | null;
  bmf_subsection: string | null;
  bmf_group_no: string | null;
  bmf_posting_date: string | null;
  bmf_source_ref: string | null;
  pub78: boolean;
  pub78_deductibility_code: string | null;
  on_revocation_list: boolean;
  revocation_date: string | null;
  revocation_posting_date: string | null;
  reinstatement_date: string | null;
  decision: string;
  decision_reason: string;
  reason_class: string | null;
  supporting_docs_requested: boolean;
  decision_flags: string;
  evidence: string;
  granted_at: string | null;
  reverify_due_at: string | null;
}

export function buildNonprofitApplicationColumns(
  outcome: NonprofitVerificationOutcome,
  input: { now?: Date } = {},
): NonprofitApplicationColumns {
  const now = input.now ?? new Date();
  const approved = outcome.decision === "auto_approve";
  const signals = outcome.signals;
  return {
    status: outcome.status,
    // Only an IRS-mirror approval carries a method; a manual exception is written by the
    // admin queue (unit B), never by this writer.
    verification_method: approved ? (outcome.method ?? "irs_eo_bmf") : null,
    submitted_name_normalized: signals.submittedNameNormalized,
    matched_bmf_name: signals.matchedBmfName,
    bmf_name_tier: signals.nameTier,
    bmf_status: signals.bmfStatus,
    bmf_subsection: signals.bmfSubsection,
    bmf_group_no: signals.bmfGroupNo,
    bmf_posting_date: signals.bmfPostingDate,
    bmf_source_ref: bmfSourceRefFor(outcome),
    pub78: signals.inPub78,
    pub78_deductibility_code: signals.pub78DeductibilityCode,
    on_revocation_list: signals.onRevocationList,
    revocation_date: signals.revocationDate,
    revocation_posting_date: signals.revocationPostingDate,
    reinstatement_date: signals.reinstatementDate,
    decision: outcome.decision,
    decision_reason: outcome.reason,
    reason_class: outcome.reasonClass,
    supporting_docs_requested: outcome.supportingDocsRequested,
    decision_flags: pgTextArray(outcome.flags),
    evidence: JSON.stringify(outcome.evidence ?? {}),
    // The grant clock exists only for an approval; a later verdict clears the due date.
    granted_at: approved ? now.toISOString() : null,
    reverify_due_at: approved ? computeReverifyDueAt(now) : null,
  };
}

/**
 * THE ONLY writer of `nonprofit_applications` in this phase.
 *
 * A re-apply is an UPDATE of the applicant's own row (UNIQUE user_id) — the row keeps its
 * identity, its saved grants and its review history. A 23505 (the partial UNIQUE index on
 * `ein`) means someone else attached the EIN between the claim check and this write; it is
 * reported with the SAME message the claim check uses, never a raw constraint error.
 *
 * `released_at` is set to NULL on the applicant's own row: re-submitting an application is
 * that account re-claiming its EIN, and "one free org account per EIN" is enforced by the
 * index for attached rows. An admin release is never undone by anything else — only unit
 * B's release/transfer actions write the column.
 */
export async function saveNonprofitApplicationOutcome(
  outcome: NonprofitVerificationOutcome,
  input: NonprofitApplicationWriteInput,
): Promise<SaveNonprofitApplicationResult> {
  const c = buildNonprofitApplicationColumns(outcome, input);

  try {
    const rows = (await sql()`
      INSERT INTO nonprofit_applications (
        user_id, org_name, work_email, website, ein, state, contact_name, contact_role,
        org_use_confirmed, status, verification_method, submitted_name_normalized,
        matched_bmf_name, bmf_name_tier, bmf_status, bmf_subsection, bmf_group_no,
        bmf_posting_date, bmf_source_ref, pub78, pub78_deductibility_code,
        on_revocation_list, revocation_date, revocation_posting_date, reinstatement_date,
        decision, decision_reason, reason_class, supporting_docs_requested,
        decision_flags, evidence, granted_at, reverify_due_at, released_at
      ) VALUES (
        ${input.userId}, ${input.orgName}, ${input.workEmail}, ${input.website}, ${input.ein},
        ${input.state}, ${input.contactName}, ${input.contactRole}, ${input.orgUseConfirmed},
        ${c.status}, ${c.verification_method}, ${c.submitted_name_normalized},
        ${c.matched_bmf_name}, ${c.bmf_name_tier}, ${c.bmf_status},
        ${c.bmf_subsection}, ${c.bmf_group_no}, ${c.bmf_posting_date},
        ${c.bmf_source_ref}, ${c.pub78}, ${c.pub78_deductibility_code},
        ${c.on_revocation_list}, ${c.revocation_date}, ${c.revocation_posting_date},
        ${c.reinstatement_date}, ${c.decision}, ${c.decision_reason},
        ${c.reason_class}, ${c.supporting_docs_requested},
        ${c.decision_flags}::text[], ${c.evidence}::jsonb, ${c.granted_at}, ${c.reverify_due_at}, NULL
      )
      ON CONFLICT (user_id) DO UPDATE SET
        org_name = EXCLUDED.org_name,
        work_email = EXCLUDED.work_email,
        website = EXCLUDED.website,
        ein = EXCLUDED.ein,
        state = EXCLUDED.state,
        contact_name = EXCLUDED.contact_name,
        contact_role = EXCLUDED.contact_role,
        org_use_confirmed = EXCLUDED.org_use_confirmed,
        status = EXCLUDED.status,
        verification_method = EXCLUDED.verification_method,
        submitted_name_normalized = EXCLUDED.submitted_name_normalized,
        matched_bmf_name = EXCLUDED.matched_bmf_name,
        bmf_name_tier = EXCLUDED.bmf_name_tier,
        bmf_status = EXCLUDED.bmf_status,
        bmf_subsection = EXCLUDED.bmf_subsection,
        bmf_group_no = EXCLUDED.bmf_group_no,
        bmf_posting_date = EXCLUDED.bmf_posting_date,
        bmf_source_ref = EXCLUDED.bmf_source_ref,
        pub78 = EXCLUDED.pub78,
        pub78_deductibility_code = EXCLUDED.pub78_deductibility_code,
        on_revocation_list = EXCLUDED.on_revocation_list,
        revocation_date = EXCLUDED.revocation_date,
        revocation_posting_date = EXCLUDED.revocation_posting_date,
        reinstatement_date = EXCLUDED.reinstatement_date,
        decision = EXCLUDED.decision,
        decision_reason = EXCLUDED.decision_reason,
        reason_class = EXCLUDED.reason_class,
        supporting_docs_requested = EXCLUDED.supporting_docs_requested,
        decision_flags = EXCLUDED.decision_flags,
        evidence = EXCLUDED.evidence,
        -- The historical first-grant date is never erased by a later verdict...
        granted_at = COALESCE(EXCLUDED.granted_at, nonprofit_applications.granted_at),
        -- ...but the reverify clock always follows the CURRENT verdict.
        reverify_due_at = EXCLUDED.reverify_due_at,
        released_at = NULL,
        updated_at = NOW()
      RETURNING id, status
    `) as { id: number; status: string }[];
    const row = rows[0];
    return { ok: true, applicationId: row?.id ?? null, status: (row?.status ?? outcome.status) as NonprofitStatus };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "23505" || /duplicate key value/i.test(String((error as Error)?.message ?? ""))) {
      // The database's "one free org account per EIN" backstop. Same neutral message as
      // the pre-write claim check — the applicant is never told who holds it.
      return { ok: false, reason: "ein_claimed", message: NONPROFIT_EIN_CLAIMED_MESSAGE };
    }
    throw error;
  }
}

// ── The apply flow (injectable side effects → testable with no database) ──────
export interface NonprofitNotification {
  kind: "approved" | "denied";
  email: string;
  orgName: string;
  /** The owner's wording, built from the mirror's posting date; null when unknown. */
  verificationWording: string | null;
}

export interface NonprofitApplyDeps {
  findEinHolder(ein: string): ReturnType<typeof getNonprofitApplicationByEin>;
  verify(input: VerifyNonprofitApplicationInput): Promise<NonprofitVerificationOutcome>;
  save(
    outcome: NonprofitVerificationOutcome,
    input: NonprofitApplicationWriteInput,
  ): Promise<SaveNonprofitApplicationResult>;
  notify?(notification: NonprofitNotification): Promise<void>;
  now(): Date;
}

/**
 * The REAL dependencies. `notify` is intentionally absent here: the route supplies the
 * email senders, so this module never imports the mailer and the unit suite cannot send
 * anything.
 */
export const defaultNonprofitApplyDeps: NonprofitApplyDeps = {
  findEinHolder: (ein) => getNonprofitApplicationByEin(ein),
  verify: (input) => verifyNonprofitApplication(input),
  save: (outcome, input) => saveNonprofitApplicationOutcome(outcome, input),
  now: () => new Date(),
};

export interface NonprofitApplyRequest {
  userId: number;
  body: unknown;
}
export interface NonprofitApplyResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Steps 3-7 of the build plan's order of operations. Every response body is deliberate:
 * it carries the applicant's own outcome and copy, and NEVER the EIN, the holder's user
 * id, the matched IRS name, the reason class or any revocation data.
 */
export async function applyForNonprofitFree(
  request: NonprofitApplyRequest,
  deps: NonprofitApplyDeps = defaultNonprofitApplyDeps,
): Promise<NonprofitApplyResult> {
  const now = deps.now();

  // 3. Field validation → 400 per field, and NOTHING is written or decided.
  const validation = validateNonprofitApplyFields(request.body);
  if (!validation.ok || !validation.value) {
    return { status: 400, body: { ok: false, errors: validation.errors } };
  }
  const input = validation.value;

  // 4. The claim check. A held EIN is a 409 with the neutral message and NO IRS lookup:
  // the mirror is not consulted at all for someone else's organization.
  const holder = await deps.findEinHolder(input.ein);
  const claim = evaluateNonprofitEinClaim({ userId: request.userId, existing: holder });
  if (!claim.allowed) {
    return { status: 409, body: { ok: false, error: NONPROFIT_EIN_CLAIMED_MESSAGE } };
  }

  // 5. Verification — the local IRS mirror only, fail-closed to manual review.
  const outcome = await deps.verify({
    ein: input.ein,
    orgName: input.orgName,
    websiteOrEmail: input.website ?? input.workEmail,
    einClaim: holder
      ? { userId: holder.user_id, orgName: holder.org_name ?? null, status: holder.status }
      : null,
    applicantUserId: request.userId,
    now,
  });

  // A malformed EIN is form validation and must never reach a decision or a row. The
  // normaliser above already guarantees this, so this is a belt-and-braces refusal.
  if (outcome.decision === "reentry_required") {
    return { status: 400, body: { ok: false, errors: { ein: NONPROFIT_APPLY_VALIDATION.ein } } };
  }

  // 6. The single audited writer.
  const saved = await deps.save(outcome, { ...input, userId: request.userId, now });
  if (!saved.ok) {
    return { status: 409, body: { ok: false, error: saved.message } };
  }

  // 7. The applicant is told the outcome in plain language. Copy comes from the copy
  // module, so the API response and the page cannot state different things.
  const wording = verificationWording(outcome.signals.bmfPostingDate ?? null);
  const copy = statusCopyFor(outcome.status);
  if (deps.notify && (outcome.status === "approved" || outcome.status === "denied")) {
    // Fail-open by contract: a mail problem never changes the applicant's outcome. The
    // senders themselves no-op without RESEND_API_KEY.
    try {
      await deps.notify({
        kind: outcome.status === "approved" ? "approved" : "denied",
        email: input.workEmail,
        orgName: input.orgName,
        verificationWording: wording,
      });
    } catch (error) {
      console.error(
        "[nonprofit] applicant email failed (outcome unchanged):",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      status: outcome.status,
      statusLabel: copy?.label ?? null,
      message: nonprofitSubmittedCopy(outcome.status),
      reviewWindow: NONPROFIT_APPLY_REVIEW_WINDOW,
      supportingDocsRequested: outcome.supportingDocsRequested,
      // The owner's wording, from the mirror's date — null (rendered as nothing) when the
      // mirror has not been imported, which is also when nothing can be auto-approved.
      verificationWording: wording,
    },
  };
}

// ── Read side for the status surface ──────────────────────────────────────────
export interface NonprofitApplicationStatusRow {
  id: number;
  org_name: string;
  work_email: string;
  state: string | null;
  contact_name: string;
  contact_role: string | null;
  status: string;
  verification_method: string | null;
  bmf_posting_date: string | null;
  granted_at: string | null;
  reverify_due_at: string | null;
  supporting_docs_requested: boolean;
  reviewed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function isoOrNull(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * The signed-in user's OWN application. Scoped by `user_id` in SQL — there is no id
 * parameter to tamper with, so one account can never read another's row.
 *
 * The EIN is deliberately NOT selected: the owner's rule is that an EIN is never
 * publicly displayed, explicitly including the applicant status page (build plan §6), so
 * leaving it out of the read means no caller can leak it by accident.
 */
export async function getNonprofitApplicationStatus(
  userId: number | null | undefined,
): Promise<NonprofitApplicationStatusRow | null> {
  if (userId == null) return null;
  const rows = (await sql()`
    SELECT id, org_name, work_email, state, contact_name, contact_role, status,
           verification_method, bmf_posting_date, granted_at, reverify_due_at,
           supporting_docs_requested, reviewed_at, created_at, updated_at
    FROM nonprofit_applications
    WHERE user_id = ${userId}
    LIMIT 1
  `) as Record<string, unknown>[];
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    org_name: String(row.org_name ?? ""),
    work_email: String(row.work_email ?? ""),
    state: (row.state as string | null) ?? null,
    contact_name: String(row.contact_name ?? ""),
    contact_role: (row.contact_role as string | null) ?? null,
    status: String(row.status ?? "pending"),
    verification_method: (row.verification_method as string | null) ?? null,
    bmf_posting_date: isoOrNull(row.bmf_posting_date)?.slice(0, 10) ?? null,
    granted_at: isoOrNull(row.granted_at),
    reverify_due_at: isoOrNull(row.reverify_due_at),
    supporting_docs_requested: row.supporting_docs_requested === true,
    reviewed_at: isoOrNull(row.reviewed_at),
    created_at: isoOrNull(row.created_at),
    updated_at: isoOrNull(row.updated_at),
  };
}
