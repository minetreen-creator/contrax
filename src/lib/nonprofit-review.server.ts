/**
 * Nonprofit Free phase 2 (unit B) — the admin review queue's SERVER half.
 *
 * WHAT THIS IS. The human review surface for the phase-2 apply flow: the queue list and
 * the per-application detail read, the four GUARDED status transitions the owner locked
 * (approve | deny | request-info | release), and the append-only audit row each action
 * writes into migration 046's `nonprofit_application_reviews`.
 *
 * THE OWNER'S LOCKS THIS MODULE SERVES (implementation lock 2026-09-21):
 *   • "Manual reviews: agent-lead initially; 3-business-day SLA; append-only reviews;
 *     reviewed_by = immutable user id + email" — hence `reviewed_by = "user:<id> <<email>>"`
 *     and one INSERT per action, never an in-place edit of the application row alone.
 *   • "Denied/revoked EIN — release ONLY via explicit admin action. No automatic
 *     cooldown." — `release` is a deliberate act that sets `released_at` (the partial
 *     unique index then makes the EIN claimable) and NEVER deletes the row.
 *   • "A status change suspends the entitlement; it never destroys the account or its
 *     data" — no statement in this file deletes anything, and `release` does not even
 *     change `status`.
 *   • "verified remains the only granted status" — `approve` moves a row to `approved`,
 *     which is exactly the status the phase-1 entitlement ladder grants from
 *     (`isNonprofitStatusGranted`); nothing here invents a new status.
 *
 * WHY EVERY DECISION IS A GUARDED UPDATE. The reverify pass established the discipline:
 * `UPDATE … WHERE id = $1 AND status = ANY($expected)` and 0 rows ⇒ 409 "already
 * actioned". Two reviewers (or one double-click) can never double-apply an action, and a
 * stale browser tab can never re-approve a row that was denied a second earlier. The
 * audit row is written by the SAME statement as the update (a CTE), so an action can
 * never be recorded without applying, or applied without being recorded.
 *
 * DELIBERATELY ABSENT:
 *   • `transfer` — schema-ready in 046's CHECK, deferred by the lead (no UI, no route).
 *   • Any decision path through `saveNonprofitApplicationOutcome`: that writer is an
 *     INSERT … ON CONFLICT (user_id) DO UPDATE owned by the applicant's own re-apply, and
 *     a reviewer decision needs the guarded UPDATE + audit above instead.
 *   • Any Stripe / card / price / `plan_tier` / `grants_subscriptions` write. Nonprofit
 *     Free is an internal entitlement record (owner spec: no credit card, ever) and a
 *     test scans this file for billing tokens.
 *   • The EIN. The reviewer projection never selects or serializes it (owner rule: an EIN
 *     is never displayed) — the queue shows the matched IRS name and the source reference
 *     instead, which is what a reviewer actually reads.
 */
import { sql } from "~/db";
import {
  computeReverifyDueAt,
  isNonprofitStatusGranted,
  subsectionLabel,
  type NonprofitStatus,
} from "~/lib/nonprofit.server";
import { bmfStatusMeaning, domainCorrespondsToName } from "~/lib/nonprofit-verification.server";
import {
  NONPROFIT_REVIEW_DENY_NOTE_REQUIRED,
  NONPROFIT_REVIEW_DOMAIN_LABEL,
} from "~/lib/nonprofit-copy";

// ── The owner's action set ────────────────────────────────────────────────────
/**
 * Unit B dispatches these four. `suspend` is the reverify pass's action (phase 1) and
 * `transfer` is deliberately not implemented (lead ruling (ii)); both stay valid in
 * 046's CHECK so no DDL is needed when they arrive.
 */
export const NONPROFIT_REVIEW_ACTIONS = ["approve", "deny", "request_info", "release"] as const;
export type NonprofitReviewAction = (typeof NONPROFIT_REVIEW_ACTIONS)[number];

export function isNonprofitReviewAction(value: unknown): value is NonprofitReviewAction {
  return typeof value === "string" && (NONPROFIT_REVIEW_ACTIONS as readonly string[]).includes(value);
}

