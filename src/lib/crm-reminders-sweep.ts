/**
 * CRM FOLLOW-UP REMINDER SWEEP — the worker's algorithm and its three seams (CRM
 * phase 3a, owner handoff 2026-10-10 item 4).
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM src/lib/crm-reminders.server.ts: the sweep
 * must be testable ANYWHERE, and its unit suite must not need a database driver. So
 * it imports nothing but the pure rules (src/lib/crm-reminders.ts) — no `~/db`, no
 * `resend`, no `@tanstack/*`. The Neon-backed store, the preference read/write and
 * the production entitlement checker live next door in crm-reminders.server.ts, and
 * the CLI job (src/jobs/crm-reminder-send.ts) wires the two together. Same split as
 * `computeTrialStatus` / `loadUserTrialStatus` in src/lib/trial.ts.
 *
 * THE OWNER'S SEQUENCE, LITERALLY:
 *   1. the OPT-IN (`reminders_opt_in`, false by default — no consent, no email);
 *   2. a deliverable recipient address;
 *   3. an ENTITLEMENT RECHECK, per account, immediately before any send;
 *   4. the user's TIMEZONE decides which follow-up windows are due;
 *   5. the DELIVERY LEDGER decides whether a due window may still be emailed.
 */
import {
  REMINDER_MAX_ATTEMPTS,
  decideDelivery,
  deliverableEmail,
  normalizeTimezone,
  reminderDue,
  reminderEligible,
  reminderIdempotencyKey,
} from "~/lib/crm-reminders";

/** How many opted-in accounts one run looks at (a ceiling, not a promise). */
export const REMINDER_CANDIDATE_LIMIT = 2000;
/** How many saved bids with a follow-up date one account contributes per run. */
export const REMINDER_FOLLOW_UP_LIMIT = 500;
/** How many human-readable notes a run keeps for its log line. */
const MAX_RUN_NOTES = 25;

/** One opted-in account, as the candidate query returns it. */
export interface ReminderCandidateRow {
  user_id: number;
  email: string | null;
  is_admin: boolean;
  reminders_opt_in: boolean;
  timezone: string;
}

/** One saved bid with a follow-up date (the migration-052 column; no new notion). */
export interface ReminderFollowUpRow {
  saved_match_id: number;
  bid_id: number;
  title: string;
  follow_up_date: string;
  next_action: string;
  source_url: string | null;
}

/** One ledger row, as the duplicate rule reads it. */
export interface ReminderDeliveryRecord {
  id: number;
  idempotency_key: string;
  delivered_at: string | null;
  attempt_count: number;
  last_error: string | null;
}

export interface ReminderClaimInput {
  userId: number;
  savedMatchId: number;
  bidId: number;
  dueOn: string;
  scheduledFor: Date;
  idempotencyKey: string;
}

export interface CrmReminderStore {
  /** Opted-in accounts only (`reminders_opt_in = true`). */
  listCandidates(limit: number): Promise<ReminderCandidateRow[]>;
  /** The user's saved bids that carry a follow-up date. */
  listFollowUps(userId: number): Promise<ReminderFollowUpRow[]>;
  getDelivery(idempotencyKey: string): Promise<ReminderDeliveryRecord | null>;
  /** Returns the new row's id, or NULL when another run already claimed the key. */
  claimDelivery(input: ReminderClaimInput): Promise<number | null>;
  /** Records that an attempt is STARTING (bumped before the mail call). */
  beginAttempt(id: number): Promise<number>;
  markDelivered(id: number, at: Date): Promise<void>;
  markFailed(id: number, error: string): Promise<void>;
}

/**
 * What the sweep needs to know about the account's entitlement — the phase-1 flag
 * and nothing else. The production checker returns the FULL `CrmAccess` object from
 * src/lib/crm-access.server.ts, which satisfies this structurally; the sweep never
 * computes a tier and never re-implements the ladder.
 */
export interface ReminderEntitlement {
  access: { tier: string; reminders: boolean };
}

export interface ReminderEntitlementChecker {
  check(user: { id: number; is_admin: boolean }): Promise<ReminderEntitlement>;
}

/** The one email shape this feature sends (one window per message). */
export interface ReminderEmailItem {
  title: string;
  follow_up_date: string;
  next_action: string;
  source_url: string | null;
}

export interface ReminderMailer {
  send(to: string, items: ReminderEmailItem[]): Promise<{ ok: true } | { ok: false; error: string }>;
}

export interface CrmReminderSweepDeps {
  store: CrmReminderStore;
  entitlement: ReminderEntitlementChecker;
  mailer: ReminderMailer;
  /** The instant every due/overdue decision in this run is measured against. */
  now: Date;
  maxAttempts?: number;
  candidateLimit?: number;
}

export interface CrmReminderSweepResult {
  usersChecked: number;
  usersSkippedOptOut: number;
  usersSkippedUnentitled: number;
  usersSkippedEmail: number;
  followUpsConsidered: number;
  windowsDue: number;
  emailsSent: number;
  windowsRetried: number;
  windowsSkipped: number;
  failures: number;
  notes: string[];
}

