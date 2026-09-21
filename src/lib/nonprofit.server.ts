/**
 * Nonprofit Free — the entitlement + access-policy state machine.
 *
 * Owner direction 2026-09-21 (green-lit, research COMPLETE): "Government grant
 * search—free for verified nonprofit organizations. No credit card required." The
 * CRITICAL RULE is that **basic searching stays free INDEFINITELY for a verified
 * nonprofit** — a permanent structural promise, never a promo, a trial or a sunset —
 * so an association (e.g. the Maine Association of Nonprofits) can honestly describe
 * Contrax as a completely free resource for its members.
 *
 * This module owns:  (1) the status union + the row shape, (2) the entitlement the API
 * and the page gate on, (3) the SEARCH POLICY per tier, and (4) the read side.
 * The IRS matching rule lives in `nonprofit-verification.server.ts`; the payment
 * surface is untouched — NO Stripe change, NO `grants_subscriptions` write (that
 * table's contract is "Stripe webhooks are the only writer"), NO `plan_tier` change.
 * The nonprofit entitlement is a separate internal record precisely so a free charity
 * tier can never be confused with a paid subscription.
 *
 * The pure helpers are exported so `bun test` proves every rule with no database; the
 * Neon store is lazy (same shape as `grants-subscription.server.ts`).
 */
import { sql } from "~/db";

// ── The owner's promise (verbatim intent, 2026-09-21) ─────────────────────────
/** The free tier's name. */
export const NONPROFIT_FREE_TIER_NAME = "Nonprofit Free";
/**
 * The landing promise (the owner's words, 2026-09-21).
 *
 * The STALENESS wording shown next to a verified badge is RESOLVED TOO (owner 09-21) —
 * both of the two former "open decisions" are CLOSED and this comment is not a proposal
 * any more. The owner's exact phrase is
 * `"Verified against IRS tax-exempt records updated [Month Year]"`, built by
 * `verificationWording()` below from the mirror's OWN posting date (never hand-typed),
 * which is why every verify path carries `irsRecordsAsOf` through to the UI instead of a
 * bare "verified" badge.
 */
export const NONPROFIT_FREE_PROMISE =
  "Government grant search—free for verified nonprofit organizations. No credit card required.";

// ── The verification-status wording (owner decision, RESOLVED 2026-09-21) ─────
/**
 * The owner's EXACT staleness phrase, as a template:
 *   "Verified against IRS tax-exempt records updated September 2026"
 * — i.e. "…records updated [Month Year]", where the month and the year are the POSTING
 * DATE of the IRS extract we actually mirrored (`getIrsRecordsAsOf()`, or
 * `entitlement.irsRecordsAsOf` on a single application).
 *
 * WHY IT IS A FUNCTION AND NOT A STRING. A hand-typed month drifts ahead of the data it
 * describes, and a stale "updated" claim on a verification badge is exactly the kind of
 * dishonesty this tier must not ship. The month/year can only ever come from the mirror.
 *
 * Phase 1 has no UI — this is the constant plus the tested function, so every later
 * surface renders the same sentence and none of them improvises its own wording.
 */
export const NONPROFIT_VERIFICATION_WORDING_TEMPLATE =
  "Verified against IRS tax-exempt records updated {Month Year}";
/** Month names as they appear in the owner's wording ("September"). */
export const NONPROFIT_MONTH_NAMES: readonly string[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
/** 1–12 → "September". Out of range → null (a month is never invented). */
export function monthNameOf(month: number): string | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return NONPROFIT_MONTH_NAMES[month - 1] ?? null;
}
/**
 * The owner's sentence for one month and year:
 * `verificationWording("September", 2026)` →
 * `"Verified against IRS tax-exempt records updated September 2026"`.
 */
export function verificationWording(monthName: string, year: number | string): string {
  return `Verified against IRS tax-exempt records updated ${monthName} ${year}`;
}
/**
 * The same sentence for an IRS mirror posting date ("2026-09-08", a timestamp, or a
 * `Date`). NULL when the date is missing or unparseable — a surface with no mirror date
 * shows NOTHING rather than a verification claim (the mirror-never-imported case: no
 * application may be auto-approved at all, so no page may date a verification either).
 */