/** The queue's default view: what a person still has to act on. */
export const NONPROFIT_QUEUE_STATUSES: readonly NonprofitStatus[] = ["pending", "manual_review"];
/**
 * The view that makes `release` REACHABLE (lead ruling: the "denied & revoked" tab is in
 * scope). A denied/revoked EIN is only released by an explicit admin action, so without a
 * filter that shows those rows the owner's lock could not be exercised at all.
 */
export const NONPROFIT_RELEASE_STATUSES: readonly NonprofitStatus[] = ["denied", "revoked"];

export const NONPROFIT_QUEUE_FILTERS = ["queue", "denied_revoked", "approved", "all"] as const;
export type NonprofitQueueFilter = (typeof NONPROFIT_QUEUE_FILTERS)[number];

export function isNonprofitQueueFilter(value: unknown): value is NonprofitQueueFilter {
  return typeof value === "string" && (NONPROFIT_QUEUE_FILTERS as readonly string[]).includes(value);
}

/** `null` means "no status predicate" (the `all` view). */
export function statusesForQueueFilter(filter: NonprofitQueueFilter): readonly NonprofitStatus[] | null {
  switch (filter) {
    case "queue":
      return NONPROFIT_QUEUE_STATUSES;
    case "denied_revoked":
      return NONPROFIT_RELEASE_STATUSES;
    case "approved":
      return ["approved"];
    case "all":
      return null;
  }
}

/**
 * Which statuses each action may act on — the SAME list the SQL guard interpolates, so the
 * documented rule and the enforced rule cannot drift.
 */
export const NONPROFIT_REVIEW_ACTION_GUARDS: Readonly<Record<NonprofitReviewAction, readonly NonprofitStatus[]>> = {
  approve: NONPROFIT_QUEUE_STATUSES,
  deny: NONPROFIT_QUEUE_STATUSES,
  request_info: NONPROFIT_QUEUE_STATUSES,
  release: NONPROFIT_RELEASE_STATUSES,
};

export const NONPROFIT_QUEUE_DEFAULT_LIMIT = 100;
export const NONPROFIT_QUEUE_MAX_LIMIT = 200;

// ── The SLA clock (weekends excluded, public holidays NOT modelled) ───────────
/**
 * Whole UTC calendar days between two instants (0 when `to` is not after `from`).
 * UTC on purpose: the queue is a server-rendered read and a reviewer's local timezone
 * must never change the number they see.
 */
export function calendarDaysBetween(from: string | Date, to: string | Date): number {
  const start = utcDayNumber(new Date(from));
  const end = utcDayNumber(new Date(to));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return end - start;
}

/**
 * Whole WEEKDAYS elapsed after the creation day: Fri → Mon is 1, Mon → Mon (next week) is
 * 5. Public holidays are deliberately not modelled, which is exactly why the reviewer
 * surface shows this count and the owner's "within 3 business days" wording — and never a
 * computed due-by date (build plan §2; unit B brief §B9).
 */
export function businessDaysBetween(from: string | Date, to: string | Date): number {
  const start = utcDayNumber(new Date(from));
  const end = utcDayNumber(new Date(to));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  let count = 0;
  for (let day = start + 1; day <= end; day += 1) {
    if (!isWeekendDay(day)) count += 1;
  }
  return count;
}

export interface NonprofitReviewAge {
  calendarDays: number;
  businessDays: number;
}

export function nonprofitReviewAge(createdAt: string | Date, now: string | Date = new Date()): NonprofitReviewAge {
  return {
    calendarDays: calendarDaysBetween(createdAt, now),
    businessDays: businessDaysBetween(createdAt, now),
  };
}

