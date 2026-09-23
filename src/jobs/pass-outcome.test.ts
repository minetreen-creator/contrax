/**
 * PER-PASS OUTCOME ACCOUNTING — unit suite (nationwide correctness FIX ④, PR B2).
 *
 * PURE, DETERMINISTIC, ZERO NETWORK / ZERO DATABASE. Every record below is a real
 * `collector_run_log` row whose numbers were read SELECT-only from production on
 * 2026-09-23 (the 09:05Z sync plus the preceding runs) — see the per-case
 * provenance comment. The point of the suite is that the MEANING of the stored
 * counters is pinned: the same numbers that used to read as "ran fine, produced
 * nothing" must now read as the outcome that actually happened.
 */
import { describe, expect, test } from "bun:test";
import {
  classifyPassOutcome,
  classifyPassOutcomes,
  formatPassOutcomeLine,
  normalizeSkipReasons,
  PASS_OUTCOMES,
  tallyOutcomes,
  type PassRunRecord,
} from "./pass-outcome";
import { DUPLICATE_NOTICE_REASON } from "./notice-identity";

/**
 * The three zero-yield trucking passes + the healthy controls, exactly as stored
 * by the 2026-09-23T09:05Z production sync (`collector_run_log`, read
 * SELECT-only on 2026-09-23). `rows_fetched == fetched_count` in every row.
 */
const LIVE_ROWS_2026_09_23: Record<string, PassRunRecord> = {
  // 3 notices returned by SAM, all 3 refused by the purchased-service gate.
  sam_naics_484110: {
    source: "sam_naics_484110",
    rows_fetched: 3,
    accepted_count: 0,
    skipped_count: 3,
    failed_count: 0,
    rows_new: 0,
    errors: 0,
    ran_zero: false,
    skip_reasons: { product_buy: 3 },
  },
  // SAM reports zero matches for naics=484121 (verbatim live capture: `page.size
  // = 0`, `totalElements = 0`, no `_embedded` at all) — an honest empty.
  sam_naics_484121: {
    source: "sam_naics_484121",
    rows_fetched: 0,
    accepted_count: 0,
    skipped_count: 0,
    failed_count: 0,
    rows_new: 0,
    errors: 0,
    ran_zero: true,
    skip_reasons: {},
  },
  // 1 notice accepted and then suppressed by the cross-source guard: the same
  // notice is already stored under `sam_gov` (ids 30287 / 49292 in production).
  sam_naics_484122: {
    source: "sam_naics_484122",
    rows_fetched: 1,
    accepted_count: 1,
    skipped_count: 0,
    failed_count: 0,
    rows_new: 0,
    errors: 0,
    ran_zero: false,
    skip_reasons: {},
  },
  // Healthy control: 37 fetched, 2 refused, 35 accepted, nothing new (4h re-sync).
  sam_naics_484210: {
    source: "sam_naics_484210",
    rows_fetched: 37,
    accepted_count: 35,
    skipped_count: 2,
    failed_count: 0,
    rows_new: 0,
    errors: 0,
    ran_zero: false,
    skip_reasons: { product_buy: 2 },
  },
  // Healthy control with a genuine new row.
  sam_naics_492110: {
    source: "sam_naics_492110",
    rows_fetched: 116,
    accepted_count: 116,
    skipped_count: 0,
    failed_count: 0,
    rows_new: 1,
    errors: 0,
    ran_zero: false,
    skip_reasons: {},
  },
};

