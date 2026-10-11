/**
 * CRM FOLLOW-UP REMINDERS — the shared, CLIENT-SAFE half of CRM phase 3a (owner
 * handoff 2026-10-10, item 4: "Professional reminders: Show upcoming and overdue
 * follow-ups. If implementing email delivery, require an opt-in preference. Use the
 * user's timezone. Recheck entitlement before delivery. Use a delivery
 * ledger/idempotency key and retries to prevent duplicates.").
 *
 * WHY ONE MODULE: the /pipeline panel, GET /api/crm?resource=reminders, POST
 * /api/crm { action: "saveReminderPrefs" } and the scheduled worker all need the
 * SAME answers to four questions, and they must not drift apart:
 *   * "which local day is a follow_up_date on?"      → localDateIn() / followUpState()
 *   * "is this window due for a reminder?"           → reminderDue()
 *   * "what is this window's idempotency key?"       → reminderIdempotencyKey()
 *   * "may this ledger row be emailed again?"        → decideDelivery()
 * The last one is the owner's duplicate rule; keeping it HERE (not inside the
 * worker's SQL) is what makes it unit-testable as a pure function.
 *
 * CLIENT-SAFE BY CONSTRUCTION — the same rule src/lib/pipeline-contacts.ts states
 * for itself: src/routes/pipeline.tsx and src/components/PipelineReminders.tsx
 * import this file, so nothing here may reach a server module. It imports NOTHING
 * (not even `~/db`), and the entitlement check it exposes,
 * `reminderEligible()`, reads an ALREADY-COMPUTED access object rather than
 * computing a tier — the tier matrix lives in src/lib/crm-access.server.ts and the
 * worker calls that same function, never a copy of it.
 *
 * NO NEW NOTION OF "REMINDER": the follow-up date this module reasons about is the
 * migration-052 `saved_matches.follow_up_date` the Pipeline already writes. Nothing
 * here invents, derives or stores a second date.
 */

/** The owner's retry ceiling for one delivery window (attempts, not emails). */
export const REMINDER_MAX_ATTEMPTS = 3;
/** Fallback when a user has not chosen a timezone: the stored default. */
export const DEFAULT_REMINDER_TIMEZONE = "UTC";
/** Longest timezone string we will even look at (IANA names are far shorter). */
const MAX_TIMEZONE_LENGTH = 64;
/** The email shape shared with the phase-1 CRM route's own validation. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A strict calendar date, the shape `saved_matches.follow_up_date` (DATE) has. */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── The user's timezone ──────────────────────────────────────────────────────

/**
 * True when the runtime's `Intl` accepts `timezone` as an IANA zone. This is the
 * SAME validation the write path applies before storing a value, so a stored
 * timezone is always one the worker can resolve.
 *
 * Nothing is normalized, guessed or mapped ("EST" is NOT silently turned into
 * "America/New_York") — an unusable value is simply rejected.
 */
export function isValidTimezone(timezone: unknown): boolean {
  if (typeof timezone !== "string") return false;
  const value = timezone.trim();
  if (value.length === 0 || value.length > MAX_TIMEZONE_LENGTH) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The timezone to reason with: the stored value when the runtime accepts it,
 * otherwise the default (`UTC`). NEVER throws and never invents a zone — an
 * unusable stored value falls back to UTC, which is the honest, predictable choice
 * (a wrong-but-plausible zone would shift a reminder's day silently).
 */
export function normalizeTimezone(timezone: unknown): string {
  return isValidTimezone(timezone) ? String(timezone).trim() : DEFAULT_REMINDER_TIMEZONE;
}

/**
 * `now` as the calendar date (`YYYY-MM-DD`) it already is IN `timezone`.
 *
 * This is the whole "use the user's timezone" requirement: a follow-up date is a
 * calendar day, so "is it due?" must be answered against the user's local day, not
 * against UTC. Built from `Intl.DateTimeFormat.formatToParts`, so no locale
 * spelling is assumed (a hand-rolled `toLocaleDateString` could return any order).
 */
export function localDateIn(timezone: string, now: Date): string {
  const zone = normalizeTimezone(timezone);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const year = pick("year");
    const month = pick("month");
    const day = pick("day");
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // An unresolvable zone cannot happen after normalizeTimezone(); if the runtime
    // disagrees, fall through to the UTC day rather than throwing in a worker.
  }
  return new Date(now).toISOString().slice(0, 10);
}

/** True for a real `YYYY-MM-DD` calendar date (rejects 2026-02-31 and 2026-2-3). */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_ONLY_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Whole days from `fromDate` to `toDate` (both `YYYY-MM-DD`), signed: positive when
 * `toDate` is later. Day arithmetic is done on the two calendar dates at UTC
 * midnight, so the result never depends on a daylight-saving boundary or the
 * process's own zone.
 */
export function daysBetween(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86400000);
}

