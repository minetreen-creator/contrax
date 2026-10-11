/**
 * CRM FOLLOW-UP REMINDER WORKER — the sweep (CRM phase 3a, owner handoff 2026-10-10
 * item 4). This suite drives `runCrmReminderSweep()` through its three INJECTED
 * seams (store / entitlement checker / mailer), so it is DETERMINISTIC, ZERO
 * NETWORK and ZERO DATABASE: no `DATABASE_URL`, no `resend`, no `mock.module`
 * (bun's mock registry is process-global and leaks across test files in one run).
 *
 * It pins the owner's sequence and the duplicate rule END TO END:
 *   * opt-out ⇒ no email, and the entitlement check is not even reached;
 *   * a downgraded-but-opted-in account ⇒ no email (the RECHECK blocks the send);
 *   * a due window in the user's own timezone ⇒ exactly one email;
 *   * a window in the future ⇒ no email and no ledger row;
 *   * running the same sweep twice ⇒ ONE email total (the ledger, not luck);
 *   * a racing second worker ⇒ no second email;
 *   * a crashed attempt with no recorded outcome ⇒ no second email;
 *   * a DEFINITE failure ⇒ retried on the next run, still exactly one email;
 *   * the ceiling ⇒ retries stop;
 *   * `is_admin` reaches the checker (the phase-1 bypass path).
 *
 * The entitlement objects below are LITERAL `CrmAccess` values rather than calls
 * into `computeCrmAccess()`. That is deliberate: this file must be runnable anywhere,
 * and importing src/lib/crm-access.server.ts pulls in src/lib/trial.ts →
 * `@tanstack/react-start`, which the sandbox's partially-installed node_modules
 * cannot resolve (the phase-1 suite src/lib/crm-access.test.ts fails locally for the
 * same reason and is green in CI). The REAL ladder — including that
 * `reminders` is true only for Professional/admin/demo — is pinned by
 * src/lib/crm-access.test.ts, which CI names; and the worker never computes a tier
 * itself: it asks `deps.entitlement.check()`, whose production implementation IS
 * `getCrmAccess()`.
 */
import { describe, expect, test } from "bun:test";
import {
  runCrmReminderSweep,
  type CrmReminderStore,
  type ReminderCandidateRow,
  type ReminderClaimInput,
  type ReminderDeliveryRecord,
  type ReminderEmailItem,
  type ReminderEntitlementChecker,
  type ReminderFollowUpRow,
  type ReminderMailer,
} from "./crm-reminders-sweep";
import { reminderIdempotencyKey } from "./crm-reminders";

/** The phase-1 CrmAccess shape, as literals (see the header note). */
interface Access {
  tier: "basic" | "starter" | "professional";
  canEdit: boolean;
  relationshipHistory: boolean;
  reminders: boolean;
  aiDrafts: boolean;
  contactLimit: number;
}
function access(over: Partial<Access> = {}): Access {
  return {
    tier: "basic",
    canEdit: false,
    relationshipHistory: false,
    reminders: false,
    aiDrafts: false,
    contactLimit: 0,
    ...over,
  };
}
/** A paying Professional account: the only tier the tier table gives reminders. */
function professionalAccess(): Access {
  return access({ tier: "professional", canEdit: true, relationshipHistory: true, reminders: true, aiDrafts: true, contactLimit: 1000 });
}
/** A free Basic account: no entitlement at all. */
function basicAccess(): Access {
  return access();
}
/** A Starter account: can edit contacts, but reminders are Professional-only. */
function starterAccess(): Access {
  return access({ tier: "starter", canEdit: true, contactLimit: 100 });
}
/**
 * An account whose Professional subscription/trial lapsed: the real ladder
 * (`computeTrialStatus` + `computeCrmAccess`, pinned by src/lib/crm-access.test.ts)
 * collapses it to basic — i.e. `reminders: false`, which is what the worker sees.
 */
