/**
 * SWEEPER DETAIL-REFETCH REGRESSION (owner directive 2026-09-25, step 2a).
 *
 * THE BUG THIS FILE PINS. The sweeper used to skip the detail fetch for every slug the
 * store already had (`skipDetailFor = existing.keys()`), while the upsert overwrites the
 * detail-only columns (prime_division, website, summary, attachments, the detail POC,
 * the detail-page dates) from EXCLUDED. So when SBA AMENDED a notice in place — same
 * slug, changed date ⇒ new fingerprint ⇒ "updated" — the next sweep rewrote that row from
 * index-only data and silently dropped every field the detail page publishes. Measured
 * live on the real board before the fix: a dry re-run of the stored 141-notice corpus
 * reported `updated 141, unchanged 0, detail pages skipped 141` (i.e. all 141 rows would
 * have been rewritten detail-less).
 *
 * THE FIX (subnet.ts + sync.server.ts + store.server.ts): the pre-read now returns each
 * stored row's own `raw->'index'` snapshot, and the detail fetch is skipped PER NOTICE
 * only when the freshly parsed index row is content-identical to that snapshot. A row
 * whose detail page was skipped for that reason is treated as UNCHANGED by the runner and
 * never written — its stored detail survives. The subtle half, pinned below: such a row's
 * DETAIL-INCLUSIVE fingerprint cannot be recomputed without the detail page, so it
 * necessarily differs from the stored one; fingerprint equality alone would call it
 * "updated" and re-introduce the bug.
 *
 * ZERO network, ZERO database: the crawler's fetcher is injected, the store is injected,
 * every byte comes from the committed live fixtures.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SUBNET_SOURCE, toNoticeRow } from "~/lib/subcontracts/connector";
import {
  crawlSubnet,
  indexRowMatchesStored,
  noticesFromCrawl,
  parseSubnetIndexPage,
  type SubnetIndexRow,
} from "~/lib/subcontracts/subnet";
import { runSubcontractSync, type StoredNoticeSnapshot } from "~/lib/subcontracts/sync.server";
import type {
  SubcontractSyncWrite,
  SubcontractSyncWriteResult,
} from "~/lib/subcontracts/store.server";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const INDEX_PAGE = fixture("subnet-index-page0.html");
const DETAIL_PAGE = fixture("subnet-detail-dorm-common-area-landscaping.html");

/** One frozen clock for both sweeps of every test — fingerprints must be comparable. */
const NOW = new Date("2026-09-25T20:00:00Z");
const SOURCE_ID = "00000000-0000-4000-8000-000000000001";
const AMENDED_SLUG = "dorm-common-area-landscaping";

/** The crawler's HTTP layer: index pages from the fixture, details from the fixture. */
const liveLikeFetch = (requested: string[]) => async (url: string) => {
  requested.push(url);
  return url.includes("/opportunity/") ? DETAIL_PAGE : INDEX_PAGE;
};

/** The real reader chain (crawlSubnet → noticesFromCrawl) over an injected fetcher. */
const readerWith =
  (fetchText: (url: string) => Promise<string>) =>
  async (options: { storedIndex: ReadonlyMap<string, unknown>; now: Date }) => {
    const crawl = await crawlSubnet({ fetchText, storedIndex: options.storedIndex, now: options.now });
    const { notices, collisions } = noticesFromCrawl(crawl.rows, crawl.details);
    return {
      notices,
      stats: crawl.stats,
      collisions,
      unchangedIndexIds: crawl.unchangedIndexIds,
    };
  };

interface Sink {
  entries: SubcontractSyncWrite[];
  failures: { stage: string; message: string }[];
}