/** What a follow-up date means to its owner right now. */
export type FollowUpKind = "overdue" | "due_today" | "upcoming";
export type FollowUpState =
  | { kind: "none" }
  | { kind: FollowUpKind; /** Whole days away from the user's local day (>= 0). */ days: number; /** The user's local day the state was measured on. */ localDate: string };

/**
 * Classifies `followUpDate` against the user's LOCAL day in `timezone`:
 *   * `overdue`    — the local day is past the follow-up date (`days` = how many)
 *   * `due_today`  — the local day IS the follow-up date
 *   * `upcoming`   — the follow-up date is still ahead (`days` = how many)
 *   * `none`       — no follow-up date set (or an unusable one): the honest
 *                    "nothing to remind about", never a made-up date
 *
 * `now` is injected so every branch is deterministic and testable — the worker and
 * the in-app view pass the same instant they are rendering for.
 */
export function followUpState(
  followUpDate: string | null | undefined,
  timezone: string,
  now: Date,
): FollowUpState {
  if (!isDateOnly(followUpDate)) return { kind: "none" };
  const localDate = localDateIn(timezone, now);
  const diff = daysBetween(followUpDate, localDate);
  if (diff > 0) return { kind: "overdue", days: diff, localDate };
  if (diff === 0) return { kind: "due_today", days: 0, localDate };
  return { kind: "upcoming", days: -diff, localDate };
}

/**
 * True when this window is DUE for a reminder: the user's local day has reached the
 * follow-up date (due today OR overdue). Deliberately inclusive of `overdue` — a
 * worker that runs once a day must never skip a window permanently because its one
 * run landed after the day had already passed for that user's zone.
 */
export function reminderDue(
  followUpDate: string | null | undefined,
  timezone: string,
  now: Date,
): boolean {
  const state = followUpState(followUpDate, timezone, now);
  return state.kind === "overdue" || state.kind === "due_today";
}

// ── The delivery ledger ──────────────────────────────────────────────────────

/**
 * The idempotency key of one delivery window: `"<user_id>:<saved_match_id>:<due_on>"`.
 *
 * This is the owner's dedupe rule made concrete. The window is (user, their saved
 * bid, the follow-up date the reminder is about) — NOT the send attempt — so:
 *   * the whole cron re-running, a retry, or a second concurrent worker all build
 *     the SAME key and can therefore never create a second ledger row;
 *   * a user who MOVES a follow-up date gets a genuinely new window (and therefore
 *     legitimately gets a reminder for the new date), while the old window stays
 *     closed forever;
 *   * two users can never collide, because the id is part of the key.
 */
export function reminderIdempotencyKey(
  userId: number,
  savedMatchId: number,
  dueOn: string,
): string {
  return `${userId}:${savedMatchId}:${dueOn}`;
}

/** The ledger columns `decideDelivery` reasons about (a subset of the row). */
export interface ReminderLedgerRow {
  idempotency_key: string;
  delivered_at: string | null;
  attempt_count: number;
  last_error: string | null;
}

export type DeliveryDecision =
  | { action: "send"; reason: "new" | "claimed_not_attempted" }
  | { action: "retry"; reason: "last_attempt_failed" }
  | {
      action: "skip";
      reason: "already_delivered" | "attempt_unconfirmed" | "max_attempts";
    };

/**
 * THE DUPLICATE RULE — what the worker may do with one window.
 *
 * The ledger row is authoritative, and the decision only ever moves in one
 * direction (never a second email for a window):
 *   * no row                     → `send`   ("new"): claim it, then attempt.
 *   * `delivered_at` set         → `skip`   ("already_delivered"): the email went.
 *   * 0 attempts recorded        → `send`   ("claimed_not_attempted"): a claim row
 *                                  whose attempt never started, so no mail can have
 *                                  left — safe to (re)attempt.
 *   * attempt(s) >= ceiling      → `skip`   ("max_attempts"): give up, loudly.
 *   * last attempt FAILED         → `retry`  ("last_attempt_failed"): the provider
 *                                  told us it did not accept the message, so this is
 *                                  a retry rather than a duplicate.
 *   * attempt(s) with NO recorded→ `skip`   ("attempt_unconfirmed"): the process
 *     outcome                      died between the attempt and its outcome, so the
 *                                  mail may already have been accepted. The owner's
 *                                  rule ("retries must not re-email") decides it:
 *                                  a possibly-lost reminder beats a duplicate.
 *
 * Why `attempt_count` is bumped BEFORE the mail call (see the worker): if it were
 * not, a crash right after the provider accepted the message would leave
 * `attempt_count = 0` and this function would call it "claimed_not_attempted" —
 * a duplicate. The ordering is what makes the "attempt_unconfirmed" branch real.
 */
