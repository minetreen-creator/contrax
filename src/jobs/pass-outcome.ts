/**
 * PER-PASS OUTCOME ACCOUNTING — nationwide correctness FIX ④
 * (owner-locked scope, PR B2).
 *
 * WHY THIS EXISTS
 * ---------------
 * `collector_run_log` already stores the raw counters of every pass
 * (`rows_fetched` / `accepted_count` / `skipped_count` / `failed_count` /
 * `rows_new` / `errors` / `ran_zero` / `skip_reasons`), but a reader had to
 * interpret them by hand — and the three zero-yield trucking passes were the
 * proof that this is not good enough:
 *
 *   | pass            | fetched | accepted | skipped | new | errors | what it means |
 *   |-----------------|---------|----------|---------|-----|--------|---------------|
 *   | sam_naics_484110|    3    |    0     |    3    |  0  |   0    | every notice refused by the purchased-service gate |
 *   | sam_naics_484121|    0    |    0     |    0    |  0  |   0    | honest empty (SAM reports zero matches) |
 *   | sam_naics_484122|    1    |    1     |    0    |  0  |   0    | the row is ALREADY STORED under another label |
 *
 * All three used to read as "ran fine, produced nothing", which is exactly the
 * ambiguity the audit called out. This module turns those counters into ONE
 * explicit outcome per pass, computed from the persisted run record — no new
 * column, no DDL, no change to what is counted (see "MIGRATION-FREE" below).
 *
 * THE OUTCOMES (evaluated in this order; first match wins)
 * --------------------------------------------------------
 *   1. `data_error`          — errors > 0 or failed > 0. The pass could not
 *                              read or persist its own data: a malformed /
 *                              mis-shapen source response (see
 *                              `TradeResponseShapeError` in sam-gov-trades.ts),
 *                              a transport failure, or an INSERT that threw.
 *                              (Also returned when there is no run record at
 *                              all.) This is the outcome that makes fix ②'s
 *                              blindness impossible for a trade pass: an
 *                              unreadable payload is no longer indistinguishable
 *                              from an honest zero.
 *   2. `zero_empty`          — clean run, zero rows fetched (`ran_zero`). An
 *                              HONEST empty: the source answered and had nothing.
 *                              PR A's freshness classifier records exactly this
 *                              as the EMPTY tier (never FRESH, never DEAD).
 *   3. `all_skipped`         — rows were fetched but every one was refused by a
 *                              pre-insert gate (`accepted = 0`, `skipped > 0`),
 *                              and the refusals are trade/business-gate reasons
 *                              (e.g. `product_buy`) rather than duplicate-guard
 *                              reasons. 484110's product veto is the live case.
 *   4. `suppressed_duplicate`— the fetched notices produced no NEW row because
 *                              they are all already represented in the corpus:
 *                              either the run-level notice-identity guard
 *                              skipped them (`skip_reasons.duplicate_notice`,
 *                              the B1 guard — a notice an earlier pass in the
 *                              same run already claimed), or every accepted row
 *                              was already stored (the cross-source SQL guard /
 *                              natural-key duplicate / no-op refresh), so
 *                              `rows_new = 0`. 484122 is the live case: its one
 *                              notice is stored under `sam_gov`.
 *   5. `ok`                  — the pass persisted at least one NEW row.
 *
 * `duplicate_notice` is additionally reported as its OWN count on every reading
 * (`duplicateNotice`), whatever the outcome, because the after-matrix readout has
 * to be able to see trade passes that logged `duplicate_notice` instead of
 * misreading them as finding nothing (PR B1's run-level guard claims a notice for
 * the FIRST pass that sees it, and `sam_gov` runs before the trade passes).
 *
 * MIGRATION-FREE — this is a DERIVATION, not a new counter
 * -------------------------------------------------------
 * Every field this module reads is already written by `syncSource` into
 * `collector_run_log`, so no migration is required (PR B2's hard constraint).
 * Nothing here changes the recorded counts or the owner's run-record invariant
 * `fetched = accepted + skipped + failed`; it only names what the counts mean.
 * The classification is a PURE function of the stored run record — no clock, no
 * network, no database, no imports beyond the duplicate-reason KEY (so the key
 * can never drift from the guard that writes it).
 *
 * CAVEAT the reader must keep (no invention): the run record cannot say WHICH
 * duplicate mechanism removed a row (the in-memory B1 guard runs before the
 * INSERT; the cross-source SQL guard and the 048 natural-key index act inside
 * it). `suppressed_duplicate` therefore means "nothing NEW persisted — every
 * fetched notice was already represented", and the per-reason breakdown in
 * `skip_reasons` is what says how. It never claims a row was deleted: no legacy
 * row is ever removed or relabelled (owner rule).
 */

