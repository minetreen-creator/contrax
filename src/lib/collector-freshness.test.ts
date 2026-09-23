/**
 * FIX ② REGRESSION PINS — a dead / failing collector must never be reported
 * FRESH, and an HONEST zero must still be distinguishable from a dead source
 * (owner-locked nationwide correctness fix, 2026-09-23).
 *
 * THE LIVE CASE THIS PINS: `nys_socrata` ran 43 consecutive times (2026-09-13 →
 * 2026-09-23) fetching zero rows with zero errors while both of its data.ny.gov
 * datasets answered HTTP 404 (verified live). Its `collector_staleness` tier was
 * **FRESH** — a dead source presented as a healthy one.
 *
 * DETERMINISTIC BY CONSTRUCTION: pure function + injected `now`; zero network,
 * zero database. Every run record below is the shape the ingest path actually
 * persists in `collector_run_log` (read verbatim from production during this PR).
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  classifyCollectorTier,
  collectorHealthRows,
  isFreshTier,
  type CollectorRunRecord,
} from "~/lib/collector-freshness";

const NOW = new Date("2026-09-23T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

/** The verbatim `collector_run_log` shape of nys_socrata's latest runs (43 of them). */
const NYS_ROW_AS_RECORDED: CollectorRunRecord = {
  source: "nys_socrata",
  last_run_at: hoursAgo(2.9), // 2026-09-23T09:06:08Z
  rows_fetched: 0,
  ran_zero: true,
  errors: 0,
};

describe("FIX ② — a dead collector is never FRESH", () => {
  test("nys_socrata's RECORDED run (404 swallowed) is no longer FRESH", () => {
    const { tier, reason } = classifyCollectorTier(NYS_ROW_AS_RECORDED, NOW);
    expect(tier).not.toBe("FRESH");
    // A clean run that fetched nothing is an HONEST EMPTY, not a healthy FRESH:
    // we do not hold one row of data from this collector.
    expect(tier).toBe("EMPTY");
    expect(reason).toContain("zero rows");
    expect(isFreshTier(tier)).toBe(false);
  });

  test("the SAME source once the 404 is reported (this PR's fix) is DEAD", () => {
    const { tier, reason } = classifyCollectorTier(
      { ...NYS_ROW_AS_RECORDED, errors: 1 },
      NOW,
    );
    expect(tier).toBe("DEAD");
    expect(reason).toContain("could not be read");
    expect(isFreshTier(tier)).toBe(false);
  });

  test("a fresh timestamp cannot rescue a failing run, however recent", () => {
    for (const at of [hoursAgo(0.1), hoursAgo(1), hoursAgo(24)]) {
      const { tier } = classifyCollectorTier(
        { source: "x", last_run_at: at, rows_fetched: 0, ran_zero: true, errors: 3 },
        NOW,
      );
      expect(tier).toBe("DEAD");
    }
  });

  test("a partial failure (errors with rows fetched) is FAILED, never FRESH", () => {
    const { tier, reason } = classifyCollectorTier(
      { source: "oh", last_run_at: hoursAgo(3), rows_fetched: 25, ran_zero: false, errors: 2 },
      NOW,
    );
    expect(tier).toBe("FAILED");
    expect(reason).toContain("2 error(s)");
    expect(isFreshTier(tier)).toBe(false);
  });

  test("DEAD and EMPTY are different states (the audit's taxonomy)", () => {
    const dead = classifyCollectorTier({ ...NYS_ROW_AS_RECORDED, errors: 1 }, NOW).tier;
    const empty = classifyCollectorTier({ ...NYS_ROW_AS_RECORDED, errors: 0 }, NOW).tier;
    expect(dead).toBe("DEAD");
    expect(empty).toBe("EMPTY");
    expect(dead).not.toBe(empty);
  });

  test("the honest-zero 4841xx pass shape is EMPTY — not DEAD, not FRESH", () => {
    // A trucking pass that ran, reached its source, and legitimately matched
    // nothing: rows_fetched = 0, errors = 0. It must not be libelled a dead
    // source, and it must not claim freshness either.
    const { tier, reason } = classifyCollectorTier(
      { source: "sam_naics_484110", last_run_at: hoursAgo(5), rows_fetched: 0, ran_zero: true, errors: 0 },
      NOW,
    );
    expect(tier).toBe("EMPTY");
    expect(reason).not.toContain("could not be read");
  });
});

