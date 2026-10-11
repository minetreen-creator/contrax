/**
 * CRM FOLLOW-UP REMINDERS — the DATABASE half (owner handoff 2026-10-10, item 4;
 * CRM phase 3a). Three consumers, one set of rules:
 *
 *   * GET /api/crm?resource=reminders and POST /api/crm { action: "saveReminderPrefs" }
 *     — the preference read/write behind the Pipeline's Reminders panel.
 *   * src/jobs/crm-reminder-send.ts — the SCHEDULED WORKER, which emails at most one
 *     message per (user, saved bid, follow-up date) window.
 *
 * SERVER-ONLY (imports `~/db`). The worker's ALGORITHM lives in
 * src/lib/crm-reminders-sweep.ts, which imports no database driver at all, and every
 * decision inside it is either a pure rule from src/lib/crm-reminders.ts or the REAL
 * phase-1 entitlement function `getCrmAccess()` — this module never re-implements a
 * tier ladder.
 *
 * This file deliberately does NOT import src/lib/email.ts (or `resend`): the CLI job
 * wires the Resend adapter, which keeps the sweep and its unit suite network-free.
 */
import { sql } from "~/db";
import { dateOnly } from "~/lib/brief-source";
import { getCrmAccess } from "~/lib/crm-access.server";
import {
  DEFAULT_REMINDER_TIMEZONE,
  buildReminderLists,
  normalizeTimezone,
  type CrmReminderPrefsView,
  type ReminderBidSource,
  type ReminderLists,
} from "~/lib/crm-reminders";
import {
  REMINDER_FOLLOW_UP_LIMIT,
  type CrmReminderStore,
  type ReminderCandidateRow,
  type ReminderClaimInput,
  type ReminderDeliveryRecord,
  type ReminderEntitlementChecker,
  type ReminderFollowUpRow,
} from "~/lib/crm-reminders-sweep";
import type { CrmAccess } from "~/lib/crm-access.server";

// The worker's entry point and its constants are re-exported so the CLI job (and its
// readers) import the feature from ONE module while the implementation stays free of
// the database driver.
export { runCrmReminderSweep, REMINDER_CANDIDATE_LIMIT } from "~/lib/crm-reminders-sweep";
export type {
  CrmReminderSweepDeps,
  CrmReminderSweepResult,
  ReminderEmailItem,
  ReminderMailer,
} from "~/lib/crm-reminders-sweep";

// ── Preferences (the OPT-IN) ─────────────────────────────────────────────────

/**
 * The user's stored preference. An account with no row has simply never opted in,
 * so `stored: false` with `opt_in: false` is the honest answer — never an implied
 * consent and never an invented timezone.
 */
export async function loadCrmReminderPrefs(userId: number): Promise<CrmReminderPrefsView> {
  const rows = (await sql()`
    SELECT reminders_opt_in, timezone
    FROM user_crm_prefs
    WHERE user_id = ${userId}
    LIMIT 1
  `) as Array<{ reminders_opt_in: boolean | null; timezone: string | null }>;
  const row = rows[0];
  if (!row) return { opt_in: false, timezone: DEFAULT_REMINDER_TIMEZONE, stored: false };
  return {
    opt_in: row.reminders_opt_in === true,
    timezone: normalizeTimezone(row.timezone),
    stored: true,
  };
}

/**
 * Stores the user's own opt-in decision and timezone (an upsert — one row per
 * account). `optIn` is written exactly as the user asked for it, in both directions,
 * so switching reminders off is as real as switching them on. The sole caller is
 * POST /api/crm { action: "saveReminderPrefs" } for the AUTHENTICATED user, so a
 * request can only ever change its own preference.
 */
export async function saveCrmReminderPrefs(
  userId: number,
  input: { optIn: boolean; timezone: string },
): Promise<CrmReminderPrefsView> {
  const timezone = normalizeTimezone(input.timezone);
  const rows = (await sql()`
    INSERT INTO user_crm_prefs (user_id, reminders_opt_in, timezone, updated_at)
    VALUES (${userId}, ${input.optIn}, ${timezone}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      reminders_opt_in = EXCLUDED.reminders_opt_in,
      timezone = EXCLUDED.timezone,
      updated_at = NOW()
    RETURNING reminders_opt_in, timezone
  `) as Array<{ reminders_opt_in: boolean; timezone: string }>;
  return {
    opt_in: rows[0]?.reminders_opt_in === true,
    timezone: normalizeTimezone(rows[0]?.timezone),
    stored: true,
  };
}

// ── The store the worker drives ──────────────────────────────────────────────

