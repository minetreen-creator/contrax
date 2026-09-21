/**
 * Nonprofit Free — the applicant-facing copy, in ONE place.
 *
 * The build plan (§6) is explicit: every applicant-facing string for this tier is
 * produced by this module and consumed by every surface, so no page improvises its own
 * wording and no string can drift away from the data behind it. The two rules that
 * matter most, both owner-imposed:
 *
 *   1. **The permanent promise is not a marketing claim — it is a structural one.** Basic
 *      searching stays free indefinitely for a verified nonprofit: never a promo, never
 *      time-limited, never a dollar figure, no countdown, no scarcity. `FORBIDDEN_
 *      NONPROFIT_PHRASES` / `FORBIDDEN_NONPROFIT_PATTERNS` below are the machine-readable
 *      form of that rule and the test suite scans every surface with them.
 *   2. **The verification wording is built from the mirror's own posting date**, never
 *      hand-typed (`verificationWording`). When the mirror has no posting date the
 *      builder returns `null` and the surface renders nothing — a badge with no date is
 *      never shown.
 *
 * This module is deliberately client-safe (no `@tanstack/react-start/server`, no
 * database access at module scope): the apply and status pages import it directly.
 */
// ── CLIENT-SAFE DEFINITIONS (no `*.server` import — see the header above) ──────
// This module is bundled into client routes (/nonprofit/apply, /nonprofit/status and the
// /grants CTA). The framework's import protection FAILS THE BUILD if a `*.server` module is
// reachable from a client bundle, so these strings and helpers are defined HERE rather than
// imported from `nonprofit.server.ts`. They are the same values: a unit test asserts the copy
// module and the server module agree, so a page can never state something the API does not.
export const NONPROFIT_FREE_PROMISE = "Government grant search—free for verified nonprofit organizations. No credit card required.";
export const NONPROFIT_FREE_TIER_NAME = "Nonprofit Free";
export const NONPROFIT_APPLICATION_STATUSES = [
  "pending",
  "approved",
  "manual_review",
  "denied",
  "revoked",
] as const;
export type NonprofitStatus = (typeof NONPROFIT_APPLICATION_STATUSES)[number];

/** Calendar month names, used only to render the owner's wording sentence. */
export const NONPROFIT_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** The month name of a mirror posting date, or null when there is no usable date. */
export function monthNameOf(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : NONPROFIT_MONTH_NAMES[value.getUTCMonth()];
  }
  const match = /^(\d{4})-(\d{2})/.exec(String(value).trim());
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return NONPROFIT_MONTH_NAMES[month - 1];
}

/** The owner's exact sentence, as a template a test can assert on. */
export const NONPROFIT_VERIFICATION_WORDING_TEMPLATE =
  "Verified against IRS tax-exempt records updated {Month Year}";

/**
 * "Verified against IRS tax-exempt records updated September 2026" — built from the IRS
 * mirror's POSTING date, or null when there is no usable date (in which case nothing is
 * rendered: a verification badge with no date is never shown).
 */
export function verificationWordingForIrsRecordsAsOf(
  value: string | Date | null | undefined,
): string | null {
  const month = monthNameOf(value);
  const year = typeof value === "string" ? /^(\d{4})/.exec(value.trim())?.[1] : undefined;
  const resolvedYear =
    year ?? (value instanceof Date && !Number.isNaN(value.getTime()) ? String(value.getUTCFullYear()) : null);
  if (!month || !resolvedYear) return null;
  return `Verified against IRS tax-exempt records updated ${month} ${resolvedYear}`;
}

/** The owner's promise, reused verbatim (never re-typed by a surface). */
export const NONPROFIT_PROMISE = NONPROFIT_FREE_PROMISE;

/** Where an applicant writes when something looks wrong (the appeal path). */
export const NONPROFIT_APPEAL_EMAIL = "hello@contrax.company";
/** The mailbox as a sentence fragment, so no surface hand-builds a mailto. */
export const NONPROFIT_APPEAL_PATH = `write to ${NONPROFIT_APPEAL_EMAIL}`;

// ── The verification wording (owner's exact sentence, from the mirror's date) ──
/**
 * `verificationWording("2026-09-08")` →
 * `"Verified against IRS tax-exempt records updated September 2026"`.
 *
 * `null` when the posting date is missing or unparseable — the caller renders NOTHING
 * rather than a verification claim it cannot support (see nonprofit.server.ts).
 */
export function verificationWording(
  irsRecordsAsOf: string | Date | null | undefined,
): string | null {
  return verificationWordingForIrsRecordsAsOf(irsRecordsAsOf);
}
/**
 * The badge line for a verified org's surface: the wording, or null when unknown.
 * `verified` is taken from the entitlement, never re-derived from a status string here.
 */