/** An injected store: no database, and every write the runner attempts is recorded. */
function fakeStore(snapshots: Map<string, StoredNoticeSnapshot>, sink: Sink) {
  return {
    ensureSource: async () => SOURCE_ID,
    readStoredNotices: async () => snapshots,
    commitSync: async (entry: SubcontractSyncWrite): Promise<SubcontractSyncWriteResult> => {
      sink.entries.push(entry);
      return {
        runId: "run-0000",
        touched: entry.rows.length,
        refreshed: entry.unchangedExternalIds.length,
        staled: 0,
        staledClosed: 0,
        staledUnverified: 0,
        finishedAt: entry.finishedAt,
      };
    },
    recordFailedSync: async (opts: { stage: string; message: string }) => {
      sink.failures.push({ stage: opts.stage, message: opts.message });
      return "run-error";
    },
  };
}

/**
 * The board's index page with ONE row's published value changed — how an in-place
 * amendment actually arrives (same slug, same row, new content). The edit is scoped to
 * that row's `<tr>` block so exactly one notice is affected.
 */
function amendIndexRow(slug: string, from: string, to: string): string {
  const start = INDEX_PAGE.indexOf(`href="/opportunity/${slug}"`);
  if (start < 0) throw new Error(`fixture does not contain ${slug}`);
  const end = INDEX_PAGE.indexOf("</tr>", start);
  const block = INDEX_PAGE.slice(start, end);
  const amended = block.replace(from, to);
  if (amended === block) throw new Error(`${slug}'s row does not publish ${from}`);
  return INDEX_PAGE.slice(0, start) + amended + INDEX_PAGE.slice(end);
}

/** The stored state a previous COMPLETE sweep left behind: the index snapshot it parsed
 * (exactly what the store keeps in `raw->'index'`) and the detail-inclusive fingerprint
 * the row carries. Built from the real fixtures, through the real code path.
 */
async function storedFromFirstSweep(): Promise<{
  snapshots: Map<string, StoredNoticeSnapshot>;
  rows: SubnetIndexRow[];
}> {
  const requested: string[] = [];
  const crawl = await crawlSubnet({ fetchText: liveLikeFetch(requested), now: NOW });
  const { notices } = noticesFromCrawl(crawl.rows, crawl.details);
  const snapshots = new Map<string, StoredNoticeSnapshot>();
  for (const notice of notices) {
    const row = toNoticeRow(notice, NOW);
    snapshots.set(notice.externalId, {
      fingerprint: row.fingerprint,
      // The store round-trips through jsonb: key order is not preserved and every value
      // is a JSON string/null. This replica of that round-trip is deliberate — the
      // comparison must not depend on key order.
      index: JSON.parse(JSON.stringify(row.raw.index)) as unknown,
    });
  }
  return { snapshots, rows: crawl.rows };
}