function utcDayNumber(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

/** Day 0 of the epoch was a Thursday, and `getUTCDay()` puts Sunday at 0. */
function isWeekendDay(dayNumber: number): boolean {
  const weekday = (((dayNumber + 4) % 7) + 7) % 7;
  return weekday === 0 || weekday === 6;
}

// ── The decision plan (pure: no database, no clock except the injected one) ───
export interface NonprofitReviewActor {
  id: number;
  email: string;
}

/** The owner's immutable audit identity: id + email as displayed at the time. */
export function reviewedByFor(actor: NonprofitReviewActor): string {
  return `user:${actor.id} <${actor.email}>`;
}

/**
 * Everything a decision would do, as DATA. Splitting the plan out of the executor is what
 * lets the unit suite assert the exact column mapping of each action — and the exact guard
 * each action carries — with no database (the same reason Unit A's writer has a pure
 * column-mapping function).
 */
export interface NonprofitReviewPlan {
  action: NonprofitReviewAction;
  applicationId: number;
  actorUserId: number;
  actorEmail: string;
  /** The SQL guard's status list. */
  expectedStatuses: readonly NonprofitStatus[];
  /** `release`: the EIN must still be HELD, or the action was already taken (⇒ 0 rows). */
  requireReleasedAtNull: boolean;
  /** `request_info`: only the FIRST outstanding document request applies (⇒ no double-apply). */
  requireNoOutstandingDocRequest: boolean;
  /** Whether the UPDATE writes `status` at all — `release` never does. */
  setsStatus: boolean;
  /** The status the row ends in. For `release` this equals the status it started in. */
  newStatus: NonprofitStatus;
  verificationMethod: "manual_exception" | null;
  /** `approve` only: `granted_at = COALESCE(granted_at, now)`. */
  grantsIfMissing: boolean;
  reverifyDueAt: string | null;
  releasedAt: string | null;
  setsSupportingDocsRequested: boolean;
  reviewedBy: string;
  reviewedAt: string;
  reviewNotes: string | null;
}

export type NonprofitReviewPlanResult =
  | { ok: true; plan: NonprofitReviewPlan }
  | { ok: false; status: 400; error: string };

/**
 * The four transitions, exactly as the owner locked them:
 *
 *   approve      → status='approved' (from pending|manual_review), verification_method=
 *                  'manual_exception', granted_at=COALESCE(granted_at, now),
 *                  reverify_due_at=computeReverifyDueAt(now). `decision` and `reason_class`
 *                  keep whatever the engine wrote — a human decision is not a re-run of the
 *                  engine and must not overwrite its audit.
 *   deny         → status='denied'; a TYPED note is required (never a preset reason).
 *   request_info → supporting_docs_requested=TRUE and status='manual_review' (a `pending`
 *                  row joins the review lane; a row already in review stays there). Nothing
 *                  is granted or refused.
 *   release      → released_at=now, `status` UNCHANGED (there is no 'released' status in
 *                  045's CHECK, and the owner's rule is an EIN release, not a status).
 */
export function planNonprofitReviewDecision(input: {
  applicationId: number;
  action: NonprofitReviewAction;
  note?: string | null;
  actor: NonprofitReviewActor;
  currentStatus: NonprofitStatus;
  now?: Date;
}): NonprofitReviewPlanResult {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const note = typeof input.note === "string" && input.note.trim().length > 0 ? input.note.trim() : null;
  const base = {
    applicationId: input.applicationId,
    actorUserId: input.actor.id,
    actorEmail: input.actor.email,
    expectedStatuses: NONPROFIT_REVIEW_ACTION_GUARDS[input.action],
    reviewedBy: reviewedByFor(input.actor),
    reviewedAt: nowIso,
    reviewNotes: note,
  };

  switch (input.action) {
    case "approve":
      return {
        ok: true,
        plan: {
          ...base,
          action: "approve",
          requireReleasedAtNull: false,
          requireNoOutstandingDocRequest: false,
          setsStatus: true,
          newStatus: "approved",
          verificationMethod: "manual_exception",
          grantsIfMissing: true,
          reverifyDueAt: computeReverifyDueAt(now),
          releasedAt: null,
          setsSupportingDocsRequested: false,
        },
      };
    case "deny":
      if (!note) {
        // A denial is the one action the owner required a written reason for: it is
        // internal, and it is what a later reviewer (or an appeal) reads first.
        return { ok: false, status: 400, error: NONPROFIT_REVIEW_DENY_NOTE_REQUIRED };
      }
      return {
        ok: true,
        plan: {
          ...base,
          action: "deny",
          requireReleasedAtNull: false,
          requireNoOutstandingDocRequest: false,
          setsStatus: true,
          newStatus: "denied",
          verificationMethod: null,
          grantsIfMissing: false,
          reverifyDueAt: null,
          releasedAt: null,
          setsSupportingDocsRequested: false,
        },
      };
    case "request_info":
      return {
        ok: true,
        plan: {
          ...base,
          action: "request_info",
          requireReleasedAtNull: false,
          // Without this guard a replayed `request_info` would match again (the status does
          // not change) and file a SECOND audit row for one decision.
          requireNoOutstandingDocRequest: true,
          setsStatus: true,
          newStatus: "manual_review",
          verificationMethod: null,
          grantsIfMissing: false,
          reverifyDueAt: null,
          releasedAt: null,
          setsSupportingDocsRequested: true,
        },
      };
    case "release":
      return {
        ok: true,
        plan: {
          ...base,
          action: "release",
          requireReleasedAtNull: true,
          requireNoOutstandingDocRequest: false,
          setsStatus: false,
          newStatus: input.currentStatus,
          verificationMethod: null,
          grantsIfMissing: false,
          reverifyDueAt: null,
          releasedAt: nowIso,
          setsSupportingDocsRequested: false,
        },
      };
  }
}

// ── The guarded UPDATE + audit INSERT, as one statement ───────────────────────
export interface NonprofitDecisionStatement {
  text: string;
  params: unknown[];
}

/**
 * ONE statement: a CTE reads the row's prior status, the second CTE performs the GUARDED
 * update, and the INSERT records the audit row from the two of them. If the guard matches
 * nothing the INSERT selects nothing, so the caller sees 0 rows ⇒ 409 and NOTHING was
 * recorded — an action can never be audited without being applied, or applied without
 * being audited.
 *
 * `$n` placeholders with `sql().query()` (the `profile-filters.ts` / `run-040.ts`
 * precedent) rather than a tagged template: the SET list genuinely differs per action, and
 * every dynamic part here is a hard-coded column name or a bound parameter.
 */
export function buildNonprofitDecisionStatement(plan: NonprofitReviewPlan): NonprofitDecisionStatement {
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const sets: string[] = [];
  if (plan.setsStatus) sets.push(`status = ${bind(plan.newStatus)}`);
  if (plan.verificationMethod) sets.push(`verification_method = ${bind(plan.verificationMethod)}`);
  if (plan.grantsIfMissing) {
    // The historical first-grant date survives: a second approval never rewrites it.
    sets.push(`granted_at = COALESCE(granted_at, ${bind(plan.reviewedAt)}::timestamptz)`);
    sets.push(`reverify_due_at = ${bind(plan.reverifyDueAt)}::timestamptz`);
  }
  if (plan.setsSupportingDocsRequested) sets.push("supporting_docs_requested = TRUE");
  if (plan.releasedAt) sets.push(`released_at = ${bind(plan.releasedAt)}::timestamptz`);
  sets.push(`reviewed_by = ${bind(plan.reviewedBy)}`);
  sets.push(`reviewed_at = ${bind(plan.reviewedAt)}::timestamptz`);
  sets.push(`review_notes = ${bind(plan.reviewNotes)}`);
  sets.push(`updated_at = ${bind(plan.reviewedAt)}::timestamptz`);

  // The status list is a fixed, type-constrained enum — never caller text — and it travels
  // as a bound text parameter cast to text[] (the same shape Unit A's writer uses for
  // `decision_flags`).
  const statusArray = `{${plan.expectedStatuses.map((status) => `"${status}"`).join(",")}}`;
  const guards: string[] = [
    `id = ${bind(plan.applicationId)}`,
    `status = ANY(${bind(statusArray)}::text[])`,
  ];
  if (plan.requireReleasedAtNull) guards.push("released_at IS NULL");
  if (plan.requireNoOutstandingDocRequest) guards.push("supporting_docs_requested = FALSE");

  const text = [
    "WITH prior AS (",
    `  SELECT id, status FROM nonprofit_applications WHERE id = ${bind(plan.applicationId)}`,
    "), updated AS (",
    `  UPDATE nonprofit_applications SET ${sets.join(", ")}`,
    `  WHERE ${guards.join(" AND ")}`,
    "  RETURNING id, status",
    ")",
    "INSERT INTO nonprofit_application_reviews",
    "  (application_id, action, actor_user_id, actor_email, internal_note, prior_status, new_status, created_at)",
    `SELECT u.id, ${bind(plan.action)}, ${bind(plan.actorUserId)}, ${bind(plan.actorEmail)}, ` +
      `${bind(plan.reviewNotes)}, p.status, u.status, ${bind(plan.reviewedAt)}::timestamptz`,
    "FROM updated u JOIN prior p ON p.id = u.id",
    "RETURNING application_id, action, prior_status, new_status, created_at",
  ].join("\n");

  return { text, params };
}

export interface NonprofitReviewAuditRow {
  id?: number;
  applicationId: number;
  action: string;
  actorUserId: number | null;
  actorEmail: string | null;
  reasonCode: string | null;
  internalNote: string | null;
  priorStatus: string;
  newStatus: string;
  createdAt: string | null;
}

// ── The reviewer projections ──────────────────────────────────────────────────
/**
 * The queue row: only what the list renders. The EIN is NOT here (never displayed), and
 * neither is `evidence` — the conflict claimant behind an EIN is a DETAIL-only field, so
 * the list can never leak it in bulk.
 */
export interface NonprofitQueueRow {
  id: number;
  orgName: string;
  workEmail: string;
  website: string | null;
  state: string | null;
  contactName: string;
  contactRole: string | null;
  status: NonprofitStatus;
  decision: string | null;
  reasonClass: string | null;
  submittedNameNormalized: string | null;
  matchedBmfName: string | null;
  bmfNameTier: string | null;
  supportingDocsRequested: boolean;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  age: NonprofitReviewAge;
}

/** The full row the queue and the detail share, before projection. */
export interface NonprofitApplicationFullRow extends NonprofitQueueRow {
  grantedAt: string | null;
  reverifyDueAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  bmfStatus: string | null;
  bmfSubsection: string | null;
  bmfGroupNo: string | null;
  bmfPostingDate: string | null;
  bmfSourceRef: string | null;
  pub78: boolean | null;
  pub78DeductibilityCode: string | null;
  onRevocationList: boolean | null;
  revocationDate: string | null;
  revocationPostingDate: string | null;
  reinstatementDate: string | null;
  decisionReason: string | null;
  decisionFlags: string[];
  evidence: Record<string, unknown> | null;
  granted: boolean;
}

export interface NonprofitReviewDetail extends NonprofitApplicationFullRow {
  irs: {
    decision: string | null;
    decisionReason: string | null;
    reasonClass: string | null;
    decisionFlags: string[];
    matchedBmfName: string | null;
    bmfNameTier: string | null;
    bmfStatus: string | null;
    bmfStatusMeaning: string | null;
    bmfSubsection: string | null;
    bmfSubsectionLabel: string | null;
    bmfGroupNo: string | null;
    bmfPostingDate: string | null;
    bmfSourceRef: string | null;
    pub78: boolean | null;
    pub78DeductibilityCode: string | null;
    onRevocationList: boolean | null;
    revocationDate: string | null;
    revocationPostingDate: string | null;
    reinstatementDate: string | null;
    decidedBy: string | null;
    decidedAt: string | null;
  };
  /** The stored claimant behind a contested EIN — DETAIL only, behind the admin gate. */
  einClaim: { claimedByUserId: number | null; claimedOrgName: string | null } | null;
  /** The refresh-driven reverify evidence, when a refresh touched this row. */
  refreshReverify: unknown;
  domainSignal: {
    /** Always NONPROFIT_REVIEW_DOMAIN_LABEL: "secondary signal — never a verdict". */
    label: string;
    corresponds: boolean;
    checked: string | null;
    basis: "website" | "work_email" | null;
  };
  audit: NonprofitReviewAuditRow[];
}

const APPLICATION_COLUMNS = `
  id, org_name, work_email, website, state, contact_name, contact_role, status,
  decision, decision_reason, reason_class, decision_flags, submitted_name_normalized,
  matched_bmf_name, bmf_name_tier, bmf_status, bmf_subsection, bmf_group_no,
  bmf_posting_date, bmf_source_ref, pub78, pub78_deductibility_code, on_revocation_list,
  revocation_date, revocation_posting_date, reinstatement_date, supporting_docs_requested,
  released_at, evidence, reviewed_by, reviewed_at, review_notes, granted_at,
  reverify_due_at, created_at, updated_at`;

function isoOrNull(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function dayOrNull(value: unknown): string | null {
  return isoOrNull(value)?.slice(0, 10) ?? null;
}

function textArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === "string" && value.startsWith("{")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((entry) => entry.replace(/^"|"$/g, "").trim())
      .filter((entry) => entry.length > 0);
  }
  return [];
}

