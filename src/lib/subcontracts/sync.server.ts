/**
 * Contrax — SUBCONTRACTING preview, DATA LAYER: the sweep runner
 * (owner directive 2026-09-25, BUILD-PLAN.md §6.2).
 *
 * What one sweep does, in order:
 *   1. READ-ONLY pre-read: which slugs does this source already store, with which
 *      fingerprints AND which stored index snapshot (`raw->'index'`)? (No write. A
 *      source that does not exist yet is simply "nothing stored" — the crawl then
 *      fetches a detail page for every notice, which is the honest cost of the first
 *      sweep.)
 *   2. Crawl the SUBNet index (fetch → parse → stop on the pager's own signals) and
 *      fetch the detail page of every notice whose freshly parsed INDEX ROW is not
 *      content-identical to the stored snapshot. Slug existence is NOT the test: SBA
 *      amends notices in place (same slug, changed date), so skipping on the slug alone
 *      would write the amendment from index-only data and NULL out detail-only columns.
 *   3. classify() → dedupe() → split changed/unchanged: a notice whose index row was
 *      unchanged (no detail fetch) or whose full fingerprint is unchanged is NOT
 *      written; only new or genuinely changed content reaches the store.
 *   4. Resolve the source row, then commit ONE statement: the new/changed notices,
 *      the `last_seen_at`/`last_verified_at` refresh for the unchanged ones, the
 *      stale sweep for everything this COMPLETE sweep did not see, and the `ok` run
 *      row — together.
 *   5. Any failure anywhere → the commit statement is NEVER issued and the sweep is
 *      recorded as `error` with zero counts. A failed sweep therefore writes NOTHING
 *      to the notices table, including no stale sweep (only a COMPLETE crawl may
 *      reclassify what the source stopped publishing).
 *
 * HONEST COUNTING. The result carries the numbers the log line and the follow-up UI
 * need: seen / inserted / updated / unchanged / refreshed / closed-hidden /
 * unverified-hidden / requests / pages / details / duration. `detailsFetched` is the
 * requests actually spent, so a no-op rerun of an unchanged board costs ~15 requests
 * and 0 detail requests — measurable, not asserted.
 */
import {
  SUBNET_SOURCE,
  toNoticeRow,
  type SubcontractNotice,
  type SubcontractNoticeRow,
} from "~/lib/subcontracts/connector";
import type {
  SubcontractSyncCounts,
  SubcontractSyncWrite,
  SubcontractSyncWriteResult,
} from "~/lib/subcontracts/store.server";
import type { SubnetCrawlStats } from "~/lib/subcontracts/subnet";

/** What a previous complete sweep stored for one notice — the amendment pre-read. */
export interface StoredNoticeSnapshot {
  /** The fingerprint of the row as stored (detail-inclusive). */
  fingerprint: string;
  /** The stored `raw->'index'` snapshot, compared per-notice to decide the detail fetch. */
  index: unknown;
}

/** The store surface the runner needs, injectable for tests. */
export interface SubcontractSyncStore {
  ensureSource(source: typeof SUBNET_SOURCE): Promise<string>;
  readStoredNotices(sourceKey: string): Promise<Map<string, StoredNoticeSnapshot>>;
  commitSync(entry: SubcontractSyncWrite): Promise<SubcontractSyncWriteResult>;
  recordFailedSync(opts: {
    sourceKey: string;
    startedAt: string;
    finishedAt: string;
    stage: string;
    message: string;
    counts?: Partial<SubcontractSyncCounts>;
  }): Promise<string>;
}

/** The source reader (crawl + parse + dedupe), injectable for tests. */
export type SubcontractSourceReader = (options: {
  /** slug → stored `raw->'index'`; the detail page is fetched unless it matches. */
  storedIndex: ReadonlyMap<string, unknown>;
  now: Date;
}) => Promise<{
  notices: SubcontractNotice[];
  stats: SubnetCrawlStats;
  collisions: string[];
  /**
   * The ids whose detail page the crawl skipped because the fresh index row is
   * content-identical to the stored snapshot. Optional so an injected test reader can
   * simply omit it (the split then falls back to fingerprint equality).
   */
  unchangedIndexIds?: ReadonlySet<string>;
}>;

