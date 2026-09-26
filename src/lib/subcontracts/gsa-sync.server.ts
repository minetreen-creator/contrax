/**
 * Contrax — SUBCONTRACTING preview: the GSA directory sweep
 * (owner-approved expansion 2026-09-26; spike README §4/§5/§6.3).
 *
 * ONE run does, in order:
 *   1. resolve the source row (idempotent; `ensureSubcontractSource`).
 *   2. read the LAST SUCCESSFUL run's counts — the change-detection state
 *      (`lastModified`, `contentSha256`, `fileUrl`). Nothing else is trusted for it.
 *   3. fetch: probe the handle → conditional GET on the dated file → 304 or bytes.
 *      Any failure THROWS (fail-closed) and is recorded as an `error` run row.
 *   4. 304 (or identical sha256) ⇒ NOTHING is written to the directory; the run row is
 *      still written, so "last checked by Contrax" stays truthful.
 *   5. new bytes ⇒ parse → upsert by (source_id, uei) → report exactly what changed:
 *      inserted / updated / unchanged / missingFromLatestFile / nonNaicsDropped /
 *      nonUsRows.
 *   6. rows that VANISH from a newer file are counted and NEVER deleted (additive by
 *      design — an owner decision, not this job's).
 *
 * `rowsSeen` is the number of data rows this run READ FROM THE FILE. On a 304 nothing
 * was read, so it is 0 and `notModified: true` says why; `storedRows` carries how many
 * rows are being served. These counts go into `subcontract_sync_runs.counts` verbatim.
 *
 * THE INVALID VALUES STAY IDENTIFIABLE. The 105 rows whose NAICS cell is not a valid
 * six-digit code are counted (`nonNaicsDropped`) AND stored verbatim (`naics_raw`), so
 *   SELECT count(*) FROM subcontract_primes WHERE source_id = … AND naics_raw IS NOT NULL
 * answers the same number the run reported; the 17 `Non-US` rows are counted separately
 * (`nonUsRows`) and stay identifiable through their verbatim `vendor_state`. Owner
 * refinement 2026-09-26.
 *
 * NO NETWORK IN TESTS: the fetcher and the store are both injectable, and the pure
 * parser is a separate module.
 */
import { GSA_PRIME_DIRECTORY_SOURCE } from "~/lib/subcontracts/connector";
import {
  GsaDirectoryError,
  parseGsaDirectory,
  type GsaDirectoryRow,
  type GsaParseAccounting,
} from "~/lib/subcontracts/gsa-directory";
import type { GsaDirectoryFetchResult } from "~/lib/subcontracts/gsa-directory.server";

export interface GsaSyncCounts {
  /** Data rows READ FROM THE FILE this run (0 on a 304 — nothing was downloaded). */
  rowsSeen: number;
  inserted: number;
  updated: number;
  /** Seen rows whose stored content already matched (nothing to write). */
  unchanged: number;
  /** Stored rows absent from the latest file. Counted, never deleted. */
  missingFromLatestFile: number;
  /** Rows whose NAICS cell is present but is not a 6-digit code (the CODE is dropped). */
  nonNaicsDropped: number;
  /**
   * Rows whose `State` reads exactly `Non-US` — kept VERBATIM in the data (the column is
   * what makes them identifiable) and labelled "Non-US (as the source states)" on the page.
   * Counted distinctly from `nonNaicsDropped`: a row can be one, both or neither.
   */
  nonUsRows: number;
  /** `YYYY-MM-DD` from the source's own dated file name, or null. Never inferred. */
  fileDate: string | null;
  /** The CSV's `Last-Modified` (the CDN may restamp it). */
  lastModified: string | null;
  /** sha256 of the raw CSV bytes. */
  contentSha256: string | null;
  /** `pin` | `bundle-discovery` — a moved handle is visible in the run log. */
  pathResolvedFrom: string;
  /** The source's own file name, evidence for the log. */
  fileName: string | null;
  /** True when the source answered 304 (or served bytes identical to the stored sha). */
  notModified: boolean;
  /** Rows for this source currently stored (what the page is serving). */
  storedRows: number;
  /** Rows in the file that carry a valid 6-digit NAICS. */
  validNaicsRows: number;
  requests: number;
  durationMs: number;
}