function lapsedProfessionalAccess(): Access {
  return access();
}

// ── Fakes ────────────────────────────────────────────────────────────────────
interface LedgerEntry extends ReminderDeliveryRecord {
  user_id: number;
  saved_match_id: number;
  due_on: string;
}

class FakeStore implements CrmReminderStore {
  candidates: ReminderCandidateRow[] = [];
  followUps = new Map<number, ReminderFollowUpRow[]>();
  ledger = new Map<string, LedgerEntry>();
  /** Every claim attempt (proves a claim was made before a send). */
  claimCalls = 0;
  /** When true every claim "loses" — a second worker won the race. */
  loseClaims = false;
  /** User ids whose follow-up read throws (fail-soft proof). */
  throwOnFollowUps = new Set<number>();
  private nextId = 1;

  async listCandidates(limit: number) {
    return this.candidates.slice(0, limit);
  }
  async listFollowUps(userId: number) {
    if (this.throwOnFollowUps.has(userId)) throw new Error("follow-up read exploded");
    return this.followUps.get(userId) ?? [];
  }
  async getDelivery(idempotencyKey: string) {
    const entry = this.ledger.get(idempotencyKey);
    return entry ? { ...entry } : null;
  }
  async claimDelivery(input: ReminderClaimInput) {
    this.claimCalls += 1;
    if (this.loseClaims || this.ledger.has(input.idempotencyKey)) return null;
    const id = this.nextId++;
    this.ledger.set(input.idempotencyKey, {
      id,
      idempotency_key: input.idempotencyKey,
      delivered_at: null,
      attempt_count: 0,
      last_error: null,
      user_id: input.userId,
      saved_match_id: input.savedMatchId,
      due_on: input.dueOn,
    });
    return id;
  }
  async beginAttempt(id: number) {
    const entry = this.byId(id);
    entry.attempt_count += 1;
    return entry.attempt_count;
  }
  async markDelivered(id: number, at: Date) {
    const entry = this.byId(id);
    entry.delivered_at = at.toISOString();
    entry.last_error = null;
  }
  async markFailed(id: number, error: string) {
    this.byId(id).last_error = error;
  }
  /** Pre-seed a ledger row (a previous run's state). */
  seed(entry: Partial<LedgerEntry> & { idempotency_key: string }): LedgerEntry {
    const row: LedgerEntry = {
      id: this.nextId++,
      idempotency_key: entry.idempotency_key,
      delivered_at: null,
      attempt_count: 0,
      last_error: null,
      user_id: 1,
      saved_match_id: 0,
      due_on: "2026-10-11",
      ...entry,
    };
    this.ledger.set(row.idempotency_key, row);
    return row;
  }
  entries(): LedgerEntry[] {
    return [...this.ledger.values()];
  }
  private byId(id: number): LedgerEntry {
    for (const entry of this.ledger.values()) if (entry.id === id) return entry;
    throw new Error(`no ledger row with id ${id}`);
  }
}

class FakeMailer implements ReminderMailer {
  sends: Array<{ to: string; items: ReminderEmailItem[] }> = [];
  fail = false;
  async send(to: string, items: ReminderEmailItem[]) {
    this.sends.push({ to, items });
    return this.fail ? { ok: false as const, error: "provider 500" } : { ok: true as const };
  }
}