export function nonprofitVerificationBadge(entitlement: {
  verified: boolean;
  irsRecordsAsOf: string | Date | null | undefined;
}): string | null {
  if (!entitlement.verified) return null;
  return verificationWording(entitlement.irsRecordsAsOf);
}

// ── Same-site return paths (the `?next=` guard) ───────────────────────────────
/**
 * A same-site absolute return path, or null when the value must not be honoured.
 *
 * WHY THIS IS A FUNCTION AND NOT A REGEX AT THE CALL SITE (QA finding §1.30). The apply
 * page honours `?next=` by handing it to `window.location.assign()` after a successful
 * submit. The original inline pattern `/^\/[A-Za-z0-9\-_/.]*$/` also matches `//evil.com`,
 * which a browser reads as PROTOCOL-RELATIVE — so `?next=%2F%2Fevil.com` sent a successful
 * applicant to an external host (an open redirect). A leading `//` is therefore refused
 * explicitly, and so is a backslash anywhere (browsers normalise `\` to `/`, so `/\evil.com`
 * is the same attack). Anything that is not a plain absolute path — a scheme, a host, a
 * query string, whitespace — is refused by the character class.
 */
export function safeNonprofitReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate.startsWith("/")) return null;
  if (candidate.startsWith("//") || candidate.includes("\\")) return null;
  return /^\/[A-Za-z0-9\-_/.]*$/.test(candidate) ? candidate : null;
}

// ── Apply page copy ───────────────────────────────────────────────────────────
export const NONPROFIT_APPLY_HEADLINE = "Apply for Nonprofit Free";
export const NONPROFIT_APPLY_INTRO = NONPROFIT_FREE_PROMISE;
export const NONPROFIT_APPLY_ELIGIBILITY: readonly string[] = [
  "501(c)(3) charitable organizations, verified against IRS tax-exempt records.",
  "One free organization account per EIN.",
  "No credit card — there is no payment step for nonprofit access.",
  "One organizational user, who is authorized to act for the organization.",
];
/** The honest manual path (never framed as a rejection). */
export const NONPROFIT_APPLY_MANUAL_PATH =
  "Churches, government entities, fiscal-sponsorship projects, newly approved organizations " +
  "and recently reinstated organizations are not always in the IRS records. Those applications " +
  "go to a person for review, and we will tell you if we need a document from you.";
export const NONPROFIT_APPLY_REVIEW_WINDOW =
  "We review every application within 3 business days.";
export const NONPROFIT_APPLY_SUBMIT_LABEL = "Submit application";
export const NONPROFIT_APPLY_SIGNED_OUT_COPY =
  "Sign in or create a free account first — the application is attached to your account, and " +
  "your verification status is shown there.";
export const NONPROFIT_APPLY_SIGNED_OUT_SIGNUP_LABEL = "Create free account";
export const NONPROFIT_APPLY_SIGNED_OUT_LOGIN_LABEL = "Sign in";

/**
 * The form's field labels and its per-field 400 messages. The apply API returns one of
 * these per invalid field and writes NOTHING (build plan §1: a malformed field is form
 * validation, never a decision and never a row).
 */
export const NONPROFIT_APPLY_FIELDS: Readonly<Record<string, string>> = {
  orgName: "Legal organization name",
  ein: "EIN",
  workEmail: "Work email",
  website: "Website (optional)",
  state: "State",
  contactName: "Your name",
  contactRole: "Your role",
  orgUseConfirmed: "Authorization",
};
export const NONPROFIT_APPLY_VALIDATION: Readonly<Record<string, string>> = {
  orgName: "Enter your organization's legal name.",
  ein: "Enter the organization's 9-digit EIN.",
  workEmail: "Enter a valid work email address.",
  website: "Enter a website address like https://example.org, or leave it blank.",
  state: "Choose the state your organization is based in.",
  contactName: "Enter your name.",
  contactRole: "Enter your role at the organization.",
  orgUseConfirmed: "Please confirm you're authorized to act for this organization.",
};
/** The authorization tick, in the applicant's own words. */
export const NONPROFIT_APPLY_AUTHORIZATION_LABEL =
  "I'm authorized to act for this organization, and I understand each organization gets one " +
  "free account.";