function mapApplicationRow(row: Record<string, unknown>, now: Date): NonprofitApplicationFullRow {
  const createdAt = isoOrNull(row.created_at) ?? now.toISOString();
  const status = String(row.status ?? "pending") as NonprofitStatus;
  const evidence =
    row.evidence && typeof row.evidence === "object" ? (row.evidence as Record<string, unknown>) : null;
  return {
    id: Number(row.id),
    orgName: String(row.org_name ?? ""),
    workEmail: String(row.work_email ?? ""),
    website: (row.website as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    contactName: String(row.contact_name ?? ""),
    contactRole: (row.contact_role as string | null) ?? null,
    status,
    decision: (row.decision as string | null) ?? null,
    decisionReason: (row.decision_reason as string | null) ?? null,
    reasonClass: (row.reason_class as string | null) ?? null,
    submittedNameNormalized: (row.submitted_name_normalized as string | null) ?? null,
    matchedBmfName: (row.matched_bmf_name as string | null) ?? null,
    bmfNameTier: (row.bmf_name_tier as string | null) ?? null,
    bmfStatus: (row.bmf_status as string | null) ?? null,
    bmfSubsection: (row.bmf_subsection as string | null) ?? null,
    bmfGroupNo: (row.bmf_group_no as string | null) ?? null,
    bmfPostingDate: dayOrNull(row.bmf_posting_date),
    bmfSourceRef: (row.bmf_source_ref as string | null) ?? null,
    pub78: typeof row.pub78 === "boolean" ? row.pub78 : null,
    pub78DeductibilityCode: (row.pub78_deductibility_code as string | null) ?? null,
    onRevocationList: typeof row.on_revocation_list === "boolean" ? row.on_revocation_list : null,
    revocationDate: dayOrNull(row.revocation_date),
    revocationPostingDate: dayOrNull(row.revocation_posting_date),
    reinstatementDate: dayOrNull(row.reinstatement_date),
    decisionFlags: textArray(row.decision_flags),
    evidence,
    supportingDocsRequested: row.supporting_docs_requested === true,
    releasedAt: isoOrNull(row.released_at),
    reviewedBy: (row.reviewed_by as string | null) ?? null,
    reviewedAt: isoOrNull(row.reviewed_at),
    reviewNotes: (row.review_notes as string | null) ?? null,
    grantedAt: isoOrNull(row.granted_at),
    reverifyDueAt: isoOrNull(row.reverify_due_at),
    createdAt,
    updatedAt: isoOrNull(row.updated_at),
    granted: isNonprofitStatusGranted(status),
    age: nonprofitReviewAge(createdAt, now),
  };
}

/** The list projection: an explicit pick, so a future column cannot reach the queue by accident. */
function toQueueRow(row: NonprofitApplicationFullRow): NonprofitQueueRow {
  return {
    id: row.id,
    orgName: row.orgName,
    workEmail: row.workEmail,
    website: row.website,
    state: row.state,
    contactName: row.contactName,
    contactRole: row.contactRole,
    status: row.status,
    decision: row.decision,
    reasonClass: row.reasonClass,
    submittedNameNormalized: row.submittedNameNormalized,
    matchedBmfName: row.matchedBmfName,
    bmfNameTier: row.bmfNameTier,
    supportingDocsRequested: row.supportingDocsRequested,
    releasedAt: row.releasedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    age: row.age,
  };
}

/**
 * The queue. `statusesForQueueFilter` supplies the predicate, `created_at ASC` puts the
 * oldest application first (the SLA order — the person waiting longest is at the top), and
 * the read rides `idx_nonprofit_applications_status_created` (migration 045).
 */
export async function listNonprofitApplications(
  filter: NonprofitQueueFilter,
  options: { limit?: number; now?: Date } = {},
): Promise<NonprofitQueueRow[]> {
  const now = options.now ?? new Date();
  const limit = Math.min(
    Math.max(Number.isFinite(options.limit) ? Number(options.limit) : NONPROFIT_QUEUE_DEFAULT_LIMIT, 1),
    NONPROFIT_QUEUE_MAX_LIMIT,
  );
  const statuses = statusesForQueueFilter(filter);
  const rows = (
    statuses
      ? await sql().query(
          `SELECT ${APPLICATION_COLUMNS} FROM nonprofit_applications
           WHERE status = ANY($1::text[])
           ORDER BY created_at ASC
           LIMIT $2`,
          [`{${statuses.map((status) => `"${status}"`).join(",")}}`, limit],
        )
      : await sql().query(
          `SELECT ${APPLICATION_COLUMNS} FROM nonprofit_applications
           ORDER BY created_at ASC
           LIMIT $1`,
          [limit],
        )
  ) as Record<string, unknown>[];
  return rows.map((row) => toQueueRow(mapApplicationRow(row, now)));
}

/** One row's reviewer projection, or null when the id does not exist (⇒ 404). */
export async function getNonprofitReviewApplication(
  applicationId: number,
  options: { now?: Date } = {},
): Promise<NonprofitReviewDetail | null> {
  const now = options.now ?? new Date();
  const rows = (await sql().query(
    `SELECT ${APPLICATION_COLUMNS} FROM nonprofit_applications WHERE id = $1 LIMIT 1`,
    [applicationId],
  )) as Record<string, unknown>[];
  const row = rows[0];
  if (!row) return null;
  const full = mapApplicationRow(row, now);
  const evidence = full.evidence ?? {};
  const claim = evidence.ein_claim as { claimed_by_user_id?: unknown; claimed_org_name?: unknown } | undefined;
  const domainChecked = full.website ?? full.workEmail ?? null;
  return {
    ...full,
    irs: {
      decision: full.decision,
      decisionReason: full.decisionReason,
      reasonClass: full.reasonClass,
      decisionFlags: full.decisionFlags,
      matchedBmfName: full.matchedBmfName,
      bmfNameTier: full.bmfNameTier,
      bmfStatus: full.bmfStatus,
      bmfStatusMeaning: bmfStatusMeaning(full.bmfStatus),
      bmfSubsection: full.bmfSubsection,
      bmfSubsectionLabel: subsectionLabel(full.bmfSubsection),
      bmfGroupNo: full.bmfGroupNo,
      bmfPostingDate: full.bmfPostingDate,
      bmfSourceRef: full.bmfSourceRef,
      pub78: full.pub78,
      pub78DeductibilityCode: full.pub78DeductibilityCode,
      onRevocationList: full.onRevocationList,
      revocationDate: full.revocationDate,
      revocationPostingDate: full.revocationPostingDate,
      reinstatementDate: full.reinstatementDate,
      decidedBy: typeof evidence.decided_by === "string" ? evidence.decided_by : null,
      decidedAt: typeof evidence.decided_at === "string" ? evidence.decided_at : null,
    },
    einClaim:
      claim && (typeof claim.claimed_by_user_id === "number" || typeof claim.claimed_org_name === "string")
        ? {
            claimedByUserId: typeof claim.claimed_by_user_id === "number" ? claim.claimed_by_user_id : null,
            claimedOrgName: typeof claim.claimed_org_name === "string" ? claim.claimed_org_name : null,
          }
        : null,
    refreshReverify: evidence.refresh_reverify ?? null,
    domainSignal: {
      label: NONPROFIT_REVIEW_DOMAIN_LABEL,
      corresponds: domainCorrespondsToName(domainChecked, full.submittedNameNormalized ?? full.orgName),
      checked: domainChecked,
      basis: full.website ? "website" : full.workEmail ? "work_email" : null,
    },
    audit: await listNonprofitApplicationReviews(applicationId),
  };
}

/** The append-only audit history for one application, oldest first. */
export async function listNonprofitApplicationReviews(
  applicationId: number,
): Promise<NonprofitReviewAuditRow[]> {
  const rows = (await sql().query(
    `SELECT id, application_id, action, actor_user_id, actor_email, reason_code, internal_note,
            prior_status, new_status, created_at
     FROM nonprofit_application_reviews
     WHERE application_id = $1
     ORDER BY created_at ASC, id ASC`,
    [applicationId],
  )) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: Number(row.id),
    applicationId: Number(row.application_id),
    action: String(row.action ?? ""),
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    actorEmail: (row.actor_email as string | null) ?? null,
    reasonCode: (row.reason_code as string | null) ?? null,
    internalNote: (row.internal_note as string | null) ?? null,
    priorStatus: String(row.prior_status ?? ""),
    newStatus: String(row.new_status ?? ""),
    createdAt: isoOrNull(row.created_at),
  }));
}