describe("FIX ④ — the three zero-yield trucking passes get three DIFFERENT outcomes", () => {
  test("484110 (SAM returned 3, the gate refused all 3) → all_skipped", () => {
    const r = classifyPassOutcome(LIVE_ROWS_2026_09_23.sam_naics_484110!);
    expect(r.outcome).toBe("all_skipped");
    expect(r.gateSkips).toEqual({ product_buy: 3 });
    expect(r.duplicateNotice).toBe(0);
    expect(r.reason).toContain("pre-insert gate");
    // The counters are NOT re-interpreted — they are named.
    expect([r.fetched, r.accepted, r.skipped, r.failed, r.new]).toEqual([3, 0, 3, 0, 0]);
  });

  test("484121 (SAM reports zero matches) → zero_empty, explicitly NOT an error", () => {
    const r = classifyPassOutcome(LIVE_ROWS_2026_09_23.sam_naics_484121!);
    expect(r.outcome).toBe("zero_empty");
    expect(r.fetched).toBe(0);
    expect(r.errors).toBe(0);
    expect(r.reason).toContain("honest empty");
    expect(r.reason).toContain("EMPTY");
  });

  test("484122 (its one notice is stored under sam_gov) → suppressed_duplicate", () => {
    const r = classifyPassOutcome(LIVE_ROWS_2026_09_23.sam_naics_484122!);
    expect(r.outcome).toBe("suppressed_duplicate");
    expect(r.new).toBe(0);
    expect(r.accepted).toBe(1);
    expect(r.reason).toContain("already represented");
  });

  test("the three outcomes are genuinely distinct (the whole point of the fix)", () => {
    const outcomes = [
      "sam_naics_484110",
      "sam_naics_484121",
      "sam_naics_484122",
    ].map((name) => classifyPassOutcome(LIVE_ROWS_2026_09_23[name]).outcome);
    expect(outcomes).toEqual(["all_skipped", "zero_empty", "suppressed_duplicate"]);
    expect(new Set(outcomes).size).toBe(3);
  });

  test("healthy controls: a pass with no new rows is suppressed_duplicate, not ok", () => {
    expect(classifyPassOutcome(LIVE_ROWS_2026_09_23.sam_naics_484210!).outcome).toBe(
      "suppressed_duplicate",
    );
    const progressed = classifyPassOutcome(LIVE_ROWS_2026_09_23.sam_naics_492110!);
    expect(progressed.outcome).toBe("ok");
    expect(progressed.new).toBe(1);
  });
});

describe("duplicate_notice is ALWAYS reported (the B1 attribution shift)", () => {
  test("a pass whose whole yield the run-level guard claimed → suppressed_duplicate", () => {
    // PR B1: `sam_gov` runs before the trade passes, so a notice inside the
    // national recency window is claimed by it and the trade pass logs
    // `duplicate_notice`. Without this count the pass would look like it found
    // nothing at all.
    const r = classifyPassOutcome({
      source: "sam_naics_484220",
      rows_fetched: 4,
      accepted_count: 0,
      skipped_count: 4,
      failed_count: 0,
      rows_new: 0,
      errors: 0,
      skip_reasons: { [DUPLICATE_NOTICE_REASON]: 4 },
    });
    expect(r.outcome).toBe("suppressed_duplicate");
    expect(r.duplicateNotice).toBe(4);
    expect(r.gateSkips).toEqual({});
    expect(r.reason).toContain("already claimed");
  });

  test("a mixed refusal is all_skipped but still carries its duplicate count", () => {
    const r = classifyPassOutcome({
      source: "sam_psc_v112",
      rows_fetched: 6,
      accepted_count: 0,
      skipped_count: 6,
      failed_count: 0,
      rows_new: 0,
      errors: 0,
      skip_reasons: { product_buy: 2, [DUPLICATE_NOTICE_REASON]: 4 },
    });
    expect(r.outcome).toBe("all_skipped");
    expect(r.duplicateNotice).toBe(4);
    expect(r.gateSkips).toEqual({ product_buy: 2 });
    expect(r.reason).toContain("4 also already claimed");
  });

  test("a productive pass stays ok and still reports its duplicate_notice count", () => {
    const r = classifyPassOutcome({
      source: "sam_naics_561720",
      rows_fetched: 10,
      accepted_count: 8,
      skipped_count: 2,
      failed_count: 0,
      rows_new: 3,
      errors: 0,
      skip_reasons: { [DUPLICATE_NOTICE_REASON]: 2 },
    });
    expect(r.outcome).toBe("ok");
    expect(r.duplicateNotice).toBe(2);
    expect(r.new).toBe(3);
  });

  test("the duplicate reason KEY comes from the guard module (cannot drift)", () => {
    expect(DUPLICATE_NOTICE_REASON).toBe("duplicate_notice");
    const r = classifyPassOutcome({
      source: "x",
      rows_fetched: 1,
      accepted_count: 0,
      skipped_count: 1,
      rows_new: 0,
      skip_reasons: { [DUPLICATE_NOTICE_REASON]: 1 },
    });
    expect(r.duplicateNotice).toBe(1);
  });
});

