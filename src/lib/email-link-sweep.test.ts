import { describe, expect, test } from "bun:test";
import { dataCenterLocation, emailLinkSweep, likelyAutomated } from "./visitor-intel";
import { isLikelyScraper, scraperSignals } from "./scraper-watch";

// Owner 2026-11-03: San Jose, Des Moines and Moses Lake "visitors" opened the
// outreach email's links (a bid, /bid-scout, /pricing) within seconds, right
// after the emails went out: Microsoft's mail security checking the links.
const base = { country: "US", userAgent: "Mozilla/5.0 (Macintosh) Chrome/155.0.0.0 Safari/537.36", bidPagesHour: 1, searchesHour: 0, signedIn: false, sameIpVisitors: 0 };
const T = 1_793_700_000_000;

describe("email link sweep", () => {
  test("3 pages in seconds is a scanner; a person's pace is not", () => {
    expect(emailLinkSweep(3, 0.1)).toContain("email link scanner");
    expect(emailLinkSweep(3, 8)).toContain("3 pages in 8 seconds");
    expect(emailLinkSweep(3, 40)).toBeNull();
    // Owner 2026-11-04: a first email's two links (bid + /pricing) opened together.
    expect(emailLinkSweep(2, 1)).toContain("2 pages in 1 seconds");
    expect(emailLinkSweep(2, 0.2)).toContain("email link scanner");
    expect(emailLinkSweep(2, 10)).toBeNull();
    expect(emailLinkSweep(1, 0)).toBeNull();
    expect(emailLinkSweep(3, null)).toBeNull();
  });
  test("the visitor trail calls it a likely bot, even at 4 seconds apart", () => {
    const fast = scraperSignals({ ...base, hitTimesHour: [T, T + 50, T + 100] });
    expect(fast.some((s) => s.key === "email-scanner")).toBe(true);
    expect(isLikelyScraper(fast)).toBe(true);
    const slowish = scraperSignals({ ...base, hitTimesHour: [T, T + 4000, T + 8000] });
    expect(isLikelyScraper(slowish)).toBe(true);
    const person = scraperSignals({ ...base, hitTimesHour: [T, T + 30_000, T + 90_000] });
    expect(person.some((s) => s.key === "email-scanner")).toBe(false);
    expect(scraperSignals({ ...base, signedIn: true, hitTimesHour: [T, T + 50, T + 100] })).toEqual([]);
  });
  test("the Visitors board flags it, but never a paid ad click or a signup", () => {
    const s = { sessions: 1, activeSpanSeconds: 3, pageViews: 3, signedUp: false, savedBid: false, firstReferrer: null };
    expect(likelyAutomated(s)).toContain("email link scanner");
    expect(likelyAutomated({ ...s, paidClick: true })).toBeNull();
    expect(likelyAutomated({ ...s, signedUp: true })).toBeNull();
  });
});

describe("Moses Lake and the two-link email (owner 2026-11-04: \"both are bots\")", () => {
  test("Moses Lake, WA is a data-center town; San Jose is not", () => {
    expect(dataCenterLocation("Moses Lake", "WA")).toContain("data-center town");
    expect(dataCenterLocation("San Jose", "CA")).toBeNull();
  });
  test("the bid and /pricing opened together is a scanner, a person's pace is not", () => {
    expect(likelyAutomated({ sessions: 1, pageViews: 2, activeSpanSeconds: 1, firstReferrer: null, signedUp: false, savedBid: false })).toContain("email link scanner");
    expect(likelyAutomated({ sessions: 1, pageViews: 2, activeSpanSeconds: 15, firstReferrer: null, signedUp: false, savedBid: false })).toBeNull();
  });
});