import { DUPLICATE_NOTICE_REASON } from "./notice-identity";

export type PassOutcome =
  | "ok"
  | "all_skipped"
  | "suppressed_duplicate"
  | "zero_empty"
  | "data_error";

/** Every outcome this module can produce (stable list for readers/tests). */
export const PASS_OUTCOMES: readonly PassOutcome[] = [
  "ok",
  "all_skipped",
  "suppressed_duplicate",
  "zero_empty",
  "data_error",
];

/**
 * Skip reasons that mean "this notice is already represented" rather than "this
 * notice is not this trade's work". Only the run-level notice-identity guard's
 * reason exists today (`duplicate_notice`, src/jobs/notice-identity.ts) — the key
 * is imported, never re-typed, so the guard and the accounting cannot drift.
 */
export const DUPLICATE_SKIP_REASONS: readonly string[] = [DUPLICATE_NOTICE_REASON];

/** The subset of a `collector_run_log` row the classification reads. */
export interface PassRunRecord {
  source?: string | null;
  /** `collector_run_log.rows_fetched` (== `fetched_count`). */
  rows_fetched?: number | string | null;
  /** `collector_run_log.accepted_count`. */
  accepted_count?: number | string | null;
  /** `collector_run_log.skipped_count`. */
  skipped_count?: number | string | null;
  /** `collector_run_log.failed_count`. */
  failed_count?: number | string | null;
  /** `collector_run_log.rows_new` — genuinely new rows persisted. */
  rows_new?: number | string | null;
  /** `collector_run_log.errors` — count of errors for the run. */
  errors?: number | string | null;
  /** `collector_run_log.ran_zero`. */
  ran_zero?: boolean | null;
  /** `collector_run_log.skip_reasons` (jsonb) — reason -> count. */
  skip_reasons?: Record<string, number> | null;
}

export interface PassOutcomeReading {
  source: string;
  outcome: PassOutcome;
  /** Human justification, printed with the outcome (never a bare label). */
  reason: string;
  fetched: number;
  accepted: number;
  skipped: number;
  failed: number;
  new: number;
  errors: number;
  /**
   * `skip_reasons.duplicate_notice` for this pass — the rows the PR B1 run-level
   * notice-identity guard removed because an earlier pass in the same run already
   * claimed the notice. Reported for EVERY outcome, so a pass can never look like
   * it "found nothing" when it actually found notices another pass claimed first.
   */
  duplicateNotice: number;
  /** Skip reasons that are NOT duplicate-class, unchanged from the record. */
  gateSkips: Record<string, number>;
}

function toCount(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Normalize the jsonb `skip_reasons` map (defensive: null / junk → {}). */
export function normalizeSkipReasons(
  value: Record<string, number> | null | undefined,
): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [reason, count] of Object.entries(value)) {
    const n = toCount(count);
    if (n > 0) out[reason] = n;
  }
  return out;
}

/**
 * Classify ONE pass from its persisted run record. Pure and deterministic.
 * Order of the rules is part of the contract (documented in the header): a
 * failure outranks a zero, a zero outranks a refusal, and "nothing new
 * persisted" is reported as a duplicate suppression rather than as success.
 */