export interface SubcontractSyncOptions {
  store?: SubcontractSyncStore;
  readSource?: SubcontractSourceReader;
  /** One clock for the whole sweep (classification + timestamps). */
  now?: Date;
  /** Fetch + classify + report, write NOTHING (and no run row). */
  dryRun?: boolean;
}

export interface SubcontractSyncRunResult {
  status: "ok" | "error";
  runId: string | null;
  sourceId: string | null;
  counts: SubcontractSyncCounts;
  /** The set of slugs this complete sweep saw (the open-set truth). */
  seenExternalIds: string[];
  collisions: string[];
  error: { stage: string; message: string } | null;
}

/** The Eastern day ('YYYY-MM-DD') the stale sweep compares against. */
export function easternDayString(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

async function defaultStore(): Promise<SubcontractSyncStore> {
  const mod = await import("~/lib/subcontracts/store.server");
  return {
    ensureSource: mod.ensureSubcontractSource,
    readStoredNotices: mod.readNoticeSnapshots,
    commitSync: mod.commitSubcontractSync,
    recordFailedSync: mod.recordFailedSubcontractSync,
  };
}

async function defaultReader(options: {
  storedIndex: ReadonlyMap<string, unknown>;
  now: Date;
}): Promise<{
  notices: SubcontractNotice[];
  stats: SubnetCrawlStats;
  collisions: string[];
  unchangedIndexIds: Set<string>;
}> {
  const { crawlSubnet, noticesFromCrawl } = await import("~/lib/subcontracts/subnet");
  const crawl = await crawlSubnet({ storedIndex: options.storedIndex, now: options.now });
  const { notices, collisions } = noticesFromCrawl(crawl.rows, crawl.details);
  return {
    notices,
    stats: crawl.stats,
    collisions,
    unchangedIndexIds: crawl.unchangedIndexIds,
  };
}

const EMPTY_COUNTS: SubcontractSyncCounts = {
  seen: 0,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  open: 0,
  closed: 0,
  unverified: 0,
  detailsFetched: 0,
  detailsSkipped: 0,
  pagesFetched: 0,
  requests: 0,
  stoppedBecause: "",
  collisions: 0,
  durationMs: 0,
};

/** Runs the SUBNet sweep and always returns a result — never throws. */
export async function runSubcontractSync(
  options: SubcontractSyncOptions = {},
): Promise<SubcontractSyncRunResult> {
  const now = options.now ?? new Date();
  const startedAtIso = now.toISOString();
  const startedMs = Date.now();
  const store = options.store ?? (await defaultStore());
  const readSource = options.readSource ?? defaultReader;
  const todayEastern = easternDayString(now);

  const empty = (): SubcontractSyncRunResult => ({
    status: "ok",
    runId: null,
    sourceId: null,
    counts: { ...EMPTY_COUNTS },
    seenExternalIds: [],
    collisions: [],
    error: null,
  });

  const fail = async (
    stage: string,
    error: unknown,
    counts: Partial<SubcontractSyncCounts> = {},
  ): Promise<SubcontractSyncRunResult> => {
    const message = error instanceof Error ? error.message : String(error);
    const result = empty();
    result.status = "error";
    result.error = { stage, message };
    result.counts = { ...EMPTY_COUNTS, ...counts, durationMs: Date.now() - startedMs };
    if (!options.dryRun) {
      try {
        result.runId = await store.recordFailedSync({
          sourceKey: SUBNET_SOURCE.sourceKey,
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          stage,
          message,
          counts: { ...counts, durationMs: Date.now() - startedMs },
        });
      } catch (e) {
        // A failed sweep whose error row ALSO failed is the loudest possible state:
        // say so rather than pretending the run was recorded.
        result.error = {
          stage,
          message: `${message} (and recording the failed run itself failed: ${
            e instanceof Error ? e.message : String(e)
          })`,
        };
      }
    }
    return result;
  };

  // 1. READ-ONLY pre-read: what does this source already store, with which fingerprint
  //    AND which index snapshot? (A source that does not exist yet is simply "nothing
  //    stored" — the crawl then fetches a detail page for every notice, which is the
  //    honest cost of the first sweep.)
  let existing: Map<string, StoredNoticeSnapshot>;
  try {
    existing = await store.readStoredNotices(SUBNET_SOURCE.sourceKey);
  } catch (e) {
    return fail("read", e);
  }

  // 2. Crawl (index + the detail pages of notices whose index row is new or amended).
  let notices: SubcontractNotice[];
  let stats: SubnetCrawlStats;
  let collisions: string[];
  let unchangedIndexIds: ReadonlySet<string>;
  try {
    const storedIndex = new Map<string, unknown>();
    for (const [externalId, snapshot] of existing) storedIndex.set(externalId, snapshot.index);
    const read = await readSource({ storedIndex, now });
    notices = read.notices;
    stats = read.stats;
    collisions = read.collisions;
    unchangedIndexIds = read.unchangedIndexIds ?? new Set<string>();
  } catch (e) {
    const explicit = (e as { stage?: unknown }).stage;
    const stage = explicit === "fetch" || explicit === "parse" ? explicit : "crawl";
    return fail(stage, e);
  }

  // 3. Classify + split changed/unchanged.
  //
  //    UNCHANGED has two honest routes:
  //      a) the index row was content-identical to the stored snapshot, so no detail
  //         page was fetched (the fingerprint of such a row CANNOT be recomputed — it
  //         would be missing the detail-only fields and would therefore differ, which
  //         is exactly the bug this split exists to prevent); or
  //      b) the detail page was fetched and the full fingerprint is unchanged.
  //    Either way the row is NOT written, so its stored detail-only columns survive.
  const rows: SubcontractNoticeRow[] = notices.map((notice) => toNoticeRow(notice, now));
  const changed: SubcontractNoticeRow[] = [];
  const unchangedExternalIds: string[] = [];
  for (const row of rows) {
    const stored = existing.get(row.externalId);
    if (stored === undefined) {
      changed.push(row);
      continue;
    }
    if (unchangedIndexIds.has(row.externalId)) {
      unchangedExternalIds.push(row.externalId);
      continue;
    }
    if (stored.fingerprint === row.fingerprint) unchangedExternalIds.push(row.externalId);
    else changed.push(row);
  }
  const inserted = changed.filter((row) => !existing.has(row.externalId)).length;
  const updated = changed.length - inserted;
  const byStatus = (status: string) => rows.filter((row) => row.status === status).length;
  const counts: SubcontractSyncCounts = {
    seen: rows.length,
    inserted,
    updated,
    unchanged: unchangedExternalIds.length,
    open: byStatus("open"),
    closed: byStatus("closed"),
    unverified: byStatus("unverified"),
    detailsFetched: stats.detailsFetched,
    detailsSkipped: stats.detailsSkipped,
    pagesFetched: stats.pagesFetched,
    requests: stats.requests,
    stoppedBecause: stats.stoppedBecause,
    collisions: collisions.length,
    durationMs: stats.durationMs,
  };
  const seenExternalIds = rows.map((row) => row.externalId);

  if (options.dryRun) {
    const result = empty();
    result.counts = { ...counts, durationMs: Date.now() - startedMs };
    result.seenExternalIds = seenExternalIds;
    result.collisions = collisions;
    return result;
  }

  // 4. Attribute the sweep to its SOURCE — after a successful crawl, so a failing
  //    sweep still writes nothing.
  let sourceId: string;
  try {
    sourceId = await store.ensureSource(SUBNET_SOURCE);
  } catch (e) {
    return fail("source", e, counts);
  }

  // 5. ONE statement: notices + timestamp refresh + stale sweep + ok run row.
  try {
    const written = await store.commitSync({
      sourceKey: SUBNET_SOURCE.sourceKey,
      sourceId,
      startedAt: startedAtIso,
      finishedAt: new Date().toISOString(),
      todayEastern,
      counts,
      rows: changed,
      seenExternalIds,
      unchangedExternalIds,
    });
    const result = empty();
    result.runId = written.runId;
    result.sourceId = sourceId;
    result.counts = {
      ...counts,
      closed: counts.closed + written.staledClosed,
      unverified: counts.unverified + written.staledUnverified,
      durationMs: Date.now() - startedMs,
    };
    result.seenExternalIds = seenExternalIds;
    result.collisions = collisions;
    return result;
  } catch (e) {
    return fail("write", e, counts);
  }
}