export const neonCrmReminderStore: CrmReminderStore = {
  async listCandidates(limit) {
    const rows = (await sql()`
      SELECT u.id AS user_id, u.email, COALESCE(u.is_admin, FALSE) AS is_admin,
             p.reminders_opt_in, p.timezone
      FROM user_crm_prefs p
      JOIN users u ON u.id = p.user_id
      WHERE p.reminders_opt_in = TRUE
      ORDER BY p.user_id ASC
      LIMIT ${limit}
    `) as Array<Record<string, unknown>>;
    return rows.map(
      (r): ReminderCandidateRow => ({
        user_id: Number(r.user_id),
        email: r.email == null ? null : String(r.email),
        is_admin: r.is_admin === true,
        reminders_opt_in: r.reminders_opt_in === true,
        timezone: normalizeTimezone(r.timezone),
      }),
    );
  },
  async listFollowUps(userId) {
    const rows = (await sql()`
      SELECT sm.id AS saved_match_id, sm.bid_id, sm.follow_up_date, sm.next_action,
             b.title, b.source_url
      FROM saved_matches sm
      JOIN bids b ON b.id = sm.bid_id
      WHERE sm.user_id = ${userId}
        AND sm.status = 'saved'
        AND sm.follow_up_date IS NOT NULL
      ORDER BY sm.follow_up_date ASC, sm.id ASC
      LIMIT ${REMINDER_FOLLOW_UP_LIMIT}
    `) as Array<Record<string, unknown>>;
    return rows.flatMap((r): ReminderFollowUpRow[] => {
      const followUpDate = dateOnly(r.follow_up_date);
      if (!followUpDate) return [];
      return [
        {
          saved_match_id: Number(r.saved_match_id),
          bid_id: Number(r.bid_id),
          title: String(r.title ?? ""),
          next_action: String(r.next_action ?? ""),
          source_url: r.source_url == null ? null : String(r.source_url),
          follow_up_date: followUpDate,
        },
      ];
    });
  },
  async getDelivery(idempotencyKey) {
    const rows = (await sql()`
      SELECT id, idempotency_key, delivered_at, attempt_count, last_error
      FROM crm_reminder_deliveries
      WHERE idempotency_key = ${idempotencyKey}
      LIMIT 1
    `) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      idempotency_key: String(row.idempotency_key ?? idempotencyKey),
      delivered_at: row.delivered_at == null ? null : String(row.delivered_at),
      attempt_count: Number(row.attempt_count ?? 0),
      last_error: row.last_error == null ? null : String(row.last_error),
    } satisfies ReminderDeliveryRecord;
  },
  async claimDelivery(input: ReminderClaimInput) {
    // THE CLAIM. `ON CONFLICT (idempotency_key) DO NOTHING` against the unique index
    // from migration 060: a second worker (or a re-run) inserting the same window gets
    // no row back, which is how "duplicate delivery impossible" is enforced by the
    // database rather than by hope.
    const rows = (await sql()`
      INSERT INTO crm_reminder_deliveries (
        user_id, saved_match_id, bid_id, due_on, scheduled_for, idempotency_key
      ) VALUES (
        ${input.userId}, ${input.savedMatchId}, ${input.bidId}, ${input.dueOn},
        ${input.scheduledFor}, ${input.idempotencyKey}
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `) as Array<{ id: number }>;
    return rows.length ? Number(rows[0]!.id) : null;
  },
  async beginAttempt(id) {
    const rows = (await sql()`
      UPDATE crm_reminder_deliveries
      SET attempt_count = attempt_count + 1
      WHERE id = ${id}
      RETURNING attempt_count
    `) as Array<{ attempt_count: number }>;
    return Number(rows[0]?.attempt_count ?? 0);
  },
  async markDelivered(id, at) {
    await sql()`
      UPDATE crm_reminder_deliveries
      SET delivered_at = ${at}, last_error = NULL
      WHERE id = ${id}
    `;
  },
  async markFailed(id, error) {
    await sql()`
      UPDATE crm_reminder_deliveries
      SET last_error = ${error.slice(0, 500)}
      WHERE id = ${id}
    `;
  },
};

/** The user's saved bids with a follow-up date, for the in-app list. */
export async function listReminderSourceRows(userId: number): Promise<ReminderBidSource[]> {
  const rows = await neonCrmReminderStore.listFollowUps(userId);
  return rows.map((row) => ({
    saved_match_id: row.saved_match_id,
    bid_id: row.bid_id,
    title: row.title,
    follow_up_date: row.follow_up_date,
    next_action: row.next_action,
  }));
}

// ── The production entitlement recheck ───────────────────────────────────────

/**
 * The RECHECK the owner asks for, wired to the phase-1 function itself: this checker
 * calls `getCrmAccess()` (subscription_status / trial state / full-access grant /
 * admin / demo — the whole ladder, in one place). It also carries `is_admin` from the
 * candidate row so an admin bypasses exactly the way the API route's does.
 */
export const crmReminderEntitlementChecker: ReminderEntitlementChecker = {
  async check(user) {
    const access: CrmAccess = await getCrmAccess({ id: user.id, is_admin: user.is_admin });
    return { access };
  },
};

// ── In-app lists (Professional) ──────────────────────────────────────────────

/**
 * The upcoming + overdue lists for the Pipeline panel, built from the SAME
 * `saved_matches.follow_up_date` rows the workspace edits, classified in the user's
 * timezone by the pure module.
 */
export async function loadReminderLists(
  userId: number,
  timezone: string,
  now: Date,
): Promise<ReminderLists> {
  return buildReminderLists(await listReminderSourceRows(userId), timezone, now);
}