// ── The transitions ───────────────────────────────────────────────────────────
export interface NonprofitReviewDeps {
  /** The row under decision (the same admin read the detail route uses). */
  loadApplication(applicationId: number): Promise<NonprofitReviewDetail | null>;
  /**
   * Apply the plan's guarded UPDATE + audit INSERT as ONE statement. Returns the audit row
   * it wrote, or null when the guard matched nothing (⇒ already actioned).
   */
  applyDecision(plan: NonprofitReviewPlan): Promise<NonprofitReviewAuditRow | null>;
  now(): Date;
}

/** The real SQL executor (injected out in the unit suite — no database there). */
export async function applyNonprofitDecision(
  plan: NonprofitReviewPlan,
): Promise<NonprofitReviewAuditRow | null> {
  const statement = buildNonprofitDecisionStatement(plan);
  const rows = (await sql().query(statement.text, statement.params)) as Record<string, unknown>[];
  const row = rows[0];
  if (!row) return null;
  return {
    applicationId: Number(row.application_id),
    action: String(row.action ?? plan.action),
    actorUserId: plan.actorUserId,
    actorEmail: plan.actorEmail,
    reasonCode: null,
    internalNote: plan.reviewNotes,
    priorStatus: String(row.prior_status ?? ""),
    newStatus: String(row.new_status ?? ""),
    createdAt: isoOrNull(row.created_at),
  };
}

