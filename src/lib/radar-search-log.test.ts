import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { radarSearchLogRow } from "./radar-search-log.server";

describe("radar search log", () => {
  test("keeps the trade and state as typed, trimmed and capped", () => {
    const row = radarSearchLogRow({
      visitorId: "v_123",
      userId: 42,
      trade: "  trucking  ",
      state: "co",
      cert: "sb",
      sizePref: "any",
      matched: 0,
      shown: 0,
      related: 2,
    });
    expect(row).toEqual({
      visitor_id: "v_123",
      user_id: 42,
      trade: "trucking",
      state: "CO",
      cert: "sb",
      size_pref: "any",
      matched: 0,
      shown: 0,
      related: 2,
    });
  });

  test("anonymous search with no visitor id stores nulls, long input is capped", () => {
    const row = radarSearchLogRow({
      visitorId: null,
      userId: null,
      trade: "x".repeat(500),
      state: "",
      cert: "sb",
      sizePref: "any",
      matched: 3.7,
      shown: 3,
      related: -1,
    });
    expect(row.visitor_id).toBeNull();
    expect(row.user_id).toBeNull();
    expect(row.trade.length).toBe(120);
    expect(row.state).toBe("");
    expect(row.matched).toBe(3);
    expect(row.related).toBe(0);
  });

  test("runRadarScan records each completed search after the free-search claim", () => {
    const src = readFileSync(new URL("../routes/radar.tsx", import.meta.url), "utf8");
    const claim = src.indexOf("claimRadarSearchBudget(budget.keys, budget.limit))");
    const record = src.indexOf("await recordRadarSearch({");
    expect(claim).toBeGreaterThan(0);
    expect(record).toBeGreaterThan(claim);
  });
});