/** The submitted confirmation, shared by the form and the API response. */
export function nonprofitSubmittedCopy(status: NonprofitStatus): string {
  switch (status) {
    case "approved":
      return "You're verified. Free grant search is active on your account.";
    case "manual_review":
      return `Application received — a person is looking at it. ${NONPROFIT_APPLY_REVIEW_WINDOW}`;
    case "denied":
      return NONPROFIT_NOT_GRANTED_COPY;
    case "revoked":
      return NONPROFIT_SUSPENDED_COPY;
    case "pending":
    default:
      return `Application received. ${NONPROFIT_APPLY_REVIEW_WINDOW}`;
  }
}

// ── Status page copy ──────────────────────────────────────────────────────────
export const NONPROFIT_STATUS_HEADLINE = "Your Nonprofit Free status";
export const NONPROFIT_STATUS_NONE_COPY =
  "This account has not applied for Nonprofit Free access yet.";
export const NONPROFIT_STATUS_APPLY_LINK_LABEL = "Apply for Nonprofit Free";
/**
 * The link label for a surface that is ALREADY linked to the status page (QA finding §1.31):
 * the apply page's "you already have an application" panel used
 * `NONPROFIT_STATUS_APPLY_LINK_LABEL` while pointing at /nonprofit/status, so the applicant
 * was invited to "Apply for Nonprofit Free →" on the page where they were applying.
 */
export const NONPROFIT_STATUS_PAGE_LINK_LABEL = "View your application status";
export const NONPROFIT_STATUS_APPROVED_DETAIL =
  "Free grant search is active on this account. Basic searching stays free for a verified " +
  "nonprofit — there is no end date and nothing to renew.";
export const NONPROFIT_STATUS_MANUAL_DETAIL =
  `A person is reviewing the application. ${NONPROFIT_APPLY_REVIEW_WINDOW}` +
  " If the IRS records do not cover your organization, we may ask for a supporting document.";
export const NONPROFIT_STATUS_DOCS_REQUESTED_DETAIL =
  "We need a supporting document to finish the review. Reply to the email you received, or " +
  `${NONPROFIT_APPEAL_PATH} and we will help.`;
/** Neutral, non-accusatory, appealable (build plan §6). */
export const NONPROFIT_NOT_GRANTED_COPY =
  "We couldn't verify this application against IRS tax-exempt records, so free nonprofit " +
  `access wasn't granted. If you believe this is a mistake, ${NONPROFIT_APPEAL_PATH} and ` +
  "we'll take another look.";
/** The owner's lock: a status change suspends the entitlement and opens a review case. */
export const NONPROFIT_SUSPENDED_COPY =
  "Free nonprofit access is paused while the organization's IRS tax-exempt status is reviewed. " +
  "Nothing has been deleted — this account and its saved grants are intact, and you can write " +
  `to ${NONPROFIT_APPEAL_EMAIL} with any information we should see.`;

export interface NonprofitStatusCopy {
  label: string;
  detail: string;
}
export const NONPROFIT_STATUS_COPY: Readonly<Record<NonprofitStatus, NonprofitStatusCopy>> = {
  pending: {
    label: "Application received",
    detail: `We review every application within 3 business days.`,
  },
  manual_review: {
    label: "In review",
    detail: NONPROFIT_STATUS_MANUAL_DETAIL,
  },
  approved: {
    label: "Verified",
    detail: NONPROFIT_STATUS_APPROVED_DETAIL,
  },
  denied: {
    // The label deliberately avoids "rejected"/"invalid" (build plan §6).
    label: "Not granted",
    detail: NONPROFIT_NOT_GRANTED_COPY,
  },
  revoked: {
    label: "Paused pending review",
    detail: NONPROFIT_SUSPENDED_COPY,
  },
};
/** Every status has copy — a new status can never render an empty page. */
export function statusCopyFor(status: string | null | undefined): NonprofitStatusCopy | null {
  if (!status) return null;
  return (
    NONPROFIT_STATUS_COPY[status as NonprofitStatus] ??
    null
  );
}

// ── Pending-tier counters (owner's numbers, never pressure) ───────────────────
/**
 * The pending tier's promise, verbatim from the owner's spec item 2 — kept here so the
 * `/grants` banner and the status page cannot state different numbers.
 */
export const NONPROFIT_PENDING_LIMITS_COPY =
  "You have 3 grant searches a day, with full details for 5 results a day. Official " +
  "application links are always included. Saved grants and the weekly deadline email are " +
  "part of verified access.";
/** "2 of 3 searches left today" — an honest count, never a nudge. */
export function nonprofitSearchesRemainingCopy(remaining: number): string {
  return `${remaining} of 3 searches left today`;
}
/** "3 of 5 full results left today". */
export function nonprofitFullDetailsRemainingCopy(remaining: number): string {
  return `${remaining} of 5 full results left today`;
}
/** When the day's searches are gone — states the reset, invents no deadline. */
export const NONPROFIT_SEARCHES_SPENT_COPY =
  "You've used today's 3 searches — they reset tomorrow.";

