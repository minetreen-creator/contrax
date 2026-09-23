/**
 * COLLECTOR HEALTH / FRESHNESS — FIX ② (owner-locked nationwide correctness
 * fix, 2026-09-23): "stop treating dead collectors as fresh".
 *
 * THE BUG (audit + live probe, 2026-09-23): the `nys_socrata` collector is a
 * DEAD source — both of its data.ny.gov SODA datasets answer HTTP 404 (verified
 * live: `e5pk-us93` → 404, `hf3r-utnq` → 404, and `hf3r-utnq` is in fact the LA
 * RAMP dataset id). The list fetch swallowed the 404 and returned an empty
 * array, so the run was recorded as `rows_fetched = 0, errors = 0, ran_zero =
 * true` — indistinguishable from an HONEST zero — and `collector_staleness`
 * (which only looked at `max(ran_at)`) reported **FRESH** for 43 consecutive
 * runs that fetched zero rows (0 bids ever stored). A dead source was therefore
 * indistinguishable, on the health surface, from a healthy one.
 *
 * THE RULE (this module is the single definition; migration 049 applies the same
 * CASE to the `collector_staleness` view):
 *   1. never ran                                → CRITICAL
 *   2. latest run failed AND produced no rows   → DEAD    (could not read it)
 *   3. latest run reported errors, some rows    → FAILED  (partial failure)
 *   4. latest run read cleanly but zero rows    → EMPTY   (honest zero, e.g. the
 *                                                          4841xx passes)
 *   5. otherwise, by the age of the latest run  → FRESH (< 48h) / STALE (≤ 7d)
 *                                                 / CRITICAL (> 7d)
 *
 * Only FRESH / STALE / CRITICAL mean "we hold data from this collector". DEAD,
 * FAILED and EMPTY are all explicitly NOT fresh — a zero-yield or failed
 * collector can never again be reported as fresh, while an honest empty pass is
 * still distinguished from a dead source (the audit's taxonomy).
 *
 * HONESTY NOTES: the classification is a PURE function of the run record and an
 * injected `now` — no clock, no I/O, no database — so it is deterministic in
 * tests; the run-record fields it reads are exactly the ones the ingest path
 * already persists per run (`collector_run_log`), never inferred from the
 * product surface.
 */

export type CollectorTier = "FRESH" | "STALE" | "CRITICAL" | "EMPTY" | "FAILED" | "DEAD";

/** Tiers that assert "this collector is healthy and we hold its data". */
export const HEALTHY_TIERS: readonly CollectorTier[] = ["FRESH", "STALE", "CRITICAL"];

/** The freshness thresholds, shared with the SQL view (migration 049). */
export const FRESH_WINDOW_HOURS = 48;
export const STALE_WINDOW_DAYS = 7;

/** The latest-run fields the classification reads (all persisted per run). */
export interface CollectorRunRecord {
  source?: string | null;
  /** `max(ran_at)` for this source in `collector_run_log`. */
  last_run_at?: string | Date | null;
  /** Rows fetched by the LATEST run. */
  rows_fetched?: number | null;
  /** `collector_run_log.ran_zero` for the latest run (fetched nothing). */
  ran_zero?: boolean | null;
  /** `collector_run_log.errors` count for the latest run. */
  errors?: number | string | null;
}

export interface CollectorHealth {
  source: string;
  tier: CollectorTier;
  /** Human-readable justification, printed with the tier (never a bare label). */
  reason: string;
  last_run_at: string | null;
  rows_fetched: number;
  errors: number;
}

function toCount(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : 0;
}

function toTime(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

/**
 * Classify ONE collector from its latest run record. `now` is injected so the
 * age windows are deterministic under test.
 */
export function classifyCollectorTier(
  run: CollectorRunRecord | null | undefined,
  now: Date,
): { tier: CollectorTier; reason: string } {
  const lastRunAt = toTime(run?.last_run_at);
  if (run == null || lastRunAt === null) {
    return { tier: "CRITICAL", reason: "no run recorded — this collector has never run" };
  }
  const rowsFetched = toCount(run.rows_fetched);
  const errors = toCount(run.errors);
  const ranZero = run.ran_zero === true || rowsFetched <= 0;

  if (errors > 0 && rowsFetched <= 0) {
    return {
      tier: "DEAD",
      reason: `latest run reported ${errors} error(s) and fetched no rows — the source could not be read`,
    };
  }
  if (errors > 0) {
    return {
      tier: "FAILED",
      reason: `latest run reported ${errors} error(s) (${rowsFetched} row(s) fetched)`,
    };
  }
  if (ranZero) {
    return {
      tier: "EMPTY",
      reason: "latest run completed cleanly and fetched zero rows (honest empty — not fresh data)",
    };
  }
  const ageHours = (now.getTime() - lastRunAt) / 3_600_000;
  if (ageHours <= FRESH_WINDOW_HOURS) {
    return { tier: "FRESH", reason: `last run ${ageHours.toFixed(1)}h ago, ${rowsFetched} row(s) fetched` };
  }
  if (ageHours <= STALE_WINDOW_DAYS * 24) {
    return { tier: "STALE", reason: `last run ${(ageHours / 24).toFixed(1)}d ago, ${rowsFetched} row(s) fetched` };
  }
  return {
    tier: "CRITICAL",
    reason: `last run ${(ageHours / 24).toFixed(1)}d ago — beyond the 7-day window`,
  };
}

/** Classify a whole set of latest-run records (the health table of one sync run). */
export function collectorHealthRows(
  runs: readonly CollectorRunRecord[],
  now: Date,
): CollectorHealth[] {
  return runs.map((run) => {
    const { tier, reason } = classifyCollectorTier(run, now);
    const parsed = toTime(run?.last_run_at);
    return {
      source: String(run?.source ?? "(unknown)"),
      tier,
      reason,
      last_run_at: parsed === null ? null : new Date(parsed).toISOString(),
      rows_fetched: toCount(run?.rows_fetched),
      errors: toCount(run?.errors),
    };
  });
}

/** True when a tier asserts healthy, data-bearing freshness (see the rule above). */
export function isFreshTier(tier: CollectorTier): boolean {
  return HEALTHY_TIERS.includes(tier);
}
