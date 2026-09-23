/**
 * Radar scan query execution + failure surfacing (owner 09-13 v6).
 *
 * PR-A requirement 4: query failures must be SURFACED (logged with context
 * including the query name) instead of swallowed into a successful empty
 * result. Every query in the keyword-scan path runs through RadarScanError:
 * callers (runRadarScan) log via logScanFailure (which names the query) and
 * rethrow, so the client receives a non-trivial error response — never a
 * misleading 0.
 *
 * The forced-failure regression test (radar-search.regression.test.ts) poisons
 * the SAME fragment structure the handler builds and asserts the wrapper
 * rejects with RadarScanError("keyword-scan") / ("related-scan") instead of
 * resolving with rows.
 */
import { collapseDuplicateNotices } from "~/lib/notice-dedupe";

export class RadarScanError extends Error {
  readonly queryName: string;
  constructor(queryName: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause ?? cause);
    super(`radar scan query "${queryName}" failed: ${detail.slice(0, 400)}`);
    this.name = "RadarScanError";
    this.queryName = queryName;
  }
}

export interface ScanQueryFrags {
  /** Already-built set-aside predicate fragment (e.g. `AND set_aside IS NOT NULL`). */
  certFrag: unknown;
  /** Already-built trade/NAICS predicate fragment (tradeKeywordPred result). */
  tradeFrag: unknown;
}

/**
 * Execute the strict keyword/NAICS scan query against `bids` through a live
 * handle. Builds the SAME container the scan handler always used (open rows,
 * low-content guard, cert + trade fragments, due-date order, LIMIT 100); the
 * only change is that ANY execution failure throws RadarScanError (query name
 * "keyword-scan") instead of being converted into 0 rows.
 */
export async function runKeywordScanQuery(
  sqlFactory: unknown,
  frags: ScanQueryFrags,
  lowContentSql: string,
): Promise<any[]> {
  const s = (sqlFactory as any)?.unsafe
    ? (sqlFactory as any)
    : (sqlFactory as any)();
  try {
    return await s`
      SELECT id, title, agency, description, location, category, due_date,
             estimated_value, naics_code, source_url, source, set_aside
      FROM bids
      WHERE due_date > NOW()
        AND ${s.unsafe(lowContentSql)}
        ${frags.certFrag}
        ${frags.tradeFrag}
      ORDER BY due_date ASC NULLS LAST
      LIMIT 100
    `;
  } catch (cause) {
    throw new RadarScanError("keyword-scan", cause);
  }
}

/**
 * Execute the RELATED-opportunities query: open, low-content rows whose
 * title/description/category carries an ADJACENT-work term, pulled with a
 * generous LIMIT and filtered to the requested state IN JS (place-of-performance
 * resolution) by the caller. Adjacent work is NEVER a default janitorial/
 * trucking match — this query is only ever rendered under the explicitly
 * labeled "Related opportunities" section, and it is deliberately NOT
 * cert-filtered (the section label discloses that; owner v6.1 DoD rows
 * 134726/134575/134583 are set_aside NULL yet must still surface there).
 * Failures throw RadarScanError("related-scan").
 */
export async function runRelatedScanQuery(
  sqlFactory: unknown,
  relatedTerms: string[],
  lowContentSql: string,
): Promise<any[]> {
  const s = (sqlFactory as any)?.unsafe
    ? (sqlFactory as any)
    : (sqlFactory as any)();
  const clauses = relatedTerms
    .filter((t) => t && t.length >= 2)
    .map(
      (t) =>
        s`(
          ${s`LOWER(COALESCE(title,'')) LIKE ${"%" + t + "%"}`} OR
          ${s`LOWER(COALESCE(description,'')) LIKE ${"%" + t + "%"}`} OR
          ${s`LOWER(COALESCE(category,'')) LIKE ${"%" + t + "%"}`}
        )`,
    );
  if (clauses.length === 0) return [];
  let acc = clauses[0] as any;
  for (let i = 1; i < clauses.length; i++) acc = s`(${acc} OR ${clauses[i]})`;
  try {
    return await s`
      SELECT id, title, agency, description, location, category, due_date,
             estimated_value, naics_code, source_url, source, set_aside
      FROM bids
      WHERE due_date > NOW()
        AND ${s.unsafe(lowContentSql)}
        AND ${acc}
      ORDER BY due_date ASC NULLS LAST
      LIMIT 50
    `;
  } catch (cause) {
    throw new RadarScanError("related-scan", cause);
  }
}