describe("data_error outranks everything (an unreadable pass is never a zero)", () => {
  test("a mis-shapen response: errors > 0 with zero rows", () => {
    const r = classifyPassOutcome({
      source: "sam_naics_484121",
      rows_fetched: 0,
      accepted_count: 0,
      skipped_count: 0,
      failed_count: 0,
      rows_new: 0,
      errors: 1, // TradeResponseShapeError surfaced by the runner
      ran_zero: true, // the runner still marks the zero …
      skip_reasons: {},
    });
    // … and the OUTCOME is data_error, not zero_empty: that is the fix-②
    // distinction (a DEAD collector must never read as an honest zero).
    expect(r.outcome).toBe("data_error");
    expect(r.errors).toBe(1);
    expect(r.reason).toContain("could not read or persist");
  });

  test("insert failures count as data_error even with rows accepted", () => {
    const r = classifyPassOutcome({
      source: "sam_gov",
      rows_fetched: 400,
      accepted_count: 395,
      skipped_count: 0,
      failed_count: 5,
      rows_new: 12,
      errors: 5,
      skip_reasons: {},
    });
    expect(r.outcome).toBe("data_error");
    expect(r.failed).toBe(5);
  });

  test("no record at all is a data problem, never an honest empty", () => {
    for (const empty of [null, undefined]) {
      const r = classifyPassOutcome(empty);
      expect(r.outcome).toBe("data_error");
      expect(r.source).toBe("(unknown)");
    }
  });
});

describe("purity, determinism and the shape of the reading", () => {
  test("the same record always classifies the same way (deterministic)", () => {
    const record = LIVE_ROWS_2026_09_23.sam_naics_484110!;
    const first = classifyPassOutcome(record);
    const second = classifyPassOutcome({ ...record });
    expect(first).toEqual(second);
  });

  test("the input record is never mutated and jsonb junk is normalized", () => {
    const record: PassRunRecord = {
      source: "s",
      rows_fetched: 2,
      accepted_count: 0,
      skipped_count: 2,
      failed_count: 0,
      rows_new: 0,
      errors: 0,
      skip_reasons: { product_buy: 2, bogus: 0 as number, [DUPLICATE_NOTICE_REASON]: null as any },
    };
    const snapshot = JSON.stringify(record);
    const r = classifyPassOutcome(record);
    expect(JSON.stringify(record)).toBe(snapshot);
    // 0 / null / non-numeric counts are dropped, never invented
    expect(r.gateSkips).toEqual({ product_buy: 2 });
    expect(r.duplicateNotice).toBe(0);
    expect(normalizeSkipReasons({ a: 1, b: 0, c: null as any })).toEqual({ a: 1 });
    expect(normalizeSkipReasons(null)).toEqual({});
  });

  test("string counts (as a DB driver may return them) classify identically", () => {
    const asStrings: PassRunRecord = {
      source: "s",
      rows_fetched: "3" as any,
      accepted_count: "0" as any,
      skipped_count: "3" as any,
      failed_count: "0" as any,
      rows_new: "0" as any,
      errors: "0" as any,
      skip_reasons: { product_buy: 3 },
    };
    expect(classifyPassOutcome(asStrings).outcome).toBe("all_skipped");
  });

  test("the reading keeps the owner's invariant visible (fetched = accepted + skipped + failed)", () => {
    for (const record of Object.values(LIVE_ROWS_2026_09_23)) {
      const r = classifyPassOutcome(record);
      expect(r.fetched).toBe(r.accepted + r.skipped + r.failed);
    }
  });

  test("classifyPassOutcomes preserves input order; tallyOutcomes counts all five keys", () => {
    const readings = classifyPassOutcomes([
      LIVE_ROWS_2026_09_23.sam_naics_492110!,
      LIVE_ROWS_2026_09_23.sam_naics_484121!,
      LIVE_ROWS_2026_09_23.sam_naics_484110!,
      LIVE_ROWS_2026_09_23.sam_naics_484122!,
      LIVE_ROWS_2026_09_23.sam_naics_484210!,
    ]);
    expect(readings.map((r) => r.source)).toEqual([
      "sam_naics_492110",
      "sam_naics_484121",
      "sam_naics_484110",
      "sam_naics_484122",
      "sam_naics_484210",
    ]);
    expect(tallyOutcomes(readings)).toEqual({
      ok: 1,
      all_skipped: 1,
      suppressed_duplicate: 2,
      zero_empty: 1,
      data_error: 0,
    });
    expect(PASS_OUTCOMES).toEqual([
      "ok",
      "all_skipped",
      "suppressed_duplicate",
      "zero_empty",
      "data_error",
    ]);
  });

  test("the printed line carries the outcome, the reason and the exact counters", () => {
    const line = formatPassOutcomeLine(classifyPassOutcome(LIVE_ROWS_2026_09_23.sam_naics_484110!));
    expect(line).toContain("sam_naics_484110: outcome=all_skipped");
    expect(line).toContain("fetched 3 = accepted 0 + skipped 3 + failed 0");
    expect(line).toContain("new 0; duplicate_notice 0");
    expect(line).toContain('"product_buy":3');
  });
});
