/**
 * CRM FOLLOW-UP REMINDERS — the PURE rules (CRM phase 3a, owner handoff 2026-10-10
 * item 4: "…Use the user's timezone… Use a delivery ledger/idempotency key and
 * retries to prevent duplicates…").
 *
 * DETERMINISTIC, ZERO NETWORK, ZERO DATABASE, no clock: `now` is always injected and
 * every input is a literal. Nothing here imports `~/db` or `resend`, uses
 * `mock.module` (bun's mock registry is process-global and leaks across test files in
 * one run) or touches the live tables.
 *
 * The four rules this file pins are the ones the owner named:
 *   1. which LOCAL day a follow-up date falls on (the timezone math);
 *   2. when a window is DUE (due today or overdue — never skipped);
 *   3. the idempotency key's identity (what "the same window" means);
 *   4. which ledger rows may be emailed again — i.e. why a retry cannot duplicate.
 */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_REMINDER_TIMEZONE,
  REMINDER_MAX_ATTEMPTS,
  buildReminderLists,
  daysBetween,
  decideDelivery,
  deliverableEmail,
  followUpState,
  isValidTimezone,
  isDateOnly,
  localDateIn,
  normalizeTimezone,
  reminderDue,
  reminderEligible,
  reminderIdempotencyKey,
  timezoneOptions,
  type ReminderLedgerRow,
} from "./crm-reminders";

const ledger = (over: Partial<ReminderLedgerRow>): ReminderLedgerRow => ({
  idempotency_key: "1:2:2026-10-11",
  delivered_at: null,
  attempt_count: 0,
  last_error: null,
  ...over,
});

describe("the user's timezone decides the local day", () => {
  test("the same instant is a different calendar day in different zones", () => {
    // 2026-10-11T02:00Z is still Oct 10 in New York (EDT, UTC-4) and already Oct 11
    // in UTC and in Auckland (NZDT, UTC+13).
    const now = new Date("2026-10-11T02:00:00Z");
    expect(localDateIn("UTC", now)).toBe("2026-10-11");
    expect(localDateIn("America/New_York", now)).toBe("2026-10-10");
    expect(localDateIn("Pacific/Auckland", now)).toBe("2026-10-11");
  });

  test("an unusable zone falls back to UTC rather than inventing one", () => {
    const now = new Date("2026-10-11T02:00:00Z");
    expect(normalizeTimezone("Mars/Phobos")).toBe(DEFAULT_REMINDER_TIMEZONE);
    expect(normalizeTimezone(undefined)).toBe(DEFAULT_REMINDER_TIMEZONE);
    expect(localDateIn("Mars/Phobos", now)).toBe("2026-10-11");
  });

  test("a daylight-saving change moves the offset, not the calendar arithmetic", () => {
    // EDT (UTC-4) on Oct 15, EST (UTC-5) on Nov 2 — the same 03:30Z/04:30Z wall time.
    expect(localDateIn("America/New_York", new Date("2026-10-15T03:30:00Z"))).toBe("2026-10-14");
    expect(localDateIn("America/New_York", new Date("2026-11-02T04:30:00Z"))).toBe("2026-11-01");
    // Whole-day distances are calendar differences, so a 23-hour DST day is still 1.
    expect(daysBetween("2026-11-01", "2026-11-02")).toBe(1);
    expect(daysBetween("2026-11-01", "2026-11-03")).toBe(2);
    expect(daysBetween("2026-11-03", "2026-11-01")).toBe(-2);
  });

  test("isValidTimezone accepts real zones and rejects junk (no silent mapping)", () => {
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("Pacific/Auckland")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Mars/Phobos")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("   ")).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
    expect(isValidTimezone(42)).toBe(false);
    expect(isValidTimezone("A".repeat(200))).toBe(false);
  });

  test("isDateOnly accepts real calendar days only", () => {
    expect(isDateOnly("2026-10-11")).toBe(true);
    expect(isDateOnly("2026-02-28")).toBe(true);
    expect(isDateOnly("2026-02-31")).toBe(false);
    expect(isDateOnly("2026-2-3")).toBe(false);
    expect(isDateOnly("11/10/2026")).toBe(false);
    expect(isDateOnly(null)).toBe(false);
  });
});

