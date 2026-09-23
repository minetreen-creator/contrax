/**
 * FETCH-LEVEL FAILURE CLASSIFICATION — owner direction 2026-09-23, item ③
 * ("correct dead-collector error reporting so a 404 becomes DEAD, not EMPTY").
 *
 * THE GAP THIS CLOSES
 * -------------------
 * `collector_run_log`'s tiers (migration 049 / `src/lib/collector-freshness.ts`)
 * read a run as DEAD only when `errors > 0 AND rows_fetched = 0`. But most
 * connectors swallowed a failed request into a bare `return []` / `return null`
 * and only `console.error`-ed it, so the run record read
 * `rows_fetched = 0, errors = 0, ran_zero = true` — byte-identical to an HONEST
 * empty source — and a dead endpoint was reported as EMPTY (never DEAD):
 *
 *   | connector                | 404 / transport failure used to        |
 *   |--------------------------|---------------------------------------|
 *   | nys_socrata              | swallow (fixed by FIX ②, #418)        |
 *   | nyc/chicago/la/sf/austin | `break` → `[]`                        |
 *   | cities (SAM keyword)     | `return null` → `[]`                  |
 *   | 51 state-keyword doors   | `return null` → `[]`                  |
 *   | sam_gov (national)       | log + `continue`/`break` → `[]`       |
 *   | pennbid                  | `return { rows: [] }`                 |
 *   | oh_dayton                | `return { rows: [] }`                 |
 *   | va_evirginia             | log + `continue` → `[]`               |
 *   | 11 SAM trade passes      | already threw on page 0 (FIX ④)       |
 *
 * THE RULE (one definition, used by every connector)
 * --------------------------------------------------
 *   1. A request that FAILS (HTTP 4xx/5xx, timeout/DNS/connection failure, or a
 *      body that cannot be read) is RECORDED as a fetch failure.
 *   2. If the fetch obtained at least one usable row, it is NOT a dead source —
 *      the failure stays a logged diagnostic and the rows are returned normally
 *      (a partial failure must never throw away readable data).
 *   3. If the fetch obtained NOTHING and at least one request failed, the source
 *      could not be read: `FetchFailures.assertReached()` throws
 *      `SourceUnreachableError`. `syncSource` catches it per SOURCE (it can
 *      never abort the run), records it in `errors`, and persists
 *      `errors > 0, rows_fetched = 0` — which the tier rule reads as DEAD.
 *   4. A **200 that answers with zero rows is NOT a failure**: nothing is
 *      recorded, the connector returns its empty result, and the tier stays
 *      EMPTY / `zero_empty` (the honest zero the audit asked to preserve).
 *
 * WHY A THROW (and not a silence-keeping flag): a per-source throw is already
 * the run record's established error channel — `syncSource` catches it, writes
 * one error into `collector_run_log.errors` and `sync_logs.errors`, and keeps
 * running every other source. It is the same mechanism FIX ② shipped for
 * `nys_socrata` and FIX ④ shipped for the SAM trade passes, so there is exactly
 * ONE classification path in the repo instead of two.
 *
 * PURE + ZERO I/O: this module has no imports and no side effects, so it is
 * deterministic in tests and safe to import from any connector.
 */

/** A terminal request failure for one collector (HTTP status when there was one). */
export class FetchRequestError extends Error {
  readonly status: number | null;
  readonly url: string | null;

  constructor(message: string, opts: { status?: number | null; url?: string | null } = {}) {
    super(message);
    this.name = "FetchRequestError";
    this.status = opts.status ?? null;
    this.url = opts.url ?? null;
  }
}

/**
 * "This collector could not be read at all" — the error that turns a silent
 * zero-row run into a recorded error (and therefore a DEAD tier).
 *
 * The message is deliberately shaped `${source} unreachable: detail; detail`:
 * the runner prefixes its own `Source error for <name>:`, so the persisted text
 * names the source, every failed request, and why.
 */
export class SourceUnreachableError extends Error {
  readonly source: string;
  readonly failures: readonly string[];

  constructor(source: string, failures: readonly string[]) {
    super(`${source} unreachable: ${failures.join("; ") || "no successful request"}`);
    this.name = "SourceUnreachableError";
    this.source = source;
    this.failures = [...failures];
  }
}

/**
 * Per-fetch accumulator of failed requests. One instance per connector fetch
 * call (never module-level: two concurrent sources must not share state).
 */
export class FetchFailures {
  private readonly entries: string[] = [];
  private readable = false;

  /** Record one failed request (deduplicated, order preserved). */
  record(detail: string): this {
    const text = String(detail ?? "").trim();
    if (text && !this.entries.includes(text)) this.entries.push(text);
    return this;
  }

  /**
   * Mark that the source ANSWERED (a 200 whose body the connector could parse).
   * Call it at the moment a page/body is read, BEFORE deciding it holds no items:
   * a dataset that answers with an empty list is readable, and must stay an
   * honest EMPTY rather than be mistaken for an unreachable source.
   */
  markReadable(): this {
    this.readable = true;
    return this;
  }

  get count(): number {
    return this.entries.length;
  }

  get details(): readonly string[] {
    return [...this.entries];
  }

  /**
   * The rule (see the module header): throw iff the source was NOT readable —
   * i.e. at least one request failed, no response body was ever read, and no row
   * came out of the fetch. `rowsObtained` is a safety net so a connector that
   * forgot `markReadable()` still cannot report a productive fetch as dead.
   */
  assertReached(source: string, rowsObtained = 0): void {
    if (this.entries.length > 0 && !this.readable && rowsObtained <= 0) {
      throw new SourceUnreachableError(source, this.entries);
    }
  }
}

/** Human label for a failed response: `HTTP 404 for <url>`. */
export function httpFailureDetail(status: number, url?: string | null): string {
  return url ? `HTTP ${status} for ${url}` : `HTTP ${status}`;
}

/** Human label for a transport/parse failure: `request failed: <message>`. */
export function requestFailureDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "unknown error");
  return `request failed: ${message}`;
}

/**
 * The one label a connector's catch should record: an already-classified
 * failure keeps its own text (no `request failed: HTTP 404 …` double prefix),
 * anything else is labelled as a request failure.
 */
export function failureDetail(error: unknown): string {
  if (error instanceof FetchRequestError || error instanceof SourceUnreachableError) {
    return error.message;
  }
  return requestFailureDetail(error);
}