export function decideDelivery(
  existing: ReminderLedgerRow | null | undefined,
  maxAttempts: number = REMINDER_MAX_ATTEMPTS,
): DeliveryDecision {
  if (!existing) return { action: "send", reason: "new" };
  if (existing.delivered_at) return { action: "skip", reason: "already_delivered" };
  const attempts = Number(existing.attempt_count ?? 0);
  if (!Number.isFinite(attempts) || attempts <= 0) {
    return { action: "send", reason: "claimed_not_attempted" };
  }
  if (attempts >= maxAttempts) return { action: "skip", reason: "max_attempts" };
  if (existing.last_error) return { action: "retry", reason: "last_attempt_failed" };
  return { action: "skip", reason: "attempt_unconfirmed" };
}

// ── The opt-in and the recipient ─────────────────────────────────────────────

/**
 * May this account be emailed a reminder at all? Both halves are required and both
 * are answers the SERVER already has:
 *   * `access.reminders` — the phase-1 tier flag (Professional only), computed by
 *     `computeCrmAccess()`. A passed-in `null` (access not resolved) is NOT
 *     entitled.
 *   * `optIn` — the owner's explicit preference. `user_crm_prefs.reminders_opt_in`
 *     defaults to false, and nothing may flip it except the user's own request.
 */
export function reminderEligible(input: {
  access: { reminders: boolean } | null | undefined;
  optIn: boolean | null | undefined;
}): boolean {
  return input.access?.reminders === true && input.optIn === true;
}

/**
 * Domains that can never belong to a real customer: RFC 2606/6761 reserved names
 * and the team's own QA test domain (@test.contrax accounts are created by QA runs,
 * see WORKFLOW.md's cleanup rule). A worker that email-sends must not treat one of
 * these as a deliverable recipient, and it must say so rather than guess.
 */
const RESERVED_EMAIL_SUFFIXES = ["@test.contrax", "@example.com", "@example.org", "@example.net"];

/**
 * True when `email` is a usable reminder recipient: a syntactically valid address
 * that is not reserved/QA. This is the "an opted-verified email" half of the
 * owner's rule — consent is opt-in (the preference), and the address must be one
 * that can actually receive the mail.
 */
export function deliverableEmail(email: unknown): boolean {
  if (typeof email !== "string") return false;
  const value = email.trim().toLowerCase();
  if (!EMAIL_RE.test(value)) return false;
  if (RESERVED_EMAIL_SUFFIXES.some((suffix) => value.endsWith(suffix))) return false;
  if (value.endsWith(".invalid") || value.endsWith(".test")) return false;
  return true;
}

// ── The in-app list (Professional) ───────────────────────────────────────────

/** What the worker needs to know about one saved bid with a follow-up date. */
export interface ReminderBidSource {
  saved_match_id: number;
  bid_id: number;
  title: string;
  follow_up_date: string | null;
  next_action: string;
}

/** One row of the in-app upcoming / overdue list. */
export interface ReminderListItem {
  saved_match_id: number;
  bid_id: number;
  title: string;
  /** Always a real calendar date: rows without one are not in the list at all. */
  follow_up_date: string;
  next_action: string;
  kind: FollowUpKind;
  /** Whole days from the user's local day (see followUpState). */
  days: number;
}

export interface ReminderLists {
  /** Most overdue first. */
  overdue: ReminderListItem[];
  /** Soonest first. */
  upcoming: ReminderListItem[];
}

/**
 * The two lists the Pipeline panel renders, computed from the SAME
 * `saved_matches.follow_up_date` the workspace already edits — with the user's
 * timezone. An item with no follow-up date is omitted entirely (it is not a
 * reminder); `due_today` items are listed under `upcoming` with `days: 0`, since the
 * page's two buckets are "overdue" and "not yet overdue" and a separate third
 * heading would invent a distinction the owner did not ask for.
 */
