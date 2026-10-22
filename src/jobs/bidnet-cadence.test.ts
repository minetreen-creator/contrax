import { describe, expect, test } from "bun:test";
import { TAIL_SOURCES } from "./runner";
import { BIDNET_MIN_HOURS, BIDNET_PER_RUN, chooseBidnetSources, isBidnetSource, planBidnetSources } from "./bidnet-cadence";

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
