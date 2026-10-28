import { describe, expect, test } from "bun:test";
import { automationMarker, isLikelyScraper, medianGapSeconds, scraperSignals, type TrailInput } from "./scraper-watch";

const CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const base: TrailInput = { country: "US", userAgent: CHROME, hitTimesHour: [], bidPagesHour: 0, searchesHour: 0, signedIn: false, sameIpVisitors: 0 };
const keys = (t: Partial<TrailInput>) => scraperSignals({ ...base, ...t }).map((s) => s.key);

describe("automationMarker", () => {
  test("spots automation user agents", () => {
    expect(automationMarker("Mozilla/5.0 HeadlessChrome/120.0")).toBe("headless");
    expect(automationMarker("python-requests/2.31")).toBe("python");
    expect(automationMarker("curl/8.4")).toBe("curl");
    expect(automationMarker("")).toBe("no user agent");
    expect(automationMarker(null)).toBe("no user agent");
  });
  test("leaves real browsers alone", () => {
    expect(automationMarker(CHROME)).toBeNull();
  });
});

describe("medianGapSeconds", () => {
  test("needs three hits", () => {
    expect(medianGapSeconds([0, 1000])).toBeNull();
  });
  test("median of the gaps, any order", () => {
    expect(medianGapSeconds([4000, 0, 1000])).toBe(2);
    expect(medianGapSeconds([0, 1000, 2000, 12000])).toBe(1);
  });
});

describe("scraperSignals", () => {
  test("a normal US visitor fires nothing", () => {
    expect(keys({ hitTimesHour: [0, 60_000, 180_000] })).toEqual([]);
  });
  test("outside the US", () => {
    expect(keys({ country: "ZW" })).toEqual(["abroad"]);
    // US territories are not abroad (a San Juan visitor, 2026-10-28).
    expect(keys({ country: "PR" })).toEqual([]);
    expect(keys({ country: "GU" })).toEqual([]);
  });
  test("fast clicking: many pages or tiny gaps", () => {
    expect(keys({ hitTimesHour: Array.from({ length: 30 }, (_, i) => i * 60_000) })).toEqual(["fast"]);
    expect(keys({ hitTimesHour: [0, 1000, 2000, 3000] })).toEqual(["fast"]);
  });
  test("bid sweeps, search bursts, one IP many ids", () => {
    expect(keys({ bidPagesHour: 15, searchesHour: 10, sameIpVisitors: 3 })).toEqual(["bid-sweep", "search-burst", "ip-fanout"]);
  });
  test("signed-in visitors only get the automation signal", () => {
    expect(keys({ signedIn: true, country: "ZW", bidPagesHour: 40 })).toEqual([]);
    expect(keys({ signedIn: true, userAgent: "curl/8" })).toEqual(["automation"]);
  });
});

describe("isLikelyScraper", () => {
  test("automation alone, or two other signals", () => {
    expect(isLikelyScraper(scraperSignals({ ...base, userAgent: "python-requests" }))).toBe(true);
    expect(isLikelyScraper(scraperSignals({ ...base, country: "ZW" }))).toBe(false);
    expect(isLikelyScraper(scraperSignals({ ...base, country: "ZW", bidPagesHour: 20 }))).toBe(true);
  });
});