export const defaultNonprofitReviewDeps: NonprofitReviewDeps = {
  loadApplication: (applicationId) => getNonprofitReviewApplication(applicationId),
  applyDecision: (plan) => applyNonprofitDecision(plan),
  now: () => new Date(),
};

export interface NonprofitReviewDecisionResult {
  status: number;
  body: Record<string, unknown>;
}

export const NONPROFIT_REVIEW_ALREADY_ACTIONED =
  "This application has already been actioned — reload the queue and review the current status.";

/**
 * The reviewer's decision, end to end: validate → load (404) → plan → guarded apply (409
 * when the guard matched nothing, i.e. someone else moved the row first) → the audit row
 * the same statement wrote.
 */
export async function decideNonprofitApplication(
  input: {
    applicationId: number;
    action: string;
    note?: string | null;
    actor: NonprofitReviewActor;
  },
  deps: NonprofitReviewDeps = defaultNonprofitReviewDeps,
): Promise<NonprofitReviewDecisionResult> {
  if (!Number.isInteger(input.applicationId) || input.applicationId <= 0) {
    return { status: 400, body: { ok: false, error: "A numeric application id is required." } };
  }
  if (!isNonprofitReviewAction(input.action)) {
    return {
      status: 400,
      body: {
        ok: false,
        error: `action must be one of ${NONPROFIT_REVIEW_ACTIONS.join(", ")}`,
      },
    };
  }

  const application = await deps.loadApplication(input.applicationId);
  if (!application) {
    return { status: 404, body: { ok: false, error: "Application not found" } };
  }

  const planned = planNonprofitReviewDecision({
    applicationId: input.applicationId,
    action: input.action,
    note: input.note ?? null,
    actor: input.actor,
    currentStatus: application.status,
    now: deps.now(),
  });
  if (!planned.ok) {
    return { status: planned.status, body: { ok: false, error: planned.error } };
  }

  // The guarded UPDATE and its audit INSERT are ONE statement: 0 rows means the row was
  // already in a different state (a second reviewer, a double-click, a stale tab) and
  // NOTHING was written — not even an audit row for an action that never happened.
  const audit = await deps.applyDecision(planned.plan);
  if (!audit) {
    return {
      status: 409,
      body: { ok: false, error: NONPROFIT_REVIEW_ALREADY_ACTIONED, action: planned.plan.action },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      applicationId: audit.applicationId,
      action: planned.plan.action,
      priorStatus: audit.priorStatus,
      newStatus: audit.newStatus,
      reviewedBy: planned.plan.reviewedBy,
      reviewedAt: planned.plan.reviewedAt,
      supportingDocsRequested: planned.plan.setsSupportingDocsRequested || application.supportingDocsRequested,
      releasedAt: planned.plan.releasedAt ?? application.releasedAt,
      auditAt: audit.createdAt,
    },
  };
}
