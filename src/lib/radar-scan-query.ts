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
             estimated_value, naics_code, source_url, set_aside
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
             estimated_value, naics_code, source_url, set_aside
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