describe("due / overdue in the user's own zone", () => {
  test("classifies overdue, due today and upcoming", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    expect(followUpState("2026-10-08", "UTC", now)).toEqual({
      kind: "overdue",
      days: 3,
      localDate: "2026-10-11",
    });
    expect(followUpState("2026-10-11", "UTC", now)).toEqual({
      kind: "due_today",
      days: 0,
      localDate: "2026-10-11",
    });
    expect(followUpState("2026-10-20", "UTC", now)).toEqual({
      kind: "upcoming",
      days: 9,
      localDate: "2026-10-11",
    });
    expect(followUpState(null, "UTC", now)).toEqual({ kind: "none" });
    expect(followUpState("not-a-date", "UTC", now)).toEqual({ kind: "none" });
  });

  test("THE SAME follow-up date is due in one user's zone and not in another's", () => {
    // The owner's "use the user's timezone" requirement, as a boundary: at
    // 02:00Z on Oct 11, a follow-up dated Oct 11 is
    //   * NOT due for a New York user (their local day is still Oct 10), and
    //   * due for a UTC or Auckland user.
    const now = new Date("2026-10-11T02:00:00Z");
    expect(reminderDue("2026-10-11", "America/New_York", now)).toBe(false);
    expect(reminderDue("2026-10-11", "UTC", now)).toBe(true);
    expect(reminderDue("2026-10-11", "Pacific/Auckland", now)).toBe(true);
    // And the local day AFTER the due date is still due (overdue), so a once-a-day
    // worker can never skip a window permanently.
    expect(reminderDue("2026-10-10", "America/New_York", now)).toBe(true);
    expect(reminderDue("2026-10-09", "America/New_York", now)).toBe(true);
  });

  test("an unset / unusable follow-up date is never due", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    expect(reminderDue(null, "UTC", now)).toBe(false);
    expect(reminderDue("", "UTC", now)).toBe(false);
    expect(reminderDue("2026-13-45", "UTC", now)).toBe(false);
  });
});

describe("the idempotency key identifies ONE delivery window", () => {
  test("the same (user, saved bid, due date) always builds the same key", () => {
    expect(reminderIdempotencyKey(7, 42, "2026-10-11")).toBe("7:42:2026-10-11");
    expect(reminderIdempotencyKey(7, 42, "2026-10-11")).toBe(
      reminderIdempotencyKey(7, 42, "2026-10-11"),
    );
  });

  test("every part of the window changes the key — including the user", () => {
    const base = reminderIdempotencyKey(1, 2, "2026-10-11");
    expect(reminderIdempotencyKey(2, 2, "2026-10-11")).not.toBe(base);
    expect(reminderIdempotencyKey(1, 3, "2026-10-11")).not.toBe(base);
    // Moving the follow-up date is a NEW window (the user legitimately gets a new
    // reminder); the old window stays closed.
    expect(reminderIdempotencyKey(1, 2, "2026-10-12")).not.toBe(base);
    // Users cannot collide by concatenation (1:12 vs 11:2).
    expect(reminderIdempotencyKey(1, 12, "2026-10-11")).not.toBe(
      reminderIdempotencyKey(11, 2, "2026-10-11"),
    );
  });
});

describe("decideDelivery — the duplicate rule", () => {
  test("no ledger row → send (a brand new window)", () => {
    expect(decideDelivery(null)).toEqual({ action: "send", reason: "new" });
  });

  test("an already delivered window is NEVER emailed again", () => {
    expect(decideDelivery(ledger({ delivered_at: "2026-10-11T12:00:00Z", attempt_count: 1 }))).toEqual(
      { action: "skip", reason: "already_delivered" },
    );
    // Even a delivered row that also carries an old error stays skipped.
    expect(
      decideDelivery(
        ledger({ delivered_at: "2026-10-11T12:00:00Z", attempt_count: 2, last_error: "old" }),
      ).action,
    ).toBe("skip");
  });

  test("a claim whose attempt never started may be attempted", () => {
    expect(decideDelivery(ledger({ attempt_count: 0 }))).toEqual({
      action: "send",
      reason: "claimed_not_attempted",
    });
  });

  test("an UNCONFIRMED attempt is never retried (a possibly-lost mail beats a duplicate)", () => {
    // The crash window: the attempt was recorded, the outcome never was. This is the
    // single most important branch for the owner's "retries must not re-email".
    expect(decideDelivery(ledger({ attempt_count: 1, last_error: null }))).toEqual({
      action: "skip",
      reason: "attempt_unconfirmed",
    });
    expect(decideDelivery(ledger({ attempt_count: 2, last_error: null })).action).toBe("skip");
  });

  test("a DEFINITE provider failure is retried, and retrying reuses the same row", () => {
    expect(decideDelivery(ledger({ attempt_count: 1, last_error: "provider 500" }))).toEqual({
      action: "retry",
      reason: "last_attempt_failed",
    });
  });

  test("the attempt ceiling ends the retries", () => {
    expect(
      decideDelivery(ledger({ attempt_count: REMINDER_MAX_ATTEMPTS, last_error: "provider 500" })),
    ).toEqual({ action: "skip", reason: "max_attempts" });
    expect(
      decideDelivery(ledger({ attempt_count: REMINDER_MAX_ATTEMPTS + 3, last_error: "provider 500" }))
        .action,
    ).toBe("skip");
  });

  test("a malformed attempt count is treated as 'never attempted', never as delivered", () => {
    expect(decideDelivery(ledger({ attempt_count: Number.NaN })).action).toBe("send");
    expect(decideDelivery(ledger({ attempt_count: -1 })).action).toBe("send");
  });
});