/** Log a scan failure WITH context, including the query name (owner v6). */
export function logScanFailure(
  error: unknown,
  ctx: { queryName?: string; trade: string; state: string; cert: string; sizePref?: string },
): void {
  const queryName =
    ctx.queryName ??
    (error instanceof RadarScanError ? error.queryName : "unknown");
  console.error(
    `[radar] scan query failed ("${queryName}", trade="${ctx.trade}", state="${ctx.state}", cert="${ctx.cert}", sizePref="${ctx.sizePref ?? "any"}"):`,
    error,
  );
}

/**
 * READ-TIME DUPLICATE COLLAPSE — the PRODUCTION caller of the R5 dedupe
 * (`~/lib/notice-dedupe`); QA F2 found the module was library-only, so the
 * audit's measured 3,652 title groups / 36.9 % inflation was still live and
 * duplicate rows could consume the ≤5 default-match cap.
 *
 * The scan's result set is collapsed BEFORE scoring/ranking: the SAME notice
 * re-ingested under several state-door source labels ("F108--Mobile Firing Range
 * Cleaning" alone was counted 11×) becomes one row. Nothing is deleted — the
 * database keeps every row; only the returned array is collapsed, and the
 * collapsed count is returned so a caller can report "N rows / M distinct".
 *
 * THE KEY (owner rule 4 + FIX ①): SAM's own solicitation number when present
 * (`bids.solicitation_number`, migration 047 / R2) plus `notice_type`
 * (migration 047) so an Award Notice and a Justification filed under one
 * solicitation number stay separate; else the (title, agency, notice_type)
 * natural key. Both key columns are loaded in ONE extra read, FAIL-SOFT: before
 * migration 047 is applied the columns do not exist, which must never take the
 * Radar scan down — the collapse then falls back to the natural key, exactly the
 * key the ingest path already dedupes on.
 */
export type NoticeKeyLoader = (
  ids: number[],
) => Promise<Map<number, NoticeKeyRow>>;

/** The two key columns read for a row: the solicitation number and the notice type. */
export interface NoticeKeyRow {
  solicitation_number: string | null;
  notice_type: string | null;
}

export interface ScanCollapseResult<T> {
  rows: T[];
  /** How many duplicate rows were collapsed away. */
  collapsed: number;
  /**
   * True when the notice-key columns were readable (migration 047 live). False
   * means the natural-key fallback was used, so the ≤5 cap may hold more
   * duplicates — a caller must not report "distinct notices" in that case.
   */
  noticeKeyColumns: boolean;
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/**
 * Load the stored solicitation number AND notice_type for a batch of row ids.
 * Throws when the columns are missing (047 unapplied) or the read fails — the
 * caller decides.
 */
export async function loadNoticeDedupeKeys(
  sqlFactory: unknown,
  ids: number[],
): Promise<Map<number, NoticeKeyRow>> {
  const out = new Map<number, NoticeKeyRow>();
  if (ids.length === 0) return out;
  const s = (sqlFactory as any)?.unsafe
    ? (sqlFactory as any)
    : (sqlFactory as any)();
  const rows: any[] = await s`
    SELECT id, solicitation_number, notice_type FROM bids WHERE id = ANY(${ids})
  `;
  for (const row of rows) {
    const id = Number(row?.id);
    if (!Number.isFinite(id)) continue;
    out.set(id, {
      solicitation_number: nullableText(row?.solicitation_number),
      notice_type: nullableText(row?.notice_type),
    });
  }
  return out;
}

/**
 * Collapse one scan result set through `~/lib/notice-dedupe`. The loader is
 * injected so the collapse is unit-testable with zero network and zero database.
 */
export async function collapseScanRows<T extends { id: number }>(
  rows: readonly T[],
  loadNoticeKeys: NoticeKeyLoader,
): Promise<ScanCollapseResult<T>> {
  if (rows.length < 2) {
    return { rows: [...rows], collapsed: 0, noticeKeyColumns: false };
  }
  let keys = new Map<number, NoticeKeyRow>();
  let keyedByNoticeColumns = false;
  try {
    keys = await loadNoticeKeys(rows.map((r) => r.id));
    keyedByNoticeColumns = true;
  } catch (e) {
    // Fail-soft: the natural-key fallback is the ingest path's own dedupe key,
    // so Radar still collapses cross-source duplicates without 047.
    console.error(
      "[radar] dedupe: notice-key read unavailable — collapsing on (title, agency, notice_type):",
      e instanceof Error ? e.message : e,
    );
  }
  const withKeys = rows.map((row) => {
    const key = keyedByNoticeColumns ? keys.get(row.id) : undefined;
    return {
      ...row,
      solicitation_number: key?.solicitation_number ?? null,
      notice_type: key?.notice_type ?? null,
    };
  });
  const { rows: kept, collapsed } = collapseDuplicateNotices(withKeys);
  return { rows: kept, collapsed, noticeKeyColumns: keyedByNoticeColumns };
}