describe("sweeper detail refetch — the index snapshot decides, not the slug", () => {
  test("(1) an unchanged index row skips the detail fetch AND writes nothing, so the stored detail survives", async () => {
    const { snapshots } = await storedFromFirstSweep();
    const requested: string[] = [];
    const sink: Sink = { entries: [], failures: [] };
    const result = await runSubcontractSync({
      store: fakeStore(snapshots, sink),
      readSource: readerWith(async (url) => {
        requested.push(url);
        if (url.includes("/opportunity/")) {
          throw new Error("REGRESSION: the detail page must NOT be fetched for an unchanged index row");
        }
        return INDEX_PAGE;
      }),
      now: NOW,
    });

    expect(result.status).toBe("ok");
    expect(result.counts.seen).toBe(10);
    expect(result.counts.detailsFetched).toBe(0);
    expect(result.counts.detailsSkipped).toBe(10);
    expect(requested.filter((u) => u.includes("/opportunity/"))).toHaveLength(0);

    // The write half of the fix: NOTHING is offered to the upsert, so no detail-only
    // column can be overwritten with an index-only NULL.
    expect(sink.entries).toHaveLength(1);
    const entry = sink.entries[0]!;
    expect(entry.rows).toHaveLength(0);
    expect(entry.unchangedExternalIds).toHaveLength(10);
    expect(result.counts.inserted).toBe(0);
    expect(result.counts.updated).toBe(0);
    expect(result.counts.unchanged).toBe(10);

    // WHY the fingerprint comparison alone is NOT enough — the trap this fix closes. The
    // skipped row was built without its detail page, so its fingerprint (which covers
    // prime_division, website, summary, attachments, the detail contacts) DIFFERS from the
    // stored one; the old `existing.get(id) === row.fingerprint` test called that
    // "updated" and rewrote the row detail-less.
    const unchangedCrawl = await crawlSubnet({
      fetchText: async (url) => {
        if (url.includes("/opportunity/")) throw new Error("no detail fetch");
        return INDEX_PAGE;
      },
      storedIndex: new Map([...snapshots].map(([id, s]) => [id, s.index])),
      now: NOW,
    });
    const withoutDetail = noticesFromCrawl(unchangedCrawl.rows, unchangedCrawl.details).notices;
    const sample = withoutDetail.find((n) => n.externalId === AMENDED_SLUG)!;
    expect(sample.detailFetched).toBe(false);
    expect(sample.primeDivision).toBeNull();
    expect(toNoticeRow(sample, NOW).fingerprint).not.toBe(
      snapshots.get(AMENDED_SLUG)!.fingerprint,
    );
  });

  test("(2) an amended index row (same slug, changed date) IS refetched and merged — detail columns preserved, not NULLed", async () => {
    const { snapshots } = await storedFromFirstSweep();
    // SBA amends the notice IN PLACE: the slug (and therefore the identity) is unchanged,
    // the published closing date moved. The stored snapshot is last sweep's value; the
    // board now publishes the new one — exactly the shape that used to lose the detail.
    const amendedPage = amendIndexRow(AMENDED_SLUG, "10/12/2026", "11/30/2026");
    expect(amendedPage).not.toBe(INDEX_PAGE);

    const requested: string[] = [];
    const sink: Sink = { entries: [], failures: [] };
    const result = await runSubcontractSync({
      store: fakeStore(snapshots, sink),
      readSource: readerWith(async (url) => {
        requested.push(url);
        return url.includes("/opportunity/") ? DETAIL_PAGE : amendedPage;
      }),
      now: NOW,
    });

    expect(result.status).toBe("ok");
    const detailRequests = requested.filter((u) => u.includes("/opportunity/"));
    expect(detailRequests).toHaveLength(1);
    expect(detailRequests[0]).toContain(AMENDED_SLUG);
    expect(result.counts.detailsFetched).toBe(1);
    expect(result.counts.detailsSkipped).toBe(9);
    expect(result.counts.updated).toBe(1);
    expect(result.counts.inserted).toBe(0);
    expect(result.counts.unchanged).toBe(9);

    // The amendment reaches the store as an UPDATE that carries the FULL merge — every
    // detail-only column is present. This is the exact payload that used to arrive with
    // nulls for all of them.
    const entry = sink.entries[0]!;
    expect(entry.rows.map((r) => r.externalId)).toEqual([AMENDED_SLUG]);
    const written = entry.rows[0]!;
    expect(written.primeDivision).toBe("Atterbury Job Corps");
    expect(written.website).toBe("https://adamsaai.com");
    expect(written.summary).toContain("Site Visit: October 02, 2026 @ 10:30AM");
    expect(written.attachments).toEqual([
      { name: "CRA - SOW LandscapingAT26-137.docx", size: "57.76 KB" },
    ]);
    expect(written.contactName).toBe("Tammy Swallows");
    expect(written.contactEmail).toContain("swallows.tammy@jobcorps.org");
    expect(written.detailFetched).toBe(true);
    // The merge's own precedence is untouched: the detail page wins on closing date, and
    // the amended index value is still visible in `raw` for a reviewer.
    expect(written.closingDate).toBe("2026-10-12");
    expect((written.raw as { index: { closingRaw: string } }).index.closingRaw).toBe("11/30/2026");
    // …and the nine untouched notices are only timestamp-refreshed, never rewritten.
    expect(entry.unchangedExternalIds).toHaveLength(9);
    expect(entry.unchangedExternalIds).not.toContain(AMENDED_SLUG);
  });

  test("(3) the run row and the statuses stay correct: one `ok` run, no error row, no stale flip", async () => {
    const { snapshots } = await storedFromFirstSweep();
    const sink: Sink = { entries: [], failures: [] };
    const result = await runSubcontractSync({
      store: fakeStore(snapshots, sink),
      readSource: readerWith(async (url) => {
        if (url.includes("/opportunity/")) throw new Error("no detail fetch");
        return INDEX_PAGE;
      }),
      now: NOW,
    });

    // The sweep is a success, so the runner recorded NO error run row and returned the
    // run id the store's own `ok` insert produced.
    expect(sink.failures).toHaveLength(0);
    expect(result.runId).toBe("run-0000");
    expect(result.sourceId).toBe(SOURCE_ID);
    expect(result.error).toBeNull();

    const entry = sink.entries[0]!;
    // The run row's counts are the sweep's own numbers, including the skip accounting
    // that makes the saving measurable rather than asserted.
    expect(entry.counts.seen).toBe(10);
    expect(entry.counts.detailsSkipped).toBe(10);
    expect(entry.counts.detailsFetched).toBe(0);
    expect(entry.counts.collisions).toBe(0);
    expect(entry.counts.stoppedBecause).toContain("repeated an already-seen slug");
    expect(entry.counts.open + entry.counts.closed + entry.counts.unverified).toBe(10);
    // Every notice this COMPLETE sweep saw, so the stale sweep inside the same statement
    // has nothing to hide and no row flips to closed/unverified.
    expect(entry.seenExternalIds).toHaveLength(10);
    expect(new Set(entry.seenExternalIds).size).toBe(10);
    expect(entry.sourceKey).toBe(SUBNET_SOURCE.sourceKey);
    expect(entry.todayEastern).toBe("2026-09-25");
    expect(result.counts.closed).toBe(0);
    expect(result.counts.unverified).toBe(0);
  });

  test("indexRowMatchesStored is content equality with a fail-safe default", () => {
    const fresh = parseSubnetIndexPage(INDEX_PAGE).rows[0]!;
    const roundTripped = JSON.parse(JSON.stringify(fresh)) as unknown;
    expect(indexRowMatchesStored(fresh, roundTripped)).toBe(true);
    // jsonb does not promise key order — the comparison must not depend on it.
    const record = roundTripped as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(record).reverse());
    expect(indexRowMatchesStored(fresh, reordered)).toBe(true);

    // An amendment is a content change, whatever field moved.
    expect(indexRowMatchesStored(fresh, { ...record, closingRaw: "11/30/2026" })).toBe(false);
    expect(indexRowMatchesStored(fresh, { ...record, title: `${fresh.title} (revised)` })).toBe(false);
    expect(indexRowMatchesStored(fresh, { ...record, placeRaw: "Ohio" })).toBe(false);
    expect(indexRowMatchesStored(fresh, { ...record, externalId: `${fresh.externalId}-0` })).toBe(false);

    // Every shape we cannot PROVE identical fetches the detail page (a false "true" loses
    // published data; a false "false" costs one polite request).
    expect(indexRowMatchesStored(fresh, null)).toBe(false);
    expect(indexRowMatchesStored(fresh, undefined)).toBe(false);
    expect(indexRowMatchesStored(fresh, "slug")).toBe(false);
    expect(indexRowMatchesStored(fresh, [fresh])).toBe(false);
    expect(indexRowMatchesStored(fresh, {})).toBe(false);
    // A parser version that added a field: the stored snapshot cannot be compared.
    expect(indexRowMatchesStored(fresh, { ...record, newField: null })).toBe(false);
    const { contactPhone: _dropped, ...missingOne } = record;
    expect(indexRowMatchesStored(fresh, missingOne)).toBe(false);
  });
});
