import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  SUBNET_MAX_REFUSED_DETAILS,
  SubnetFetchError,
  crawlSubnet,
  isPageRefusal,
  noticesFromCrawl,
} from "~/lib/subcontracts/subnet";

// Owner 2026-11-11 ("find our missing data"): one notice's own page on SBA SUBNet answered 403 every
// day from 2026-10-29. Any failed detail request aborted the whole sweep, so no subcontracting notice
// was stored for 13 days and the page kept showing notices that had already closed.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const INDEX_PAGE = fixture("subnet-index-page0.html");
const DETAIL_PAGE = fixture("subnet-detail-dorm-common-area-landscaping.html");
const NOW = new Date("2026-11-11T03:00:00Z");

const refuse = (url: string, status: number): never => {
  throw new SubnetFetchError(`GET ${url} failed after 1 attempt(s): HTTP ${status}`, url, status);
};

describe("a notice page the site refuses", () => {
  test("403, 404 and 410 are refusals; a server error or a timeout is not", () => {
    expect([403, 404, 410].map(isPageRefusal)).toEqual([true, true, true]);
    expect([500, 502, 429, 200, null, undefined].map(isPageRefusal)).toEqual([false, false, false, false, false, false]);
  });

  test("one refused notice page no longer stops the sweep; that notice is kept from its list row", async () => {
    const requested: string[] = [];
    let refusedUrl = "";
    const crawl = await crawlSubnet({
      now: NOW,
      fetchText: async (url) => {
        requested.push(url);
        if (!url.includes("/opportunity/")) return INDEX_PAGE;
        if (!refusedUrl) refusedUrl = url;
        return url === refusedUrl ? refuse(url, 403) : DETAIL_PAGE;
      },
    });
    expect(crawl.rows.length).toBeGreaterThan(1);
    expect(crawl.stats.detailsRefused).toBe(1);
    expect(crawl.stats.detailsFetched).toBe(crawl.rows.length - 1);
    // Asked for once, never again in the same sweep.
    expect(requested.filter((u) => u === refusedUrl)).toHaveLength(1);
    const { notices } = noticesFromCrawl(crawl.rows, crawl.details);
    expect(notices).toHaveLength(crawl.rows.length);
    const kept = notices.find((n) => n.detailUrl === refusedUrl)!;
    expect(kept.detailFetched).toBe(false);
    expect(kept.title.length).toBeGreaterThan(0);
    expect(notices.filter((n) => n.detailFetched)).toHaveLength(crawl.rows.length - 1);
  });

  test("many refusals read as the crawler being refused: the sweep stops and writes nothing", async () => {
    let asked = 0;
    const run = crawlSubnet({
      now: NOW,
      fetchText: async (url) => {
        if (!url.includes("/opportunity/")) return INDEX_PAGE;
        asked += 1;
        return refuse(url, 403);
      },
    });
    await expect(run).rejects.toThrow(/refused 4 notice pages in one sweep/);
    // It stopped at the limit instead of asking for every page.
    expect(asked).toBe(SUBNET_MAX_REFUSED_DETAILS + 1);
  });

  test("a server error on a notice page still fails the sweep (not a refusal)", async () => {
    const run = crawlSubnet({
      now: NOW,
      fetchText: async (url) => (url.includes("/opportunity/") ? refuse(url, 500) : INDEX_PAGE),
    });
    await expect(run).rejects.toThrow(/HTTP 500/);
  });

  test("the fetcher does not ask again after a refusal, and the index page is still fatal", () => {
    const src = readFileSync("src/lib/subcontracts/subnet.ts", "utf8");
    expect(src).toContain("if (isPageRefusal(lastStatus)) break;");
    // Only the detail loop tolerates a refusal; the index request has no such catch.
    expect(src.match(/isPageRefusal\(e\.status\)/g)).toHaveLength(1);
    expect(readFileSync("src/jobs/subcontract-sync.ts", "utf8")).toContain("refused by the site ${c.detailsRefused ?? 0}");
  });
});