// ── The grants-surface CTA ────────────────────────────────────────────────────
export const NONPROFIT_GRANTS_CTA_LABEL = "Apply for free nonprofit access";
export const NONPROFIT_GRANTS_CTA_COPY =
  "Nonprofit organization? Government grant search is free for verified 501(c)(3) " +
  "organizations. No credit card required.";

// ── The forbidden-phrase wall (build plan §6) ─────────────────────────────────
/**
 * Phrases that must NEVER appear on a nonprofit surface. Two families:
 *   • manufactured urgency / scarcity / time limits, which contradict the owner's
 *     permanent-promise rule;
 *   • the paid-tier nudge words, which do not belong on a free tier's own surfaces;
 *   • the deny-lane words, which would turn a neutral outcome into an accusation.
 */
export const FORBIDDEN_NONPROFIT_PHRASES: readonly string[] = [
  // urgency / scarcity / time limits
  "limited time",
  "ends soon",
  "expires",
  "expiring",
  "final notice",
  "act now",
  "hurry",
  "urgent",
  "only a few",
  "spots left",
  "trial",
  "promo",
  "sunset",
  // paid-tier nudges (these do not belong on the free tier's surfaces)
  "upgrade",
  "premium",
  "unlock more",
  "subscribe",
  "free forever plan",
  // deny-lane accusations
  "fraud",
  "suspicious",
  "invalid",
  "rejected",
];
/** Pattern form: a count, a dollar figure or a countdown is never allowed. */
export const FORBIDDEN_NONPROFIT_PATTERNS: readonly RegExp[] = [
  /\bfree for \d+/i,
  /\$\s?\d/,
  /\bexpires in\b/i,
  /\b\d+\s*days?\s*left\b/i,
  /\blast chance\b/i,
];

/**
 * Every applicant-facing string this module exports — the scan surface for the test
 * suite. Comments and identifiers are deliberately NOT part of it (this module has to
 * be able to NAME the forbidden words in order to forbid them).
 */
export function nonprofitCopyStrings(): string[] {
  const strings: string[] = [
    NONPROFIT_PROMISE,
    NONPROFIT_APPEAL_EMAIL,
    NONPROFIT_APPEAL_PATH,
    NONPROFIT_APPLY_HEADLINE,
    NONPROFIT_APPLY_INTRO,
    NONPROFIT_APPLY_MANUAL_PATH,
    NONPROFIT_APPLY_REVIEW_WINDOW,
    NONPROFIT_APPLY_SUBMIT_LABEL,
    NONPROFIT_APPLY_SIGNED_OUT_COPY,
    NONPROFIT_APPLY_SIGNED_OUT_SIGNUP_LABEL,
    NONPROFIT_APPLY_SIGNED_OUT_LOGIN_LABEL,
    NONPROFIT_STATUS_HEADLINE,
    NONPROFIT_STATUS_NONE_COPY,
    NONPROFIT_STATUS_APPLY_LINK_LABEL,
    NONPROFIT_STATUS_PAGE_LINK_LABEL,
    NONPROFIT_STATUS_APPROVED_DETAIL,
    NONPROFIT_STATUS_MANUAL_DETAIL,
    NONPROFIT_STATUS_DOCS_REQUESTED_DETAIL,
    NONPROFIT_NOT_GRANTED_COPY,
    NONPROFIT_SUSPENDED_COPY,
    NONPROFIT_PENDING_LIMITS_COPY,
    NONPROFIT_SEARCHES_SPENT_COPY,
    NONPROFIT_GRANTS_CTA_LABEL,
    NONPROFIT_GRANTS_CTA_COPY,
    NONPROFIT_APPLY_AUTHORIZATION_LABEL,
    ...Object.values(NONPROFIT_APPLY_FIELDS),
    ...Object.values(NONPROFIT_APPLY_VALIDATION),
    ...NONPROFIT_APPLY_ELIGIBILITY,
    ...NONPROFIT_APPLICATION_STATUSES.map((status) => nonprofitSubmittedCopy(status)),
  ];
  for (const status of NONPROFIT_APPLICATION_STATUSES) {
    const copy = NONPROFIT_STATUS_COPY[status];
    strings.push(copy.label, copy.detail);
  }
  strings.push(nonprofitSearchesRemainingCopy(2), nonprofitFullDetailsRemainingCopy(3));
  return strings;
}