/** The store surface this runner needs, injectable so tests never touch a database. */
export interface GsaSyncStore {
  ensureSource(source: typeof GSA_PRIME_DIRECTORY_SOURCE): Promise<string>;
  previousRunCounts(sourceKey: string): Promise<Record<string, unknown> | null>;
  storedUeis(sourceId: string): Promise<Set<string>>;
  storedRowCount(sourceId: string): Promise<number>;
  upsertPrimes(
    sourceId: string,
    rows: readonly GsaDirectoryRow[],
    fetchedAt: string,
  ): Promise<{ inserted: number; updated: number }>;
  recordRun(opts: {
    sourceKey: string;
    status: "ok" | "error";
    stage: string;
    counts: Record<string, unknown>;
    message: string | null;
    startedAt: string;
    finishedAt: string;
  }): Promise<string>;
}

export interface GsaSyncOptions {
  dryRun?: boolean;
  now?: Date;
  store?: GsaSyncStore;
  fetchDirectory?: (options: {
    stored: {
      lastModified: string | null;
      contentSha256: string | null;
      fileUrl: string | null;
    } | null;
  }) => Promise<GsaDirectoryFetchResult>;
}

export interface GsaSyncResult {
  status: "ok" | "error";
  runId: string | null;
  sourceId: string | null;
  counts: GsaSyncCounts;
  accounting: GsaParseAccounting | null;
  error: { stage: string; message: string } | null;
}

export const EMPTY_GSA_COUNTS: GsaSyncCounts = {
  rowsSeen: 0,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  missingFromLatestFile: 0,
  nonNaicsDropped: 0,
  nonUsRows: 0,
  fileDate: null,
  lastModified: null,
  contentSha256: null,
  pathResolvedFrom: "",
  fileName: null,
  notModified: false,
  storedRows: 0,
  validNaicsRows: 0,
  requests: 0,
  durationMs: 0,
};

async function defaultStore(): Promise<GsaSyncStore> {
  const mod = await import("~/lib/subcontracts/store.server");
  return {
    ensureSource: mod.ensureSubcontractSource,
    previousRunCounts: mod.latestSubcontractRunCounts,
    storedUeis: mod.readStoredPrimeUeis,
    storedRowCount: mod.countStoredPrimes,
    upsertPrimes: mod.upsertGsaPrimeRows,
    recordRun: mod.recordSubcontractSyncRun,
  };
}

async function defaultFetch(options: {
  stored: { lastModified: string | null; contentSha256: string | null; fileUrl: string | null } | null;
}): Promise<GsaDirectoryFetchResult> {
  const mod = await import("~/lib/subcontracts/gsa-directory.server");
  return mod.fetchGsaDirectory({ stored: options.stored });
}

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/**
 * Runs one GSA-directory sweep. Always returns a result — it never throws, and a failure
 * is recorded as an `error` run row with zero written rows.
 */