describe("FIX ② — the healthy tiers are unchanged", () => {
  test("a clean recent run with rows is FRESH", () => {
    const { tier } = classifyCollectorTier(
      { source: "oh", last_run_at: hoursAgo(2), rows_fetched: 25, ran_zero: false, errors: 0 },
      NOW,
    );
    expect(tier).toBe("FRESH");
    expect(isFreshTier(tier)).toBe(true);
  });

  test("48h/7d boundaries behave as documented (48h is still FRESH, 48h+1m is STALE)", () => {
    const fresh = classifyCollectorTier(
      { source: "oh", last_run_at: hoursAgo(48), rows_fetched: 25, errors: 0 },
      NOW,
    );
    // ONE MINUTE PAST the 48h boundary, in milliseconds: 48 * 3_600_000 + 60_000.
    // (The first cut of this fixture wrote `(48 * 60 + 600) * 1000` = 58 MINUTES
    // ago — well inside the window, hence legitimately FRESH. The pin's intent is
    // the boundary itself, so the hour multiplier has to be here.)
    const stale = classifyCollectorTier(
      { source: "oh", last_run_at: new Date(NOW.getTime() - (48 * 3_600_000 + 60_000)).toISOString(), rows_fetched: 25, errors: 0 },
      NOW,
    );
    const sevenDays = classifyCollectorTier(
      { source: "oh", last_run_at: hoursAgo(7 * 24), rows_fetched: 25, errors: 0 },
      NOW,
    );
    const critical = classifyCollectorTier(
      { source: "oh", last_run_at: hoursAgo(7 * 24 + 1), rows_fetched: 25, errors: 0 },
      NOW,
    );
    expect(fresh.tier).toBe("FRESH");
    expect(stale.tier).toBe("STALE");
    expect(sevenDays.tier).toBe("STALE");
    expect(critical.tier).toBe("CRITICAL");
  });

  test("never-run is CRITICAL, and a missing last_run_at is never FRESH", () => {
    expect(classifyCollectorTier(null, NOW).tier).toBe("CRITICAL");
    expect(classifyCollectorTier(undefined, NOW).tier).toBe("CRITICAL");
    expect(classifyCollectorTier({ source: "sam_gov", last_run_at: null }, NOW).tier).toBe("CRITICAL");
  });

  test("an unparsable timestamp is CRITICAL, never FRESH", () => {
    expect(classifyCollectorTier({ source: "x", last_run_at: "not-a-date", rows_fetched: 9 }, NOW).tier).toBe(
      "CRITICAL",
    );
  });
});

describe("FIX ② — the run-level health table", () => {
  test("one mixed run: healthy sources keep their tier, the dead one is surfaced", () => {
    const health = collectorHealthRows(
      [
        { source: "oh", last_run_at: hoursAgo(1), rows_fetched: 25, errors: 0 },
        { source: "sam_naics_484110", last_run_at: hoursAgo(1), rows_fetched: 0, ran_zero: true, errors: 0 },
        { source: "nys_socrata", last_run_at: hoursAgo(1), rows_fetched: 0, ran_zero: true, errors: 1 },
        { source: "va_evirginia", last_run_at: hoursAgo(1), rows_fetched: 7, errors: 0 },
      ],
      NOW,
    );
    expect(health.map((h) => [h.source, h.tier])).toEqual([
      ["oh", "FRESH"],
      ["sam_naics_484110", "EMPTY"],
      ["nys_socrata", "DEAD"],
      ["va_evirginia", "FRESH"],
    ]);
    const dead = health.filter((h) => h.tier === "DEAD").map((h) => h.source);
    expect(dead).toEqual(["nys_socrata"]);
    expect(health.map((h) => h.last_run_at)).toEqual([
      hoursAgo(1),
      hoursAgo(1),
      hoursAgo(1),
      hoursAgo(1),
    ]);
  });
});

describe("FIX ② — the SQL view (migration 049) applies the same rule", () => {
  const sql = readFileSync(
    new URL("../../db/migrations/049_collector_staleness_honest_tiers.sql", import.meta.url),
    "utf8",
  );
  const deadCase = "WHEN errors > 0 AND rows_fetched = 0 THEN 'DEAD'";
  const failedCase = "WHEN errors > 0 THEN 'FAILED'";
  const emptyCase = "WHEN rows_fetched = 0 THEN 'EMPTY'";
  const freshCase = "WHEN ran_at >= now() - interval '48 hours' THEN 'FRESH'";
  const staleCase = "WHEN ran_at >= now() - interval '7 days' THEN 'STALE'";

  test("the view carries every tier branch, in the same precedence as the classifier", () => {
    for (const branch of [deadCase, failedCase, emptyCase, freshCase, staleCase]) {
      expect(sql).toContain(branch);
    }
    const at = (s: string) => {
      const i = sql.indexOf(s);
      expect(i).toBeGreaterThan(-1);
      return i;
    };
    expect(at(deadCase)).toBeLessThan(at(failedCase));
    expect(at(failedCase)).toBeLessThan(at(emptyCase));
    expect(at(emptyCase)).toBeLessThan(at(freshCase));
    expect(at(freshCase)).toBeLessThan(at(staleCase));
  });

  test("the tier is derived from the LATEST run per source (never a whole-history aggregate)", () => {
    expect(sql).toContain("DISTINCT ON (source)");
    expect(sql).toContain("ORDER BY source, ran_at DESC");
    // The old view aggregated with bool_and(ran_zero)/sum(rows_fetched) across
    // every run — that aggregate cannot express "the last attempt failed".
    expect(sql).not.toContain("bool_and(");
  });

  test("a zero-yield or failing run is decided BEFORE the 48-hour freshness window", () => {
    expect(sql.indexOf(emptyCase)).toBeLessThan(sql.indexOf("interval '48 hours'"));
    expect(sql.indexOf(deadCase)).toBeLessThan(sql.indexOf("interval '48 hours'"));
  });

  test("the window boundaries are INCLUSIVE — the exact twin of the classifier", () => {
    // The classifier is inclusive at both boundaries (`ageHours <= 48` ⇒ FRESH,
    // `<= 7d` ⇒ STALE — pinned above), so the view must not use a STRICT
    // comparison, which would call an exactly-48h run STALE and an exactly-7d
    // run CRITICAL while the TS module says FRESH / STALE. Two definitions of one
    // rule may never disagree, not even at the instant of the boundary.
    expect(sql).not.toContain("ran_at > now() - interval '48 hours'");
    expect(sql).not.toContain("ran_at > now() - interval '7 days'");
  });
});