export function verificationWordingForIrsRecordsAsOf(
  irsRecordsAsOf: string | Date | null | undefined,
): string | null {
  if (irsRecordsAsOf == null) return null;
  const iso = (irsRecordsAsOf instanceof Date ? irsRecordsAsOf.toISOString() : String(irsRecordsAsOf)).trim();
  const match = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?(?:[T ].*)?$/.exec(iso);
  if (!match) return null;
  const month = monthNameOf(Number(match[2]));
  if (!month) return null;
  return verificationWording(month, match[1]);
}
/** The paid upgrades are roadmap, NOT this build (owner spec item 4). */
export const NONPROFIT_PAID_UPGRADES: readonly string[] = [
  "AI grant matching and recommendations",
  "AI eligibility analysis",
  "AI summaries and application assistance",
  "Unlimited saves",
  "Instant / daily alerts",
  "Multiple team members",
  "Exports, reports and advanced filters",
  "Priority support",
];

// ── Status model ──────────────────────────────────────────────────────────────
/**
 * Application states. `manual_review` is a real state, not an error: every uncertain
 * case (EIN not in the BMF, a name mismatch, a revoked EIN, a non-01/02 STATUS)
 * lands there and NONE of them is ever an auto-reject (research §2.5).
 *
 * `denied` is the OWNER'S FRAUD LANE ONLY (spec item 3: "obvious fraud/conflicting
 * info → deny"). Every other non-approved outcome stays in `manual_review` — an
 * applicant is never auto-rejected because the record was unclear. (The owner's
 * taxonomy is denied = fraud, NOT "denied" as a general-purpose rejection.)
 *
 * `revoked` is the owner's right to revoke for misuse (spec item 5); it is never
 * written by an automated path.
 */
export const NONPROFIT_APPLICATION_STATUSES = [
  "pending",
  "approved",
  "manual_review",
  "denied",
  "revoked",
] as const;
export type NonprofitStatus = (typeof NONPROFIT_APPLICATION_STATUSES)[number];

/**
 * The owner's FOUR-CLASS reason taxonomy (spec item 3), emitted by the verification
 * engine on EVERY decision and stored on the application row so the admin queue filters
 * on one column: **clear-match** → auto-approve · **possible-match** → manual review ·
 * **no-match-request-docs** → manual review whose first action is a supporting-document
 * request · **fraud-likely** → deny.
 *
 * Mirrors the `reason_class` CHECK in migration 045 / src/db/schema.sql (a test asserts
 * the two lists are identical, so the queue can never see a class the DB rejects).
 */
export const NONPROFIT_REASON_CLASSES = [
  "clear-match",
  "possible-match",
  "no-match-request-docs",
  "fraud-likely",
] as const;
export type NonprofitReasonClass = (typeof NONPROFIT_REASON_CLASSES)[number];
export function isNonprofitReasonClass(value: unknown): value is NonprofitReasonClass {
  return typeof value === "string" && (NONPROFIT_REASON_CLASSES as readonly string[]).includes(value);
}

/** How a decision was reached: the IRS mirror, or a human exception. */
export const NONPROFIT_VERIFICATION_METHODS = ["irs_eo_bmf", "manual_exception"] as const;
export type NonprofitVerificationMethod = (typeof NONPROFIT_VERIFICATION_METHODS)[number];

/**
 * THE ONLY status that grants the free tier. Fail-closed on NULL/unknown.
 * `pending` gets limited access (below), `manual_review` keeps that limited access
 * while a human looks, `denied`/`revoked` get the anonymous default.
 */
export function isNonprofitStatusGranted(status: string | null | undefined): boolean {
  return status === "approved";
}

// ── Owner decision (a): which IRS subsections count as "verified nonprofit" ───
/**
 * **OWNER DECISION (a) — RESOLVED 2026-09-21: 501(c)(3) ORGANIZATIONS ONLY.**
 *
 * The BMF covers every 501(c)/(d) subsection; 1,642,105 of 1,964,958 rows are 501(c)(3),
 * the rest are 501(c)(4)/(6)/(8)/(19) etc., many of which are not "charities". In the
 * owner's words: "Start with verified 501(c)(3) organizations only. That matches what
 * most people understand by 'charitable nonprofit' … and avoids giving free access to
 * trade associations, lobbying organizations, and other tax-exempt entities that may have
 * substantial commercial budgets. You can broaden eligibility later using real demand."
 *
 * So the SHIPPED policy is `501c3_only`: the auto-approve lane requires `SUBSECTION='03'`
 * (on top of an active STATUS and no revocation match — see
 * nonprofit-verification.server.ts §2.5). A non-501(c)(3) record is NEVER auto-approved and
 * NEVER auto-rejected: it routes to MANUAL REVIEW with reason `subsection_not_501c3`, so a
 * human applies the owner's policy to a trade association instead of the engine deciding.
 *
 * `any_bmf_record` remains in the union for the later broadening the owner described, but
 * nothing ships it and no test may assert it as the live policy.
 */