export async function runGsaPrimesSync(options: GsaSyncOptions = {}): Promise<GsaSyncResult> {
  const now = options.now ?? new Date();
  const startedAtIso = now.toISOString();
  const startedMs = Date.now();
  const source = GSA_PRIME_DIRECTORY_SOURCE;
  const fetchDirectory = options.fetchDirectory ?? defaultFetch;

  const result: GsaSyncResult = {
    status: "ok",
    runId: null,
    sourceId: null,
    counts: { ...EMPTY_GSA_COUNTS },
    accounting: null,
    error: null,
  };

  // A dry run must not need a database at all: it fetches, parses and reports.
  let store: GsaSyncStore | null = options.store ?? null;
  /** Which stage a throw came from — the run row names it (never a generic "failed"). */
  let stage = "fetch";
  const fail = async (failedStage: string, error: unknown, counts?: Partial<GsaSyncCounts>) => {
    const message = error instanceof Error ? error.message : String(error);
    result.status = "error";
    result.error = { stage: failedStage, message };
    result.counts = {
      ...EMPTY_GSA_COUNTS,
      ...(counts ?? {}),
      durationMs: Date.now() - startedMs,
    };
    if (!options.dryRun && store) {
      try {
        result.runId = await store.recordRun({
          sourceKey: source.sourceKey,
          status: "error",
          stage,
          counts: result.counts as unknown as Record<string, unknown>,
          message,
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
        });
      } catch (recordError) {
        console.error("[gsa-primes] could not record the failed run:", recordError);
      }
    }
    return result;
  };

  try {
    if (!store && !options.dryRun) store = await defaultStore();

    // 1. the source row (idempotent). The stock row's values are the connector's.
    let sourceId: string | null = null;
    if (store) sourceId = await store.ensureSource(source);
    result.sourceId = sourceId;

    // 2. the change-detection state, from the last SUCCESSFUL run only.
    let stored: {
      lastModified: string | null;
      contentSha256: string | null;
      fileUrl: string | null;
    } | null = null;
    if (store) {
      const previous = await store.previousRunCounts(source.sourceKey);
      if (previous) {
        stored = {
          lastModified: str(previous.lastModified),
          contentSha256: str(previous.contentSha256),
          fileUrl: str(previous.fileUrl),
        };
        result.counts.nonNaicsDropped = Number(previous.nonNaicsDropped ?? 0) || 0;
        // A 304 read no file rows, so the only honest Non-US count is the one the last
        // completed check measured (the stored rows are what is being served).
        result.counts.nonUsRows = Number(previous.nonUsRows ?? 0) || 0;
      }
    }

    // 3. fetch (fail-closed: a throw lands in the catch below).
    stage = "fetch";
    const fetched = await fetchDirectory({ stored });
    result.counts.requests = fetched.requests;
    result.counts.pathResolvedFrom = fetched.pathResolvedFrom;
    result.counts.fileDate = fetched.fileDate;
    result.counts.lastModified = fetched.lastModified ?? stored?.lastModified ?? null;
    result.counts.contentSha256 = fetched.contentSha256 ?? stored?.contentSha256 ?? null;
    result.counts.fileName = fetched.fileName;

    const storedRows = store ? await store.storedRowCount(sourceId!) : 0;
    result.counts.storedRows = storedRows;
    stage = "parse";

    // 4. nothing new: write NO directory row, but still record that we checked.
    if (fetched.notModified) {
      stage = "store";
      result.counts.notModified = true;
      result.counts.rowsSeen = 0;
      result.counts.unchanged = storedRows;
      result.counts.nonNaicsDropped = Number(result.counts.nonNaicsDropped ?? 0) || 0;
      result.counts.nonUsRows = Number(result.counts.nonUsRows ?? 0) || 0;
      result.counts.durationMs = Date.now() - startedMs;
      if (!options.dryRun && store) {
        result.runId = await store.recordRun({
          sourceKey: source.sourceKey,
          status: "ok",
          stage: "store",
          counts: result.counts as unknown as Record<string, unknown>,
          message: fetched.notModified
            ? "the source answered 304 (or served bytes identical to the stored sha256) — no directory rows written"
            : null,
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
        });
      }
      return result;
    }

    // 5. new bytes: parse, then write exactly what changed.
    if (fetched.text === null) {
      throw new GsaDirectoryError("the fetch reported new bytes but carried no body");
    }
    const { rows, accounting } = parseGsaDirectory(fetched.text, fetched.fileUrl);
    result.accounting = accounting;
    result.counts.rowsSeen = rows.length;
    result.counts.nonNaicsDropped = accounting.nonNaicsCodesDropped;
    result.counts.nonUsRows = accounting.nonUsRows;
    result.counts.validNaicsRows = rows.length - accounting.nonNaicsCodesDropped - accounting.rowsWithoutNaicsCell;
    if (rows.length === 0) {
      throw new GsaDirectoryError(
        `the file parsed to 0 identifiable companies (${accounting.rowsRead} data rows read, ${accounting.rowsWithoutUei} without a UEI) — refusing to write an empty prime directory`,
      );
    }

    if (options.dryRun || !store) {
      // Report what WOULD change; write nothing.
      const known = options.dryRun && store ? await store.storedUeis(sourceId!) : new Set<string>();
      const seen = new Set(rows.map((row) => row.uei));
      result.counts.unchanged = rows.length;
      result.counts.missingFromLatestFile = [...known].filter((uei) => !seen.has(uei)).length;
      result.counts.durationMs = Date.now() - startedMs;
      return result;
    }

    const before = await store.storedUeis(sourceId!);
    stage = "store";
    const written = await store.upsertPrimes(sourceId!, rows, new Date().toISOString());
    result.counts.inserted = written.inserted;
    result.counts.updated = written.updated;
    result.counts.unchanged = Math.max(0, rows.length - written.inserted - written.updated);
    const seenUeis = new Set(rows.map((row) => row.uei));
    result.counts.missingFromLatestFile = [...before].filter((uei) => !seenUeis.has(uei)).length;
    result.counts.storedRows = await store.storedRowCount(sourceId!);
    result.counts.durationMs = Date.now() - startedMs;

    result.runId = await store.recordRun({
      sourceKey: source.sourceKey,
      status: "ok",
      stage: "store",
      counts: result.counts as unknown as Record<string, unknown>,
      message: null,
      startedAt: startedAtIso,
      finishedAt: new Date().toISOString(),
    });
    return result;
  } catch (error) {
    return fail(stage, error, { requests: result.counts.requests });
  }
}