export function classifyPassOutcome(record: PassRunRecord | null | undefined): PassOutcomeReading {
  if (record === null || record === undefined) {
    // No run record at all: there is nothing to classify, and saying "honest
    // empty" here would be a lie (PR A's freshness classifier calls this state
    // CRITICAL — "this collector has never run"). It is reported as a data
    // problem so it can never be mistaken for a healthy zero.
    return {
      source: "(unknown)",
      outcome: "data_error",
      reason: "no run record was provided — there is no pass accounting to read",
      fetched: 0,
      accepted: 0,
      skipped: 0,
      failed: 0,
      new: 0,
      errors: 0,
      duplicateNotice: 0,
      gateSkips: {},
    };
  }
  const source = String(record.source ?? "(unknown)");
  const fetched = toCount(record?.rows_fetched);
  const accepted = toCount(record?.accepted_count);
  const skipped = toCount(record?.skipped_count);
  const failed = toCount(record?.failed_count);
  const newRows = toCount(record?.rows_new);
  const errors = toCount(record?.errors);
  const skips = normalizeSkipReasons(record?.skip_reasons);

  const duplicateNotice = skips[DUPLICATE_NOTICE_REASON] ?? 0;
  const gateSkips: Record<string, number> = {};
  for (const [reason, count] of Object.entries(skips)) {
    if (!DUPLICATE_SKIP_REASONS.includes(reason)) gateSkips[reason] = count;
  }
  let duplicateSkips = 0;
  for (const reason of DUPLICATE_SKIP_REASONS) duplicateSkips += skips[reason] ?? 0;
  const gateSkipTotal = Object.values(gateSkips).reduce((a, n) => a + n, 0);

  const base = {
    source,
    fetched,
    accepted,
    skipped,
    failed,
    new: newRows,
    errors,
    duplicateNotice,
    gateSkips,
  };

  if (errors > 0 || failed > 0) {
    return {
      ...base,
      outcome: "data_error",
      reason:
        `the pass could not read or persist its own data (${errors} error(s), ${failed} failed row(s)) — ` +
        `an unreadable/mis-shapen source response or a failed INSERT is NEVER reported as an honest zero`,
    };
  }
  if (fetched === 0) {
    return {
      ...base,
      outcome: "zero_empty",
      reason:
        "clean run, zero rows fetched — honest empty (the source answered and had nothing; " +
        "PR A's freshness classifier records this as EMPTY, never FRESH)",
    };
  }
  if (accepted === 0 && skipped > 0) {
    if (duplicateSkips === skipped && gateSkipTotal === 0) {
      return {
        ...base,
        outcome: "suppressed_duplicate",
        reason:
          `every fetched notice was skipped by a duplicate guard (duplicate_notice: ${duplicateNotice}) — ` +
          `an earlier pass in this run already claimed the notice, so this pass adds no rows`,
      };
    }
    return {
      ...base,
      outcome: "all_skipped",
      reason:
        `all ${fetched} fetched notice(s) were refused by a pre-insert gate ` +
        `(${JSON.stringify(gateSkips)}) — the pass is reachable but this filter's current ` +
        `result set holds no eligible work` +
        (duplicateNotice > 0 ? `; ${duplicateNotice} also already claimed by an earlier pass` : ""),
    };
  }
  if (newRows === 0) {
    return {
      ...base,
      outcome: "suppressed_duplicate",
      reason:
        `no NEW row persisted (accepted ${accepted}, skipped ${skipped}, new 0) — every accepted notice ` +
        `was already represented in the corpus (cross-source guard / natural-key duplicate / no-op refresh)` +
        (duplicateNotice > 0 ? `; ${duplicateNotice} were also skipped by the run-level duplicate guard` : ""),
    };
  }
  return {
    ...base,
    outcome: "ok",
    reason:
      `persisted ${newRows} new row(s) (fetched ${fetched} = accepted ${accepted} + skipped ${skipped} + failed ${failed})` +
      (duplicateNotice > 0 ? `; ${duplicateNotice} notice(s) already claimed by an earlier pass` : ""),
  };
}

/** Classify a whole run's records (one per source) — deterministic order. */
export function classifyPassOutcomes(
  records: readonly PassRunRecord[],
): PassOutcomeReading[] {
  return records.map((record) => classifyPassOutcome(record));
}

/**
 * The ONE line a run log prints per pass. Kept here (not in the runner) so the
 * operator readout and any harness render the same words for the same numbers.
 */
export function formatPassOutcomeLine(reading: PassOutcomeReading): string {
  const skips = { ...reading.gateSkips };
  if (reading.duplicateNotice > 0) skips[DUPLICATE_NOTICE_REASON] = reading.duplicateNotice;
  return (
    `${reading.source}: outcome=${reading.outcome} — ${reading.reason} ` +
    `[fetched ${reading.fetched} = accepted ${reading.accepted} + skipped ${reading.skipped} + failed ${reading.failed}; ` +
    `new ${reading.new}; duplicate_notice ${reading.duplicateNotice}; skip_reasons ${JSON.stringify(skips)}]`
  );
}

/** Outcome -> how many passes landed there (the after-run readout's tally). */
export function tallyOutcomes(
  readings: readonly PassOutcomeReading[],
): Record<PassOutcome, number> {
  const tally = Object.fromEntries(PASS_OUTCOMES.map((o) => [o, 0])) as Record<PassOutcome, number>;
  for (const reading of readings) tally[reading.outcome] += 1;
  return tally;
}