class FakeEntitlement implements ReminderEntitlementChecker {
  /** Every (id, is_admin) pair the sweep asked about — in order. */
  checks: Array<{ id: number; is_admin: boolean }> = [];
  access: Access = professionalAccess();
  /** User ids whose entitlement read throws. */
  throwOn = new Set<number>();
  async check(user: { id: number; is_admin: boolean }) {
    this.checks.push({ id: user.id, is_admin: user.is_admin });
    if (this.throwOn.has(user.id)) throw new Error("entitlement read exploded");
    return { access: this.access };
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
const NOW = new Date("2026-10-11T12:00:00Z");
const DUE_DATE = "2026-10-11";
const KEY = reminderIdempotencyKey(1, 100, DUE_DATE);

function candidate(over: Partial<ReminderCandidateRow> = {}): ReminderCandidateRow {
  return {
    user_id: 1,
    email: "owner@example-real.com",
    is_admin: false,
    reminders_opt_in: true,
    timezone: "UTC",
    ...over,
  };
}
function followUp(over: Partial<ReminderFollowUpRow> = {}): ReminderFollowUpRow {
  return {
    saved_match_id: 100,
    bid_id: 500,
    title: "City janitorial contract",
    follow_up_date: DUE_DATE,
    next_action: "Email the procurement contact",
    source_url: "https://example.gov/bid/500",
    ...over,
  };
}

interface Harness {
  store: FakeStore;
  mailer: FakeMailer;
  entitlement: FakeEntitlement;
}
function harness(candidates: ReminderCandidateRow[], followUps: ReminderFollowUpRow[] = [followUp()]): Harness {
  const store = new FakeStore();
  store.candidates = candidates;
  for (const candidate of candidates) store.followUps.set(candidate.user_id, followUps);
  return { store, mailer: new FakeMailer(), entitlement: new FakeEntitlement() };
}
function sweep(h: Harness, now: Date = NOW) {
  return runCrmReminderSweep({
    store: h.store,
    entitlement: h.entitlement,
    mailer: h.mailer,
    now,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("opt-in and entitlement gates", () => {
  test("an account that has NOT opted in is never emailed, and is not even entitlement-checked", async () => {
    const h = harness([candidate({ reminders_opt_in: false })]);
    const result = await sweep(h);
    expect(h.mailer.sends).toHaveLength(0);
    expect(h.store.claimCalls).toBe(0);
    expect(h.entitlement.checks).toHaveLength(0);
    expect(result.usersSkippedOptOut).toBe(1);
    expect(result.emailsSent).toBe(0);
  });

  test("a DOWNGRADE after opting in blocks delivery — the recheck happens before any send", async () => {
    const h = harness([candidate()]);
    h.entitlement.access = basicAccess();
    const result = await sweep(h);
    expect(h.entitlement.checks).toEqual([{ id: 1, is_admin: false }]);
    expect(h.mailer.sends).toHaveLength(0);
    expect(h.store.claimCalls).toBe(0);
    expect(result.usersSkippedUnentitled).toBe(1);
  });

  test("Starter and a LAPSED Professional account are not reminder-entitled", async () => {
    for (const next of [starterAccess(), lapsedProfessionalAccess()]) {
      const h = harness([candidate()]);
      h.entitlement.access = next;
      const result = await sweep(h);
      expect(h.mailer.sends).toHaveLength(0);
      expect(result.usersSkippedUnentitled).toBe(1);
    }
  });

  test("an unreadable entitlement fails CLOSED (no email) and the run continues", async () => {
    const h = harness([candidate({ user_id: 1 }), candidate({ user_id: 2 })]);
    h.entitlement.throwOn = new Set([1]);
    const result = await sweep(h);
    expect(h.mailer.sends.map((s) => s.to)).toEqual(["owner@example-real.com"]);
    expect(result.usersSkippedUnentitled).toBe(1);
    expect(result.emailsSent).toBe(1);
  });

  test("a QA/reserved recipient address is skipped without consulting entitlement", async () => {
    const h = harness([candidate({ email: "qacrm1@test.contrax" })]);
    const result = await sweep(h);
    expect(h.mailer.sends).toHaveLength(0);
    expect(h.entitlement.checks).toHaveLength(0);
    expect(result.usersSkippedEmail).toBe(1);
  });

  test("is_admin reaches the entitlement checker (the phase-1 bypass path)", async () => {
    const h = harness([candidate({ is_admin: true })]);
    await sweep(h);
    expect(h.entitlement.checks).toEqual([{ id: 1, is_admin: true }]);
  });
});

describe("due, in the user's timezone", () => {
  test("a due window sends exactly one email with the follow-up's own facts", async () => {
    const h = harness([candidate()]);
    const result = await sweep(h);
    expect(result.emailsSent).toBe(1);
    expect(h.mailer.sends).toHaveLength(1);
    expect(h.mailer.sends[0]!.to).toBe("owner@example-real.com");
    expect(h.mailer.sends[0]!.items).toEqual([
      {
        title: "City janitorial contract",
        follow_up_date: DUE_DATE,
        next_action: "Email the procurement contact",
        source_url: "https://example.gov/bid/500",
      },
    ]);
    // The claim happened BEFORE the send.
    expect(h.store.claimCalls).toBe(1);
    const row = h.store.ledger.get(KEY)!;
    expect(row.attempt_count).toBe(1);
    expect(row.delivered_at).toBe(NOW.toISOString());
  });

  test("an OVERDUE follow-up is still delivered (a daily run must not skip it)", async () => {
    const h = harness([candidate()], [followUp({ follow_up_date: "2026-10-05" })]);
    const result = await sweep(h);
    expect(result.windowsDue).toBe(1);
    expect(result.emailsSent).toBe(1);
  });

  test("a future follow-up sends nothing and writes no ledger row", async () => {
    const h = harness([candidate()], [followUp({ follow_up_date: "2026-10-20" })]);
    const result = await sweep(h);
    expect(result.followUpsConsidered).toBe(1);
    expect(result.windowsDue).toBe(0);
    expect(h.mailer.sends).toHaveLength(0);
    expect(h.store.entries()).toHaveLength(0);
  });

  test("the SAME window is not due for a New York user at 02:00Z", async () => {
    const early = new Date("2026-10-11T02:00:00Z");
    const ny = harness([candidate({ timezone: "America/New_York" })]);
    const nyResult = await sweep(ny, early);
    expect(nyResult.windowsDue).toBe(0);
    expect(ny.mailer.sends).toHaveLength(0);

    const utc = harness([candidate({ timezone: "UTC" })]);
    const utcResult = await sweep(utc, early);
    expect(utcResult.windowsDue).toBe(1);
    expect(utc.mailer.sends).toHaveLength(1);
  });

  test("an unusable stored timezone falls back to UTC instead of throwing", async () => {
    const h = harness([candidate({ timezone: "Mars/Phobos" })]);
    const result = await sweep(h);
    expect(result.emailsSent).toBe(1);
  });
});

describe("the ledger makes a duplicate impossible", () => {
  test("RUNNING THE SAME SWEEP TWICE sends ONE email total", async () => {
    const h = harness([candidate()]);
    const first = await sweep(h);
    const second = await sweep(h);
    expect(first.emailsSent).toBe(1);
    expect(second.emailsSent).toBe(0);
    expect(second.windowsSkipped).toBe(1);
    expect(h.mailer.sends).toHaveLength(1);
    expect(h.store.entries()).toHaveLength(1);
    // The second run did not even claim: the delivered row skipped it.
    expect(h.store.claimCalls).toBe(1);
  });

  test("a delivered row is never emailed again even if the run repeats forever", async () => {
    const h = harness([candidate()]);
    h.store.seed({
      idempotency_key: KEY,
      delivered_at: "2026-10-11T12:00:00Z",
      attempt_count: 1,
      saved_match_id: 100,
    });
    for (let i = 0; i < 3; i += 1) await sweep(h);
    expect(h.mailer.sends).toHaveLength(0);
    expect(h.store.entries()).toHaveLength(1);
  });

  test("a RACING worker that won the claim stops the second one (no duplicate)", async () => {
    const h = harness([candidate()]);
    h.store.loseClaims = true; // another run inserted the same key first
    const result = await sweep(h);
    expect(result.emailsSent).toBe(0);
    expect(result.windowsSkipped).toBe(1);
    expect(h.mailer.sends).toHaveLength(0);
  });

  test("a CRASHED attempt with no recorded outcome is never retried (no duplicate)", async () => {
    const h = harness([candidate()]);
    h.store.seed({ idempotency_key: KEY, attempt_count: 1, last_error: null, saved_match_id: 100 });
    const result = await sweep(h);
    expect(h.mailer.sends).toHaveLength(0);
    expect(result.windowsSkipped).toBe(1);
    expect(result.emailsSent).toBe(0);
    // The ledger row is untouched: no new attempt was recorded.
    expect(h.store.ledger.get(KEY)!.attempt_count).toBe(1);
  });

  test("a DEFINITE failure is retried once and reuses the SAME ledger row", async () => {
    const h = harness([candidate()]);
    h.mailer.fail = true;
    const failed = await sweep(h);
    expect(failed.failures).toBe(1);
    expect(failed.emailsSent).toBe(0);
    const row = h.store.ledger.get(KEY)!;
    expect(row.attempt_count).toBe(1);
    expect(row.delivered_at).toBe(null);
    expect(row.last_error).toBe("provider 500");
    expect(h.store.entries()).toHaveLength(1);

    // The provider recovers: the next run retries the SAME window.
    h.mailer.fail = false;
    const retried = await sweep(h);
    expect(retried.windowsRetried).toBe(1);
    expect(retried.emailsSent).toBe(1);
    // TWO send attempts, still exactly ONE ledger row — and therefore one delivery.
    expect(h.mailer.sends).toHaveLength(2);
    expect(h.store.entries()).toHaveLength(1);
    expect(h.store.ledger.get(KEY)!.attempt_count).toBe(2);
    expect(h.store.ledger.get(KEY)!.delivered_at).toBe(NOW.toISOString());
  });

  test("retries stop at the ceiling", async () => {
    const h = harness([candidate()]);
    h.mailer.fail = true;
    h.store.seed({ idempotency_key: KEY, attempt_count: 3, last_error: "provider 500", saved_match_id: 100 });
    const result = await sweep(h);
    expect(h.mailer.sends).toHaveLength(0);
    expect(result.windowsSkipped).toBe(1);
  });

  test("moving a follow-up date is a NEW window (one email per date, never per run)", async () => {
    const store = new FakeStore();
    const candidateRow = candidate();
    store.candidates = [candidateRow];
    store.followUps.set(1, [followUp()]);
    const mailer = new FakeMailer();
    const entitlement = new FakeEntitlement();
    const base = { store, entitlement, mailer, now: NOW };

    await runCrmReminderSweep(base);
    // The user moves the follow-up date out to Oct 14 (still with the same saved bid).
    store.followUps.set(1, [followUp({ follow_up_date: "2026-10-14" })]);
    await runCrmReminderSweep({ ...base, now: new Date("2026-10-14T12:00:00Z") });

    expect(mailer.sends).toHaveLength(2);
    expect(store.entries()).toHaveLength(2);
    expect(store.entries().map((e) => e.due_on).sort()).toEqual(["2026-10-11", "2026-10-14"]);

    // Re-running on the new day does NOT re-send the Oct 14 window.
    await runCrmReminderSweep({ ...base, now: new Date("2026-10-14T18:00:00Z") });
    expect(mailer.sends).toHaveLength(2);
  });

  test("two saved bids due the same day are two windows, two emails, two rows", async () => {
    const h = harness([candidate()], [
      followUp({ saved_match_id: 100, bid_id: 500 }),
      followUp({ saved_match_id: 101, bid_id: 501, title: "Second bid" }),
    ]);
    const result = await sweep(h);
    expect(result.windowsDue).toBe(2);
    expect(result.emailsSent).toBe(2);
    expect(h.store.entries()).toHaveLength(2);
    expect(h.store.entries().map((e) => e.saved_match_id).sort()).toEqual([100, 101]);
  });
});

describe("fail-soft and accounting", () => {
  test("one account's failure never stops the next account", async () => {
    const store = new FakeStore();
    const a = candidate({ user_id: 1 });
    const b = candidate({ user_id: 2, email: "second@example-real.com" });
    store.candidates = [a, b];
    store.followUps.set(1, [followUp()]);
    store.followUps.set(2, [followUp({ saved_match_id: 200 })]);
    store.throwOnFollowUps = new Set([1]);
    const mailer = new FakeMailer();
    const entitlement = new FakeEntitlement();
    const result = await runCrmReminderSweep({ store, entitlement, mailer, now: NOW });
    expect(mailer.sends.map((s) => s.to)).toEqual(["second@example-real.com"]);
    expect(result.failures).toBe(1);
    expect(result.emailsSent).toBe(1);
  });

  test("a window whose ledger write throws is counted, not fatal", async () => {
    const h = harness([candidate()]);
    h.store.beginAttempt = async () => {
      throw new Error("ledger write exploded");
    };
    const result = await sweep(h);
    expect(result.failures).toBe(1);
    expect(h.mailer.sends).toHaveLength(0);
  });

  test("an account with nothing saved is counted and emails nothing", async () => {
    const h = harness([candidate()], []);
    const result = await sweep(h);
    expect(result.usersChecked).toBe(1);
    expect(result.followUpsConsidered).toBe(0);
    expect(h.mailer.sends).toHaveLength(0);
  });

  test("the run's counters add up on a mixed corpus", async () => {
    const store = new FakeStore();
    store.candidates = [
      candidate({ user_id: 1 }), // due → 1 email
      candidate({ user_id: 2, reminders_opt_in: false }), // opted out
      candidate({ user_id: 3, email: "x@test.contrax" }), // QA recipient
      candidate({ user_id: 4 }), // future only
      candidate({ user_id: 5 }), // entitled-and-due but already delivered
    ];
    store.followUps.set(1, [followUp()]);
    store.followUps.set(2, [followUp({ saved_match_id: 200 })]);
    store.followUps.set(3, [followUp({ saved_match_id: 300 })]);
    store.followUps.set(4, [followUp({ saved_match_id: 400, follow_up_date: "2026-11-01" })]);
    store.followUps.set(5, [followUp({ saved_match_id: 500 })]);
    store.seed({
      idempotency_key: reminderIdempotencyKey(5, 500, DUE_DATE),
      delivered_at: "2026-10-10T12:00:00Z",
      attempt_count: 1,
      saved_match_id: 500,
    });
    const mailer = new FakeMailer();
    const result = await runCrmReminderSweep({
      store,
      entitlement: new FakeEntitlement(),
      mailer,
      now: NOW,
    });
    expect(result.usersChecked).toBe(5);
    expect(result.usersSkippedOptOut).toBe(1);
    expect(result.usersSkippedEmail).toBe(1);
    // Only users 1, 4 and 5 reach their follow-up rows (2 opted out, 3 has a QA
    // address); 4's date is in the future, so exactly TWO windows are due — one sent,
    // one already delivered.
    expect(result.followUpsConsidered).toBe(3);
    expect(result.windowsDue).toBe(2);
    expect(result.emailsSent).toBe(1);
    expect(result.windowsSkipped).toBe(1);
    expect(mailer.sends).toHaveLength(1);
  });
});

describe("preference read/write boundary (pure shape pins)", () => {
  test("the professional access object the checker returns carries the reminders flag", () => {
    expect(professionalAccess()).toMatchObject({ tier: "professional", reminders: true });
    expect(basicAccess()).toMatchObject({ tier: "basic", reminders: false });
    expect(starterAccess()).toMatchObject({ tier: "starter", reminders: false });
  });
});
