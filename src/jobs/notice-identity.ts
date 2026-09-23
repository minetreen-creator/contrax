/**
 * RUN-LEVEL NOTICE-IDENTITY GUARD — nationwide correctness FIX ⑤ (owner-locked
 * scope, PR B1).
 *
 * THE PROBLEM IT CLOSES
 * ---------------------
 * Every SAM.gov-family pass in a run asks SAM.gov a DIFFERENT question and gets
 * back the SAME federal notice pool:
 *   - `sam_gov` / `sam_gov_regional`  — the 100-row national recency window,
 *   - `cities`                        — the keywords "City of" / "County of" /
 *                                       "Metropolitan",
 *   - the 11 trade passes             — one `naics=` / `psc=` filter each,
 *   - the 51 state-keyword "doors"    — `q=<StateName>`, no code/location filter.
 * A notice whose text matches several of those queries is therefore returned
 * several times and stored several times — measured live: 4,059 five-dimension
 * duplicate groups / 14,690 rows, max group 32 (census Q6/Q14), e.g. one steam
 * solicitation stored by 16 different state doors plus `sam_gov`.
 *
 * The existing guards cannot see it:
 *   - the SQL `WHERE NOT EXISTS (title, agency)` guard reads the table as it was
 *     BEFORE the statement, and in Phase 2 five doors insert CONCURRENTLY;
 *   - `ON CONFLICT (source, external_id)` is structurally blind across labels
 *     (each door wrote its own `<st>-<_id>` id);
 *   - the migration-048 partial UNIQUE index only closes a same-wave race, by
 *     rejecting a statement it must then resolve row-by-row.
 *
 * THE GUARD
 * ---------
 * ONE in-memory set per RUN, shared by every SAM.gov-family source: the first
 * row that carries a canonical notice identity (`notice_key` =
 * `parentNoticeId || _id`, see `canonicalNoticeId` in sam-gov.ts) claims it, and
 * every later row with the same identity is skipped with the visible reason
 * `duplicate_notice`. It is DB-free, order-deterministic, and independent of the
 * SQL snapshot guard and of the 048 index — so it also closes the Phase-2 wave
 * hole the audit could not attribute (readiness §2.3).
 *
 * WHY IT KEYS ON THE NOTICE ID AND NOT ON (title, agency)
 * ------------------------------------------------------
 * Two traps make a text key wrong here (readiness §4 item 6):
 *   1. the doors fall back to `<StateName> Agency` while `sam_gov` falls back to
 *      "Federal Agency", so for notices with no organization hierarchy a
 *      (title, agency) key can never match across passes; and
 *   2. legitimate separate notices share a title AND an agency — the live
 *      "Award Notice" vs "Amendment 0001 …" pair on one solicitation (fix ① /
 *      migration 048's anti-collapse rule). Those must BOTH survive: they have
 *      different notice ids, so an id-keyed guard keeps both.
 *
 * ORDER: Phase 1 (the authoritative trade passes, then the national/regional and
 * city passes) runs before the Phase-2 doors, so an authoritative row always
 * claims an identity before any metadata-poor door row can (readiness §4 item 9).
 *
 * ACCOUNTING: a skipped row is NOT silently dropped — the runner adds it to the
 * source's `skip_reasons` (`duplicate_notice`) and to its skipped count, so the
 * owner's run-record invariant `fetched = accepted + skipped + failed` holds and
 * the run log shows exactly how many rows the guard removed.
 *
 * This module is pure: no network, no database, no imports.
 */

/** Skip reason key recorded in the run record for a guard-skipped row. */
export const DUPLICATE_NOTICE_REASON = "duplicate_notice";

/** The only thing the guard needs from a row: its canonical notice identity. */
export interface NoticeKeyedRow {
  notice_key?: string | null;
}

export interface GuardedSkip {
  /** The notice identity that was already accepted earlier in this run. */
  id: string;
  reason: string;
}

/** Trimmed identity, or null when the row carries none (never invented). */
export function normalizeNoticeKey(noticeKey: string | null | undefined): string | null {
  if (typeof noticeKey !== "string") return null;
  const key = noticeKey.trim();
  return key === "" ? null : key;
}

/**
 * One run's accepted-notice identities. `claim` is synchronous and atomic with
 * respect to the JS event loop, so two Phase-2 door sources running concurrently
 * can never both win the same identity.
 */