export function buildReminderLists(
  items: readonly ReminderBidSource[],
  timezone: string,
  now: Date,
): ReminderLists {
  const overdue: ReminderListItem[] = [];
  const upcoming: ReminderListItem[] = [];
  for (const item of items) {
    const state = followUpState(item.follow_up_date, timezone, now);
    if (state.kind === "none") continue;
    const row: ReminderListItem = {
      saved_match_id: item.saved_match_id,
      bid_id: item.bid_id,
      title: item.title,
      follow_up_date: String(item.follow_up_date),
      next_action: item.next_action,
      kind: state.kind,
      days: state.days,
    };
    if (state.kind === "overdue") overdue.push(row);
    else upcoming.push(row);
  }
  overdue.sort((a, b) => b.days - a.days || a.saved_match_id - b.saved_match_id);
  upcoming.sort((a, b) => a.days - b.days || a.saved_match_id - b.saved_match_id);
  return { overdue, upcoming };
}

// ── Wire shapes & copy ───────────────────────────────────────────────────────

/** The user's stored reminder preference (POST /api/crm resource=reminders). */
export interface CrmReminderPrefsView {
  /** `user_crm_prefs.reminders_opt_in` — false until the user opts in. */
  opt_in: boolean;
  /** The user's IANA timezone (stored default `UTC`). */
  timezone: string;
  /** True when a `user_crm_prefs` row exists at all (an absent row = no consent). */
  stored: boolean;
}

/** The payload of GET /api/crm?resource=reminders (Professional only). */
export interface CrmRemindersPayload {
  /** Mirrors CrmAccessView in src/lib/pipeline-contacts.ts. */
  access: { tier: string; reminders: boolean };
  prefs: CrmReminderPrefsView;
}

/** A candidate timezone list for the picker: the runtime's own IANA set when it can
 * enumerate them, otherwise a small honest fallback (never a made-up zone). */
export function timezoneOptions(current?: string | null): string[] {
  const zones: string[] = [];
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf;
    if (typeof supported === "function") zones.push(...supported("timeZone"));
  } catch {
    // fall through to the fallback list
  }
  if (zones.length === 0) {
    zones.push(
      "UTC",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Anchorage",
      "Pacific/Honolulu",
      "America/Phoenix",
      "America/Puerto_Rico",
    );
  }
  const normalized = normalizeTimezone(current);
  // The user's own zone is ALWAYS first (and appears once), so the picker opens on
  // what they are actually using.
  return [normalized, ...zones.filter((zone) => zone !== normalized)];
}

/**
 * The locked state a non-Professional user sees in the Pipeline's Reminders panel.
 * Same house gate shape as the phase-2 contacts lock (title / body / CTA / price
 * note), and it claims nothing past the ratified tier table: reminders are a
 * Professional feature. The price line and the upgrade prompt come from the
 * existing PremiumUpgradeModal ($79/mo Professional default) — this file adds no
 * pricing.
 *
 * ATTEMPT-ONLY comes from the caller, not from this copy: the panel renders this
 * locked card on view, and the upgrade MODAL opens only when the user clicks the
 * gated control (owner rule 8 — a prompt never fires on a page view).
 */
export const CRM_REMINDERS_LOCK_TITLE = "Follow-up reminders are a Professional feature";
export const CRM_REMINDERS_LOCK_BODY =
  "Reminders show the follow-up dates you have set on your saved bids — what is overdue and what is coming up — in your own timezone, and you can opt in to a daily email when a follow-up comes due. Your saved bids and their follow-up dates are unchanged.";
export const CRM_REMINDERS_LOCK_CTA = "Upgrade to Professional →";
/**
 * Shown to a Professional user next to the email switch. It states exactly what the
 * worker does — one email per follow-up date, sent when that date is due in the
 * user's timezone, and nothing else — and that the switch is reversible. No
 * frequency promise beyond the one the code keeps, no claim of a digest.
 */
export const CRM_REMINDERS_OPT_IN_NOTE =
  "Optional. When this is on, Contrax sends one email for each follow-up date that comes due in your timezone — and if it is still overdue the next day, that is still the same single email. Turning it off stops reminder email immediately.";
/** The switch's own label, used for the control and the email subject line. */
export const CRM_REMINDERS_OPT_IN_LABEL = "Email me when a follow-up comes due";
/** The email subject (the worker's ONE email shape). */
export const CRM_REMINDERS_EMAIL_SUBJECT = "Contrax follow-ups due today";
