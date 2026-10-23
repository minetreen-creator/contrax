import { describe, expect, test } from "bun:test";
import { TAIL_SOURCES } from "./runner";
import { BIDNET_MIN_HOURS, BIDNET_PER_RUN, chooseBidnetSources, isBidnetSource, planBidnetSources , isBidnetRefusal } from "./bidnet-cadence";

const NOW = Date.parse("2026-10-23T03:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000);

describe("BidNet cadence (owner 2026-10-22: once a day)", () => {
  test("only <st>_bidnet sources are governed; there are dozens of them", () => {
    expect(isBidnetSource("tx_bidnet")).toBe(true);
    expect(isBidnetSource("tx_esbd")).toBe(false);
    expect(TAIL_SOURCES.filter((s) => isBidnetSource(s.name)).length).toBeGreaterThan(BIDNET_PER_RUN);
  });

  test("a group that ran (or was refused) within the day waits", () => {
    const names = ["a_bidnet", "b_bidnet", "c_bidnet"];
    const last = new Map([
      ["a_bidnet", hoursAgo(2)],
      ["b_bidnet", hoursAgo(BIDNET_MIN_HOURS + 1)],
    ]);
    expect(chooseBidnetSources(names, last, NOW)).toEqual(["c_bidnet", "b_bidnet"]);
  });

  test("at most a dozen per sync, most overdue first, never-run first", () => {
    const names = Array.from({ length: 30 }, (_, i) => `s${i}_bidnet`);
    const last = new Map(names.slice(0, 25).map((n, i) => [n, hoursAgo(21 + i)]));
    const chosen = chooseBidnetSources(names, last, NOW);
    expect(chosen.length).toBe(BIDNET_PER_RUN);
    expect(chosen.slice(0, 5)).toEqual(["s25_bidnet", "s26_bidnet", "s27_bidnet", "s28_bidnet", "s29_bidnet"]);
    expect(chosen[5]).toBe("s24_bidnet"); // the oldest run after the never-run ones
  });

  test("an unreadable run log means no BidNet this sync (less traffic, never a burst)", async () => {
    const sql = { query: async () => { throw new Error("relation does not exist"); } } as any;
    expect((await planBidnetSources(sql, ["a_bidnet"], NOW)).size).toBe(0);
    const ok = { query: async () => [{ source: "a_bidnet", last: hoursAgo(1).toISOString() }] } as any;
    expect([...(await planBidnetSources(ok, ["a_bidnet", "b_bidnet"], NOW))]).toEqual(["b_bidnet"]);
  });
});

describe("isBidnetRefusal (owner 2026-10-23)", () => {
  test("a 403 or 429 from BidNet is a refusal; other failures are not", () => {
    expect(isBidnetRefusal(["tx_bidnet unreachable: HTTP 403 for https://www.bidnetdirect.com/texas/solicitations/open-bids"])).toBe(true);
    expect(isBidnetRefusal(["HTTP 429 for https://www.bidnetdirect.com/x"])).toBe(true);
    expect(isBidnetRefusal(["page shape changed", "HTTP 500 for x"])).toBe(false);
    expect(isBidnetRefusal(["HTTP 4030 nope"])).toBe(false);
    expect(isBidnetRefusal([])).toBe(false);
  });
});

describe("BidNet pacing (owner 2026-10-23)", () => {
  test("3 seconds between pages and at most 15 pages a pass, even for groups allowed more", async () => {
    const { BIDNET_PAGE_DELAY_MS, BIDNET_PAGES_PER_PASS, BIDNET_PASS_TIMEOUT_MS } = await import("./sources/bidnet-direct");
    expect(BIDNET_PAGE_DELAY_MS).toBe(3_000);
    expect(BIDNET_PAGES_PER_PASS).toBe(15);
    // 15 pages at 3 s apart still finish well inside the default pass timeout.
    expect(BIDNET_PAGES_PER_PASS * BIDNET_PAGE_DELAY_MS).toBeLessThan(BIDNET_PASS_TIMEOUT_MS);
  });
});