export class NoticeIdentityGuard {
  private readonly accepted = new Set<string>();

  /**
   * Reserve `noticeKey` for this run. Returns true when the caller may keep the
   * row (first claim of that identity, or the row has no identity at all), false
   * when another row already claimed it. An empty/absent key is NEVER claimed
   * and NEVER suppressed — a non-SAM source is not governed by this guard, and
   * an unknown identity is not invented.
   */
  claim(noticeKey: string | null | undefined): boolean {
    const key = normalizeNoticeKey(noticeKey);
    if (key === null) return true;
    if (this.accepted.has(key)) return false;
    this.accepted.add(key);
    return true;
  }

  /** Distinct notice identities accepted so far (observability only). */
  get acceptedCount(): number {
    return this.accepted.size;
  }

  has(noticeKey: string | null | undefined): boolean {
    const key = normalizeNoticeKey(noticeKey);
    return key !== null && this.accepted.has(key);
  }
}

export function createNoticeIdentityGuard(): NoticeIdentityGuard {
  return new NoticeIdentityGuard();
}

/**
 * Apply the run guard to one source's fetched rows: returns the rows to keep
 * plus one skip record per suppressed duplicate. Pure (a new array is returned;
 * the input is not mutated), so the whole fix is unit-testable without a
 * database — `rows.length === kept.length + skipped.length` by construction,
 * which is what keeps the runner's invariant honest.
 */
export function applyNoticeIdentityGuard<T extends NoticeKeyedRow>(
  rows: readonly T[],
  guard: NoticeIdentityGuard,
): { kept: T[]; skipped: GuardedSkip[] } {
  const kept: T[] = [];
  const skipped: GuardedSkip[] = [];
  for (const row of rows) {
    const key = normalizeNoticeKey(row?.notice_key);
    if (key !== null && !guard.claim(key)) {
      skipped.push({ id: key, reason: DUPLICATE_NOTICE_REASON });
      continue;
    }
    kept.push(row);
  }
  return { kept, skipped };
}

/** What a source's fetch hands the runner (see FetchResult in runner.ts). */
export interface FetchedRowBatch<T> {
  rows: T[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

/** The guarded batch PLUS the two counts the run record is written from. */
export interface GuardedRowBatch<T> {
  rows: T[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
  /** Every deliberate skip, the guard's included (rows are NOT counted twice). */
  skippedCount: number;
  /** fetched = rows.length + skippedCount — the owner's run-record invariant. */
  fetchedCount: number;
}

/**
 * The ONE place the run-level guard is applied to a source's fetch result — used
 * by `syncSource` for every source of the run. It returns the rows to insert plus
 * the merged skip accounting, so a guard-suppressed row is VISIBLE
 * (`skipped.duplicate_notice`) rather than silently dropped, and the runner's
 * `fetched = accepted + skipped + failed` invariant keeps holding:
 *
 *   fetchedCount = rows.length + skippedCount
 *   acceptedCount (computed by the runner) = rows.length - failed
 *   ⇒ fetched = accepted + skipped + failed.  ∎
 *
 * `guard` is optional so every existing caller/test of `syncSource` keeps
 * working; with no guard, sources that carry no SAM notice identity (PennBid,
 * oh_dayton, the city open-data portals) are a pass-through.
 */
export function applyRunNoticeGuard<T extends NoticeKeyedRow>(
  fetched: FetchedRowBatch<T>,
  guard?: NoticeIdentityGuard,
): GuardedRowBatch<T> {
  const skipped: Record<string, number> = { ...fetched.skipped };
  const skippedRows: { id: string; reason: string }[] = [...fetched.skippedRows];
  let rows = fetched.rows;

  if (guard) {
    const guarded = applyNoticeIdentityGuard(fetched.rows, guard);
    rows = guarded.kept;
    if (guarded.skipped.length > 0) {
      skippedRows.push(...guarded.skipped);
      skipped[DUPLICATE_NOTICE_REASON] =
        (skipped[DUPLICATE_NOTICE_REASON] ?? 0) + guarded.skipped.length;
    }
  }

  const skippedCount = Object.values(skipped).reduce((s, n) => s + n, 0);
  return { rows, skipped, skippedRows, skippedCount, fetchedCount: rows.length + skippedCount };
}