export type NonprofitSubsectionPolicy = "any_bmf_record" | "501c3_only";
export const NONPROFIT_SUBSECTION_POLICY: NonprofitSubsectionPolicy = "501c3_only";
/** BMF `SUBSECTION` code for 501(c)(3) — 1,642,105 rows (research §1.a). */
export const NONPROFIT_501C3_SUBSECTION = "03";
/**
 * Human labels for the subsection codes the mirror can carry. Unknown codes fall back
 * to the raw code — never an invented label.
 */
export const NONPROFIT_SUBSECTION_LABELS: Readonly<Record<string, string>> = {
  "01": "Government instrumentality",
  "02": "Title-holding corporation",
  "03": "501(c)(3) charitable organization",
  "04": "501(c)(4) social welfare organization",
  "05": "501(c)(5) labor/agricultural organization",
  "06": "501(c)(6) business league",
  "07": "501(c)(7) social club",
  "08": "501(c)(8) fraternal beneficiary society",
  "09": "501(c)(9) voluntary employees' beneficiary association",
  "10": "501(c)(10) domestic fraternal society",
  "12": "501(c)(12) benevolent life insurance association",
  "13": "501(c)(13) cemetery company",
  "19": "501(c)(19) veterans' organization",
  "92": "4947(a)(1) nonexempt charitable trust",
};
export function subsectionLabel(subsection: string | null | undefined): string | null {
  if (!subsection) return null;
  return NONPROFIT_SUBSECTION_LABELS[subsection] ?? subsection;
}
/** True when this subsection satisfies the CURRENT policy (see the note above). */
export function isEligibleSubsection(
  subsection: string | null | undefined,
  policy: NonprofitSubsectionPolicy = NONPROFIT_SUBSECTION_POLICY,
): boolean {
  if (policy === "any_bmf_record") return true;
  return subsection === NONPROFIT_501C3_SUBSECTION;
}

// ── Save promise (owner spec item 4) ─────────────────────────────────────────
/** "save up to 10 grants" — the cap the later phase enforces on every save route. */
export const NONPROFIT_SAVE_LIMIT = 10;
/** "one user" — the free tier is a single seat. */
export const NONPROFIT_TEAM_MEMBERS = 1;

// ── Annual reverify (owner spec item 5) ──────────────────────────────────────
/** Reverify annually, as the owner specified. */
export const NONPROFIT_REVERIFY_WINDOW_DAYS = 365;
export function computeReverifyDueAt(grantedAt: string | Date): string {
  const base = grantedAt instanceof Date ? grantedAt : new Date(grantedAt);
  const due = new Date(base.getTime());
  due.setUTCDate(due.getUTCDate() + NONPROFIT_REVERIFY_WINDOW_DAYS);
  return due.toISOString();
}

// ── The stored row (shape of nonprofit_applications, migration 045) ───────────
export interface NonprofitApplicationRow {
  user_id: number | null;
  org_name?: string | null;
  work_email?: string | null;
  ein?: string | null;
  state?: string | null;
  status: string | null;
  verification_method?: string | null;
  bmf_subsection?: string | null;
  bmf_status?: string | null;
  bmf_posting_date?: string | Date | null;
  granted_at?: string | Date | null;
  reverify_due_at?: string | Date | null;
  reviewed_at?: string | Date | null;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
}