/**
 * ONE RUN of the reminder worker. Idempotent by construction: every window it might
 * email is guarded by the ledger, so running it twice (or twice at once) sends each
 * window at most once.
 *
 * Failure containment: one account's or one window's error is logged and counted,
 * never thrown — the next account still runs (the radar-alert job's fail-open
 * posture).
 */
export async function runCrmReminderSweep(
  deps: CrmReminderSweepDeps,
): Promise<CrmReminderSweepResult> {
  const maxAttempts = deps.maxAttempts ?? REMINDER_MAX_ATTEMPTS;
  const candidates = await deps.store.listCandidates(deps.candidateLimit ?? REMINDER_CANDIDATE_LIMIT);
  const result: CrmReminderSweepResult = {
    usersChecked: 0,
    usersSkippedOptOut: 0,
    usersSkippedUnentitled: 0,
    usersSkippedEmail: 0,
    followUpsConsidered: 0,
    windowsDue: 0,
    emailsSent: 0,
    windowsRetried: 0,
    windowsSkipped: 0,
    failures: 0,
    notes: [],
  };
  const note = (line: string) => {
    if (result.notes.length < MAX_RUN_NOTES) result.notes.push(line);
  };

  for (const candidate of candidates) {
    result.usersChecked += 1;
    const userId = candidate.user_id;
    // 1. Consent, re-read per run. The candidate query already filtered on it; this
    //    is the belt to that braces and it is the FIRST gate for a reason.
    if (candidate.reminders_opt_in !== true) {
      result.usersSkippedOptOut += 1;
      continue;
    }
    // 2. A recipient that can actually receive mail.
    if (!deliverableEmail(candidate.email)) {
      result.usersSkippedEmail += 1;
      note(`user ${userId}: skipped — no deliverable email`);
      continue;
    }
    // 3. THE RECHECK, immediately before any send.
    let access: ReminderEntitlement["access"] | null = null;
    try {
      access = (await deps.entitlement.check({ id: userId, is_admin: candidate.is_admin })).access;
    } catch (error) {
      result.usersSkippedUnentitled += 1;
      note(`user ${userId}: skipped — entitlement unreadable (${describeError(error)})`);
      continue;
    }
    if (!access) {
      // Defensive: a checker that resolves without an access object is NOT entitled.
      result.usersSkippedUnentitled += 1;
      note(`user ${userId}: skipped — entitlement unavailable`);
      continue;
    }
    if (!reminderEligible({ access, optIn: candidate.reminders_opt_in })) {
      result.usersSkippedUnentitled += 1;
      note(`user ${userId}: skipped — not entitled (tier ${access.tier})`);
      continue;
    }
    const timezone = normalizeTimezone(candidate.timezone);

    let followUps: ReminderFollowUpRow[];
    try {
      followUps = await deps.store.listFollowUps(userId);
    } catch (error) {
      result.failures += 1;
      note(`user ${userId}: follow-up read failed (${describeError(error)})`);
      continue;
    }

    for (const followUp of followUps) {
      result.followUpsConsidered += 1;
      // 4. The user's own calendar day decides whether this window is due.
      if (!reminderDue(followUp.follow_up_date, timezone, deps.now)) continue;
      result.windowsDue += 1;
      const key = reminderIdempotencyKey(userId, followUp.saved_match_id, followUp.follow_up_date);

      try {
        const existing = await deps.store.getDelivery(key);
        const decision = decideDelivery(existing, maxAttempts);
        if (decision.action === "skip") {
          result.windowsSkipped += 1;
          note(`user ${userId} window ${key}: skipped — ${decision.reason}`);
          continue;
        }
        let deliveryId: number | null;
        if (decision.action === "send") {
          deliveryId = await deps.store.claimDelivery({
            userId,
            savedMatchId: followUp.saved_match_id,
            bidId: followUp.bid_id,
            dueOn: followUp.follow_up_date,
            scheduledFor: deps.now,
            idempotencyKey: key,
          });
          if (deliveryId === null) {
            // Another run claimed it between our read and our insert.
            result.windowsSkipped += 1;
            note(`user ${userId} window ${key}: skipped — claimed by another run`);
            continue;
          }
        } else {
          deliveryId = existing!.id;
        }
        // 5a. Record that an attempt is starting BEFORE calling the provider, so a
        //     crash after acceptance can never look like "never attempted".
        const attempts = await deps.store.beginAttempt(deliveryId);
        if (attempts > maxAttempts) {
          result.windowsSkipped += 1;
          note(`user ${userId} window ${key}: skipped — attempt ceiling reached`);
          continue;
        }
        const outcome = await deps.mailer.send(String(candidate.email), [
          {
            title: followUp.title,
            follow_up_date: followUp.follow_up_date,
            next_action: followUp.next_action,
            source_url: followUp.source_url,
          },
        ]);
        if (outcome.ok) {
          await deps.store.markDelivered(deliveryId, deps.now);
          result.emailsSent += 1;
          if (decision.action === "retry") result.windowsRetried += 1;
        } else {
          await deps.store.markFailed(deliveryId, outcome.error);
          result.failures += 1;
          note(`user ${userId} window ${key}: send failed (${outcome.error.slice(0, 120)})`);
        }
      } catch (error) {
        result.failures += 1;
        note(`user ${userId} window ${key}: errored (${describeError(error)})`);
      }
    }
  }
  return result;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120);
}
