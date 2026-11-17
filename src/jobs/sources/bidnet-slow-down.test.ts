/**
 * BidNet's "HTTP 202" (owner alert 2026-11-17: ma_bidnet failed on its 7th page and wv_bidnet on
 * its first, after about 105 pages in one sync). Zero network: the New Hampshire capture's four
 * list pages are served by a stub.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { isBidnetRefusal } from "../bidnet-cadence";
import { SourceUnreachableError } from "../fetch-failure";
import { BIDNET_PAGES_PER_PASS, BIDNET_PAGES_PER_SYNC, bidnetPageBudget, createBidNetGroup, startBidnetPageBudget } from "./bidnet-direct";

const read = (name: string): string => gunzipSync(readFileSync(new URL(`./fixtures/nh-bidnet/${name}`, import.meta.url))).toString("utf8");
const PAGES = ["open-bids-2026-10-12.html.gz", "open-bids-page2-2026-10-12.html.gz", "open-bids-page3-2026-10-12.html.gz", "open-bids-page4-2026-10-12.html.gz"].map(read);
const NOW = Date.parse("2026-10-12T04:00:00Z");
const group = createBidNetGroup({ source: "nh_bidnet", idPrefix: "nhbidnet", slug: "new-hampshire", stateName: "New Hampshire", groupName: "New Hampshire Purchasing Group", pageDelayMs: 0 });

describe("BidNet asks a reader to wait (HTTP 202)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    bidnetPageBudget.used = 0;
    bidnetPageBudget.limit = Number.POSITIVE_INFINITY;
  });
  /** Serve the capture; answer 202 from `waitFrom` (1 = the first page) onward. */
  function stub(waitFrom = 99): string[] {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const n = Number(/\/page(\d)$/.exec(url)?.[1] ?? 1);
      return n >= waitFrom ? new Response("", { status: 202 }) : new Response(PAGES[n - 1], { status: 200 });
    }) as typeof fetch;
    return asked;
  }

  test("with no budget and no wait, every page is read as before", async () => {
    const asked = stub();
    const all = await group.fetchBids(NOW);
    expect(asked).toHaveLength(4);
    expect(all.rows.length).toBe(90);
  });

  test("a wait part-way through keeps the pages already read and stops asking", async () => {
    startBidnetPageBudget();
    const asked = stub(3);
    const r = await group.fetchBids(NOW);
    expect(asked).toHaveLength(3); // page 1, page 2, then the 202 on page 3: no page 4
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.length).toBeLessThan(90);
    // The rest of this sync's budget is spent, so the next group pages no further.
    expect(bidnetPageBudget.used).toBe(BIDNET_PAGES_PER_SYNC);
  });

  test("a wait on the first page fails the group honestly, as a refusal the rest of BidNet backs off from", async () => {
    startBidnetPageBudget();
    stub(1);
    let error: unknown;
    try { await group.fetchBids(NOW); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(SourceUnreachableError);
    expect(String((error as Error).message)).toContain("HTTP 202");
    expect(isBidnetRefusal(["nh_bidnet unreachable: HTTP 202 for https://www.bidnetdirect.com/new-hampshire/solicitations/open-bids"])).toBe(true);
    expect(isBidnetRefusal(["HTTP 403 for x"])).toBe(true);
    expect(isBidnetRefusal(["HTTP 500 for x"])).toBe(false);
  });

  test("once the sync's budget is spent, a group reads only its first page", async () => {
    startBidnetPageBudget(2);
    const first = stub();
    await group.fetchBids(NOW); // reads two pages: the budget
    expect(first).toHaveLength(2);
    const second = stub();
    const r = await group.fetchBids(NOW); // budget spent: the newest page only
    expect(second).toHaveLength(1);
    expect(r.rows.length).toBeGreaterThan(0);
  });

  test("the budget is under the count that drew the 202, and the runner starts it each sync", () => {
    expect(BIDNET_PAGES_PER_SYNC).toBe(80);
    expect(BIDNET_PAGES_PER_SYNC).toBeLessThan(105);
    expect(BIDNET_PAGES_PER_SYNC).toBeGreaterThan(BIDNET_PAGES_PER_PASS);
    expect(readFileSync("src/jobs/runner.ts", "utf8")).toContain("  startBidnetPageBudget();");
  });
});