export interface NonprofitEntitlement {
  /** The ONLY thing an access gate may test. */
  verified: boolean;
  status: NonprofitStatus | null;
  method: NonprofitVerificationMethod | null;
  /** ISO string, or null when never granted. */
  reverifyDueAt: string | null;
  /**
   * True once the annual reverify window has passed. This RAISES A REVIEW TASK — it
   * never removes access: the owner's structural promise is that basic searching stays
   * free indefinitely for a verified nonprofit (spec §"CRITICAL RULE"). A gate that
   * treated this as an access cut would break the promise, so no caller may gate on it.
   */
  reverifyDue: boolean;
  subsection: string | null;
  subsectionLabel: string | null;
  /** Whether the CURRENT subsection policy admits this org's subsection. */
  subsectionEligible: boolean;
  irsRecordsAsOf: string | null;
  /**
   * The owner's exact staleness sentence for a verified org — "Verified against IRS
   * tax-exempt records updated September 2026" — derived from `irsRecordsAsOf`. NULL when
   * the org is not verified or the mirror has no posting date, so a surface has nothing to
   * render rather than a claim it cannot support.
   */
  verificationWording: string | null;
}

export const NO_NONPROFIT_ENTITLEMENT: NonprofitEntitlement = {
  verified: false,
  status: null,
  method: null,
  reverifyDueAt: null,
  reverifyDue: false,
  subsection: null,
  subsectionLabel: null,
  subsectionEligible: false,
  irsRecordsAsOf: null,
  verificationWording: null,
};