describe("opt-in gate and the recipient", () => {
  test("both the entitlement flag AND an explicit opt-in are required", () => {
    expect(reminderEligible({ access: { reminders: true }, optIn: true })).toBe(true);
    expect(reminderEligible({ access: { reminders: true }, optIn: false })).toBe(false);
    expect(reminderEligible({ access: { reminders: true }, optIn: null })).toBe(false);
    expect(reminderEligible({ access: { reminders: true }, optIn: undefined })).toBe(false);
    expect(reminderEligible({ access: { reminders: false }, optIn: true })).toBe(false);
    // Access not resolved (null) is NOT entitled — never a fail-open.
    expect(reminderEligible({ access: null, optIn: true })).toBe(false);
    expect(reminderEligible({ access: undefined, optIn: true })).toBe(false);
  });

  test("reserved and QA addresses are not deliverable recipients", () => {
    expect(deliverableEmail("owner@example-real.com")).toBe(true);
    expect(deliverableEmail("Owner@Contrax.Company")).toBe(true);
    expect(deliverableEmail("qacrm1@test.contrax")).toBe(false);
    expect(deliverableEmail("someone@example.com")).toBe(false);
    expect(deliverableEmail("someone@example.org")).toBe(false);
    expect(deliverableEmail("someone@example.net")).toBe(false);
    expect(deliverableEmail("someone@host.invalid")).toBe(false);
    expect(deliverableEmail("not-an-email")).toBe(false);
    expect(deliverableEmail("a@b")).toBe(false);
    expect(deliverableEmail("")).toBe(false);
    expect(deliverableEmail(null)).toBe(false);
    expect(deliverableEmail(42)).toBe(false);
  });
});

describe("the in-app lists", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const items = [
    { saved_match_id: 1, bid_id: 11, title: "A", follow_up_date: "2026-10-08", next_action: "" },
    { saved_match_id: 2, bid_id: 12, title: "B", follow_up_date: "2026-10-14", next_action: "email CO" },
    { saved_match_id: 3, bid_id: 13, title: "C", follow_up_date: null, next_action: "" },
    { saved_match_id: 4, bid_id: 14, title: "D", follow_up_date: "2026-10-11", next_action: "" },
    { saved_match_id: 5, bid_id: 15, title: "E", follow_up_date: "2026-10-05", next_action: "" },
  ];

  test("splits into overdue (most overdue first) and upcoming (soonest first)", () => {
    const lists = buildReminderLists(items, "UTC", now);
    expect(lists.overdue.map((r) => r.saved_match_id)).toEqual([5, 1]);
    expect(lists.overdue.map((r) => r.days)).toEqual([6, 3]);
    // 'due today' is listed with the not-yet-overdue ones, at days 0.
    expect(lists.upcoming.map((r) => r.saved_match_id)).toEqual([4, 2]);
    expect(lists.upcoming.map((r) => r.days)).toEqual([0, 3]);
    expect(lists.upcoming[0]!.kind).toBe("due_today");
  });

  test("a saved bid with no follow-up date is not a reminder at all", () => {
    const lists = buildReminderLists(items, "UTC", now);
    const ids = [...lists.overdue, ...lists.upcoming].map((r) => r.saved_match_id);
    expect(ids).not.toContain(3);
  });

  test("the SAME items bucket differently for a user in another zone", () => {
    // At 02:00Z the New York user's local day is Oct 10, so Oct 11 is still ahead.
    const early = new Date("2026-10-11T02:00:00Z");
    const ny = buildReminderLists(items, "America/New_York", early);
    const utc = buildReminderLists(items, "UTC", early);
    expect(ny.upcoming.map((r) => r.saved_match_id)).toContain(4); // due Oct 11 → tomorrow-ish
    expect(ny.overdue.map((r) => r.saved_match_id)).toEqual([5, 1]);
    expect(utc.upcoming.map((r) => r.saved_match_id)).toContain(4);
    expect(utc.upcoming.find((r) => r.saved_match_id === 4)!.kind).toBe("due_today");
    expect(ny.upcoming.find((r) => r.saved_match_id === 4)!.kind).toBe("upcoming");
  });

  test("an empty pipeline yields two empty lists", () => {
    expect(buildReminderLists([], "UTC", now)).toEqual({ overdue: [], upcoming: [] });
  });

  test("timezoneOptions always contains the current value first", () => {
    const options = timezoneOptions("Pacific/Auckland");
    expect(options[0]).toBe("Pacific/Auckland");
    expect(options).toContain("UTC");
    expect(new Set(options).size).toBe(options.length);
  });
});
