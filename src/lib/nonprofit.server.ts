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
 * The landing promise. The staleness wording is the SECOND of the two owner decisions
 * still open (research §4/§7): the proposal is "verified against IRS records as of
 * <monthly posting date>", which is why every verify path carries `irsRecordsAsOf`
 * through to the UI instead of a bare "verified" badge.
 */
export const NONPROFIT_FREE_PROMISE =
  "Government grant search—free for verified nonprofit organizations. No credit card required.";
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
 * `revoked` is the owner's right to revoke for misuse (spec item 5); it is never
 * written by an automated path.
 */
export const NONPROFIT_APPLICATION_STATUSES = [
  "pending",
  "approved",
  "manual_review",
  "rejected",
  "revoked",
] as const;
export type NonprofitStatus = (typeof NONPROFIT_APPLICATION_STATUSES)[number];

/** How a decision was reached: the IRS mirror, or a human exception. */
export const NONPROFIT_VERIFICATION_METHODS = ["irs_eo_bmf", "manual_exception"] as const;
export type NonprofitVerificationMethod = (typeof NONPROFIT_VERIFICATION_METHODS)[number];

/**
 * THE ONLY status that grants the free tier. Fail-closed on NULL/unknown.
 * `pending` gets limited access (below), `manual_review` keeps that limited access
 * while a human looks, `rejected`/`revoked` get the anonymous default.
 */
export function isNonprofitStatusGranted(status: string | null | undefined): boolean {
  return status === "approved";
}

// ── Owner decision (a): which IRS subsections count as "verified nonprofit" ───
/**
 * **PENDING OWNER DECISION (a)** — research §4 item 9 / §7. The BMF covers every
 * 501(c)/(d) subsection; 1,642,105 of 1,964,958 rows are 501(c)(3), the rest are
 * 501(c)(4)/(6)/(8)/(19) etc., many of which are not "charities".
 *
 * The shipped default is the research's recommendation: `any_bmf_record` — auto-approve
 * any BMF record whose STATUS is 01/02 and which is not revoked, LABEL the subsection
 * and flag `subsection_not_501c3` so the review queue can see it. If the owner answers
 * "501(c)(3) only", flipping this one constant makes the verification engine route
 * non-501(c)(3) applications to manual review instead of auto-approving them — one
 * line of policy, no extra data, no schema change.
 */
export type NonprofitSubsectionPolicy = "any_bmf_record" | "501c3_only";
export const NONPROFIT_SUBSECTION_POLICY: NonprofitSubsectionPolicy = "any_bmf_record";
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
  return {
    verified,
    status,
    method: method && (NONPROFIT_VERIFICATION_METHODS as readonly string[]).includes(method) ? method : null,
    reverifyDueAt,
    reverifyDue: reverifyDueAt != null && now.getTime() >= new Date(reverifyDueAt).getTime(),
    subsection,
    subsectionLabel: subsectionLabel(subsection),
    subsectionEligible: verified ? isEligibleSubsection(subsection) : false,
    irsRecordsAsOf: verified ? isoOrNull(application.bmf_posting_date) : null,
  };
}

// ── The search policy (the owner's item 4, tier by tier) ─────────────────────
export type NonprofitSearchTier = "nonprofit_free" | "nonprofit_pending" | "anonymous";

export interface NonprofitSearchPolicy {
  tier: NonprofitSearchTier;
  /** Federal /grants: searches allowed per rolling day. */
  searchesPerDay: number | "unlimited";
  /** How many results come back unlocked (the anonymous preview cap is 3). */
  previewLimit: number | "unlimited";
  /** Paging past the first page. */
  pagination: boolean;
  /** Untruncated grant descriptions (the anonymous path hard-caps at 400 chars). */
  fullDescriptions: boolean;
  /** Eligibility requirements, award amounts, deadlines. */
  eligibilityDetail: boolean;
  /** Direct links to the official application. */
  officialLinks: boolean;
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
  pagination: true,
  fullDescriptions: true,
  eligibilityDetail: true,
  officialLinks: true,
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
 * Application submitted, verification not finished (pending or manual_review):
 * "Limited searches while verification pending" (owner spec item 2). The counts below
 * are the team's reading of "limited" — more than an anonymous visitor, nowhere near
 * the verified tier — and are the one number in this file the owner may want to set.
 */
export const NONPROFIT_PENDING_SEARCH_POLICY: NonprofitSearchPolicy = {
  tier: "nonprofit_pending",
  searchesPerDay: 3,
  previewLimit: 3,
  pagination: false,
  fullDescriptions: false,
  eligibilityDetail: false,
  officialLinks: true,
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
 * Nobody, or a rejected/revoked application: today's anonymous behaviour, unchanged.
 * `PREVIEW_LIMIT`/the 1-search day in `grants-limits.server.ts` remain the source of
 * truth for the numbers — this object only names them so a caller has one place to look.
 */
export const NONPROFIT_ANONYMOUS_SEARCH_POLICY: NonprofitSearchPolicy = {
  tier: "anonymous",
  searchesPerDay: 1,
  previewLimit: 3,
  pagination: false,
  fullDescriptions: false,
  eligibilityDetail: false,
  officialLinks: true,
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

/** The entitlement for a signed-in user. No user, no row → the no-access state. */
export async function getNonprofitEntitlement(
  userId: number | null | undefined,
  now: Date = new Date(),
): Promise<NonprofitEntitlement> {
  if (userId == null) return NO_NONPROFIT_ENTITLEMENT;
  return evaluateNonprofitEntitlement(await getNonprofitApplication(userId), now);
}

/**
 * The honest "IRS records as of <date>" label for the UI and the admin queue: the most
 * recent COMPLETE BMF mirror run's posting date. NULL means the mirror has never been
 * imported — in which case no application may be auto-approved at all (the verification
 * engine fails closed on an empty mirror), and no surface may claim a verification date.
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