function isoOrNull(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Normalize a stored application (or its absence) into the entitlement every caller
 * gates on. Pure — the `now` argument is injectable so the annual-reverify rule is
 * testable without waiting a year.
 */
export function evaluateNonprofitEntitlement(
  application: NonprofitApplicationRow | null | undefined,
  now: Date = new Date(),
): NonprofitEntitlement {
  if (!application) return NO_NONPROFIT_ENTITLEMENT;
  const status = (application.status ?? null) as NonprofitStatus | null;
  const verified = isNonprofitStatusGranted(status);
  const reverifyDueAt = isoOrNull(application.reverify_due_at);
  const subsection = application.bmf_subsection ?? null;
  const method = (application.verification_method ?? null) as NonprofitVerificationMethod | null;
  const irsRecordsAsOf = verified ? isoOrNull(application.bmf_posting_date) : null;
  return {
    verified,
    status,
    method: method && (NONPROFIT_VERIFICATION_METHODS as readonly string[]).includes(method) ? method : null,
    reverifyDueAt,
    reverifyDue: reverifyDueAt != null && now.getTime() >= new Date(reverifyDueAt).getTime(),
    subsection,
    subsectionLabel: subsectionLabel(subsection),
    subsectionEligible: verified ? isEligibleSubsection(subsection) : false,
    irsRecordsAsOf,
    // The owner's exact wording, from the mirror's own posting date — never a literal.
    verificationWording: verificationWordingForIrsRecordsAsOf(irsRecordsAsOf),
  };
}

// ── The search policy (the owner's spec item 2, tier by tier) ────────────────
export type NonprofitSearchTier = "nonprofit_free" | "nonprofit_pending" | "anonymous";

export interface NonprofitSearchPolicy {
  tier: NonprofitSearchTier;
  /** Federal /grants: searches allowed per rolling day. */
  searchesPerDay: number | "unlimited";
  /** How many results come back per search (rows in the response, preview rows included). */
  previewLimit: number | "unlimited";
  /**
   * RESULTS per rolling day that may be returned with FULL DETAIL — untruncated
   * description, eligibility requirements, award amounts, deadlines.
   *
   * SEPARATE FROM `searchesPerDay` ON PURPOSE: the owner's pending tier is "3 grant
   * searches/day · full details for five results per day", so three searches can unlock
   * five full rows IN TOTAL, not five per search. A gate that only knew `previewLimit`
   * could not express that; `nonprofitFullDetailAllowance()` below is the one place the
   * two numbers are combined.
   */
  fullDetailsPerDay: number | "unlimited";
  /** Paging past the first page. */
  pagination: boolean;
  /** Untruncated grant descriptions ON a full-detail row. */
  fullDescriptions: boolean;
  /** Eligibility requirements, award amounts, deadlines — ON a full-detail row. */
  eligibilityDetail: boolean;
  /** Direct links to the official application (every tier gets these). */
  officialLinks: boolean;
  /**
   * The owner's "basic filters" (spec item 2, verified tier). ADVANCED filters, exports
   * and reports are NOT here — they are in NONPROFIT_PAID_UPGRADES.
   */
  basicFilters: boolean;
  canSave: boolean;
  saveLimit: number;
  /** State-grant results, for the jurisdictions Contrax actually covers. */
  includesStateGrants: boolean;
  /** The one weekly deadline email. */
  weeklyDeadlineEmail: boolean;
  teamMembers: number;
  creditCardRequired: boolean;
  /** Always false: the AI upgrades are roadmap, not this build. */
  includesPaidUpgrades: false;
  /** The product surfaces this policy opens. Radar is NOT among them (spec item 1). */
  surfaces: readonly string[];
}

/**
 * Verified nonprofit: the owner's item-4 list, exactly — unlimited searches, full
 * descriptions, eligibility requirements, award amounts and deadlines, direct official
 * application links, federal AND covered state-grant results, basic filters, up to 10
 * saves, one weekly deadline email, one user, no credit card.
 *
 * "Unlimited" here means unlimited BY THIS TIER. The existing per-IP / per-account
 * abuse backstops (`grants_search_ip`, `grants_search_user` in
 * `grants-limits.server.ts`) still apply to everyone — that is abuse control, not a
 * paywall, and the free tier is never gated by a payment or a credit card.
 */
export const NONPROFIT_FREE_SEARCH_POLICY: NonprofitSearchPolicy = {
  tier: "nonprofit_free",
  searchesPerDay: "unlimited",
  previewLimit: "unlimited",
  fullDetailsPerDay: "unlimited",
  pagination: true,
  fullDescriptions: true,
  eligibilityDetail: true,
  officialLinks: true,
  // Owner spec item 2, verified tier: "basic filters". Advanced filters/exports/reports
  // stay in the paid upgrades (NONPROFIT_PAID_UPGRADES above).
  basicFilters: true,
  canSave: true,
  saveLimit: NONPROFIT_SAVE_LIMIT,
  includesStateGrants: true,
  weeklyDeadlineEmail: true,
  teamMembers: NONPROFIT_TEAM_MEMBERS,
  creditCardRequired: false,
  includesPaidUpgrades: false,
  // Owner spec item 1: the free nonprofit tier is Contrax Grants access only, no Radar.
  // NOTE (deliberate): this entitlement never REMOVES a capability the account already
  // has from its own plan — it only grants the grants-side free access. See the phase-2
  // note in the report about whether signup should offer a Radar-less nonprofit plan.
  surfaces: ["grants", "state-grants"],
};

/**
 * Application submitted, verification not finished (pending or manual_review) — the
 * owner's numbers VERBATIM (spec item 2): **3 grant searches/day · full details for 5
 * results/day · official application links · no saved grants or alerts yet.**
 *
 * The three numbers are independent, which is why they are three fields:
 *   searchesPerDay 3    — how many /grants searches the day allows;
 *   fullDetailsPerDay 5 — how many RESULTS may be full detail across those searches
 *                         (three searches can unlock five full rows in total);
 *   previewLimit 5      — how many rows a single response may carry. Rows beyond the
 *                         day's full-detail budget are truncated previews, the same
 *                         shape an anonymous visitor already sees — never more data.
 * `pagination: false` (no paging past the first page), no saves, no email digest.
 */
export const NONPROFIT_PENDING_SEARCH_POLICY: NonprofitSearchPolicy = {
  tier: "nonprofit_pending",
  searchesPerDay: 3,
  previewLimit: 5,
  fullDetailsPerDay: 5,
  pagination: false,
  fullDescriptions: true,
  eligibilityDetail: true,
  officialLinks: true,
  // Basic filters belong to the VERIFIED tier in the owner's list, not to pending.
  basicFilters: false,
  canSave: false,
  saveLimit: 0,
  includesStateGrants: true,
  weeklyDeadlineEmail: false,
  teamMembers: NONPROFIT_TEAM_MEMBERS,
  creditCardRequired: false,
  includesPaidUpgrades: false,
  surfaces: ["grants", "state-grants"],
};

/**
 * Nobody, or a denied/revoked application: today's anonymous behaviour, unchanged.
 * `PREVIEW_LIMIT`/the 1-search day in `grants-limits.server.ts` remain the source of
 * truth for the numbers — this object only names them so a caller has one place to look.
 * `fullDetailsPerDay: 0` is that same fact made explicit: an anonymous visitor never gets
 * a full-detail row (nothing to unlock, and no card to unlock it with).
 */
export const NONPROFIT_ANONYMOUS_SEARCH_POLICY: NonprofitSearchPolicy = {
  tier: "anonymous",
  searchesPerDay: 1,
  previewLimit: 3,
  fullDetailsPerDay: 0,
  pagination: false,
  fullDescriptions: false,
  eligibilityDetail: false,
  officialLinks: true,
  basicFilters: false,
  canSave: false,
  saveLimit: 0,
  includesStateGrants: true,
  weeklyDeadlineEmail: false,
  teamMembers: NONPROFIT_TEAM_MEMBERS,
  creditCardRequired: false,
  includesPaidUpgrades: false,
  surfaces: ["grants", "state-grants"],
};

/**
 * The ONE function a search gate calls. Pure: it reads the entitlement and nothing else.
 *
 * `manual_review` deliberately returns the PENDING policy, not `anonymous`: the owner's
 * rule is that an uncertain application must not be treated as a non-applicant while a
 * human looks at it (and it must never silently look like a rejection).
 */
export function nonprofitSearchPolicy(entitlement: NonprofitEntitlement): NonprofitSearchPolicy {
  if (entitlement.verified) return NONPROFIT_FREE_SEARCH_POLICY;
  if (entitlement.status === "pending" || entitlement.status === "manual_review") {
    return NONPROFIT_PENDING_SEARCH_POLICY;
  }
  return NONPROFIT_ANONYMOUS_SEARCH_POLICY;
}

// ── The two independent allowances (owner spec item 2) ───────────────────────
/**
 * How many searches the rolling day still allows. Pure, so the phase-3 gate cannot
 * re-implement the count differently from the tests.
 */
export interface NonprofitSearchAllowance {
  allowed: boolean;
  /** Searches left today. `Infinity` for the verified tier (no paywall; abuse backstops apply separately). */
  remaining: number;
}
export function nonprofitSearchAllowance(
  policy: NonprofitSearchPolicy,
  searchesUsedToday: number,
): NonprofitSearchAllowance {
  if (policy.searchesPerDay === "unlimited") return { allowed: true, remaining: Infinity };
  const used = Number.isFinite(searchesUsedToday) ? Math.max(0, searchesUsedToday) : 0;
  const remaining = Math.max(0, policy.searchesPerDay - used);
  return { allowed: remaining > 0, remaining };
}

/**
 * How the RESULTS of the next search may be presented, once the day's full-detail budget
 * is known. This is the pair the owner's pending tier needs: 3 searches/day AND full
 * details for 5 results/day — so `canUnlock` runs out after five FULL rows even though
 * searches remain.
 */
export interface NonprofitFullDetailAllowance {
  /** Full-detail rows still available today. `Infinity` for the verified tier. */
  remaining: number;
  /** True while at least one more result may be returned with full detail. */
  canUnlock: boolean;
  /** What happens to a result once the budget is gone (never silently full detail). */
  fallback: "truncated_preview" | "not_returned";
}
export function nonprofitFullDetailAllowance(
  policy: NonprofitSearchPolicy,
  fullDetailResultsUsedToday: number,
): NonprofitFullDetailAllowance {
  const fallback: NonprofitFullDetailAllowance["fallback"] =
    policy.previewLimit === 0 ? "not_returned" : "truncated_preview";
  if (policy.fullDetailsPerDay === "unlimited") {
    return { remaining: Infinity, canUnlock: true, fallback };
  }
  const used = Number.isFinite(fullDetailResultsUsedToday)
    ? Math.max(0, fullDetailResultsUsedToday)
    : 0;
  const remaining = Math.max(0, policy.fullDetailsPerDay - used);
  return { remaining, canUnlock: remaining > 0, fallback };
}

// ── ONE FREE ORG ACCOUNT PER EIN (owner spec item 6) ─────────────────────────
/**
 * The apply-time half of "one free org account per EIN": an EIN belongs to an
 * ORGANIZATION, so a second account claiming the same EIN must be DEFLECTED — with a
 * clear message and a route back to the account that holds it — never silently allowed a
 * second free organisation. The database enforces the same rule
 * (`nonprofit_applications_ein_key`, UNIQUE on `ein`); this check exists so the applicant
 * sees why, instead of a raw constraint error.
 *
 * The SAME user re-applying (or correcting) its own application is not a claim: it
 * updates the existing row, which is what keeps the audit trail from forking.
 */
export type NonprofitEinClaimOutcome =
  | "available"
  | "reapply_same_user"
  | "ein_already_claimed";
export interface NonprofitEinClaimDecision {
  allowed: boolean;
  outcome: NonprofitEinClaimOutcome;
  /** Applicant-facing explanation, or null when the claim is available. */
  message: string | null;
  /** The account that already holds the EIN (audit/reviewer record only — never shown to the applicant). */
  heldByUserId: number | null;
}
export const NONPROFIT_EIN_CLAIMED_MESSAGE =
  "An account already exists for this EIN. Each organization gets one free Nonprofit Free account — " +
  "sign in to that account, or contact us if the EIN was entered by mistake.";
export function evaluateNonprofitEinClaim(input: {
  userId: number | null | undefined;
  existing: { user_id: number | null; status: string | null } | null | undefined;
}): NonprofitEinClaimDecision {
  const existing = input.existing ?? null;
  if (!existing) {
    return { allowed: true, outcome: "available", message: null, heldByUserId: null };
  }
  if (existing.user_id != null && input.userId != null && existing.user_id === input.userId) {
    return { allowed: true, outcome: "reapply_same_user", message: null, heldByUserId: existing.user_id };
  }
  return {
    allowed: false,
    outcome: "ein_already_claimed",
    message: NONPROFIT_EIN_CLAIMED_MESSAGE,
    heldByUserId: existing.user_id ?? null,
  };
}

// ── Read side (Neon; never a live call to irs.gov) ───────────────────────────
/** The user's application row, or null. One row per user (UNIQUE user_id). */
export async function getNonprofitApplication(
  userId: number | null | undefined,
): Promise<NonprofitApplicationRow | null> {
  if (userId == null) return null;
  const rows = (await sql()`
    SELECT user_id, org_name, work_email, ein, state, status, verification_method,
           bmf_subsection, bmf_status, bmf_posting_date, granted_at, reverify_due_at,
           reviewed_at, created_at, updated_at
    FROM nonprofit_applications
    WHERE user_id = ${userId}
    LIMIT 1
  `) as NonprofitApplicationRow[];
  return rows[0] ?? null;
}

/**
 * The application that already holds an EIN, or null. This is the read behind the
 * one-free-org-account-per-EIN rule (owner spec item 6) — the apply route calls
 * `evaluateNonprofitEinClaim` with its result BEFORE writing a new row, and the UNIQUE
 * index on `ein` is the backstop if a future code path forgets to.
 */
export async function getNonprofitApplicationByEin(
  ein: string | null | undefined,
): Promise<{ user_id: number | null; status: string | null; org_name?: string | null } | null> {
  if (!ein) return null;
  const rows = (await sql()`
    SELECT user_id, status, org_name
    FROM nonprofit_applications
    WHERE ein = ${ein}
    LIMIT 1
  `) as { user_id: number | null; status: string | null; org_name: string | null }[];
  return rows[0] ?? null;
}

/** The entitlement for a signed-in user. No user, no row → the no-access state. */
export async function getNonprofitEntitlement(
  userId: number | null | undefined,
  now: Date = new Date(),
): Promise<NonprofitEntitlement> {
  if (userId == null) return NO_NONPROFIT_ENTITLEMENT;
  return evaluateNonprofitEntitlement(await getNonprofitApplication(userId), now);
}

/**
 * The most recent COMPLETE BMF mirror run's posting date — the value behind the owner's
 * exact wording "Verified against IRS tax-exempt records updated [Month Year]" (pass it
 * through `verificationWordingForIrsRecordsAsOf`) and the admin queue's audit line.
 * NULL means the mirror has never been imported — in which case no application may be
 * auto-approved at all (the verification engine fails closed on an empty mirror), and no
 * surface may claim a verification date.
 */
export async function getIrsRecordsAsOf(): Promise<string | null> {
  const rows = (await sql()`
    SELECT posting_date
    FROM irs_mirror_runs
    WHERE source = 'eo_bmf' AND status = 'ok' AND mode = 'import'
    ORDER BY finished_at DESC NULLS LAST, started_at DESC
    LIMIT 1
  `) as { posting_date: string | Date | null }[];
  return isoOrNull(rows[0]?.posting_date ?? null);
}
