import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isScraperBurst, scraperAlarmPush } from "./scraper-alarm";

describe("scraper alarm (owner 2026-11-05: Do both)", () => {
  test("the Nov 5 scrape would have fired it (273 bid views in 10 minutes from as many addresses)", () => {
    expect(isScraperBurst({ bidOnlyVisitors: 270, singlePageVisitors: 268, addresses: 268, bidViews: 273 })).toBe(true);
  });

  test("normal traffic, a busy hour of real readers or one person reading many bids does not", () => {
    expect(isScraperBurst({ bidOnlyVisitors: 6, singlePageVisitors: 5, addresses: 6, bidViews: 7 })).toBe(false);
    expect(isScraperBurst({ bidOnlyVisitors: 30, singlePageVisitors: 12, addresses: 28, bidViews: 80 })).toBe(false);
    expect(isScraperBurst({ bidOnlyVisitors: 1, singlePageVisitors: 0, addresses: 1, bidViews: 60 })).toBe(false);
    // Many one-page visits but from a handful of addresses (an office, a school lab): not a proxy pool.
    expect(isScraperBurst({ bidOnlyVisitors: 30, singlePageVisitors: 30, addresses: 5, bidViews: 30 })).toBe(false);
  });

  test("the push names the size, where it came from and the top browser, and opens Live", () => {
    const push = scraperAlarmPush(
      { bidOnlyVisitors: 270, singlePageVisitors: 268, addresses: 268, bidViews: 273 },
      [{ country: "PK", n: 48 }, { country: "BR", n: 38 }],
      [{ browser: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) … Chrome/120.0.0.0", n: 57 }],
    );
    expect(push.title).toBe("🚨 Scraper alarm: 273 bid pages in 10 min");
    expect(push.body).toContain("268 one-page visitors from 268 addresses (PK 48, BR 38)");
    expect(push.url).toBe("/admin/live");
  });

  test("bid page views run the check, and the snapshot stores no addresses", () => {
    const intake = readFileSync("src/lib/tracking-intake.ts", "utf8");
    expect(intake).toContain('pagePath.startsWith("/bid/")');
    expect(intake).toContain("checkScraperBurst()");
    const server = readFileSync("src/lib/scraper-alarm.server.ts", "utf8");
    expect(server).not.toMatch(/scraper_alarms \([^)]*\bip\b/);
  });
});
