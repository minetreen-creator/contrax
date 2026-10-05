import { describe, expect, test } from "bun:test";
import { computeLeadScore, dataCenterLocation, isSelfReferrer, likelyAutomated, sameMinuteClusters, spanSeconds, type ClusterCandidate, type ScoreSignals } from "./visitor-intel";

const base: ScoreSignals = {
  returnedMultiDay: false,
  sessions: 1,
  radarStarted: false,
  radarCompleted: false,
  incumbentViewed: false,
  briefViewed: false,
  briefGenerated: false,
  pricingViewed: false,
  signupStarted: false,
  signedUp: false,
  savedBid: false,
  distinctBidsViewed: 0,
  steps: 0,
  autopsyAwardFound: false,
  autopsyReportViewed: false,
  autopsyRadarUsed: false,
};

describe("likely-automated visitors (owner 2026-10-02)", () => {
  test("the Phoenix visitor: 6 sessions and 3 bids in about a minute scores 0, flagged", () => {
    const s = computeLeadScore({ ...base, sessions: 6, distinctBidsViewed: 3, pageViews: 6, activeSpanSeconds: 61 });
    expect(s.score).toBe(0);
    expect(s.level).toBe("Low");
    expect(s.reasons).toEqual([]);
    expect(s.automated).toBe("6 sessions within 61 seconds");
  });

  test("6 page views in under a minute is flagged even in one session", () => {
    expect(likelyAutomated({ sessions: 1, pageViews: 6, activeSpanSeconds: 40, signedUp: false, savedBid: false })).toBe(
      "6 pages within 40 seconds",
    );
  });

  test("a person browsing at a normal pace is not flagged and keeps their points", () => {
    const s = computeLeadScore({ ...base, sessions: 2, distinctBidsViewed: 3, pageViews: 7, activeSpanSeconds: 600 });
    expect(s.automated).toBeUndefined();
    expect(s.score).toBe(25);
    expect(s.level).toBe("Medium");
  });

  test("two quick sessions or five quick pages stay human", () => {
    expect(likelyAutomated({ sessions: 2, pageViews: 5, activeSpanSeconds: 30, signedUp: false, savedBid: false })).toBeNull();
  });

  test("an unknown time span never flags", () => {
    expect(likelyAutomated({ sessions: 9, pageViews: 20, activeSpanSeconds: null, signedUp: false, savedBid: false })).toBeNull();
  });

  test("signed-up and bid-saving visitors are never flagged", () => {
    expect(likelyAutomated({ sessions: 6, pageViews: 10, activeSpanSeconds: 30, signedUp: true, savedBid: false })).toBeNull();
    expect(likelyAutomated({ sessions: 6, pageViews: 10, activeSpanSeconds: 30, signedUp: false, savedBid: true })).toBeNull();
  });

  test("email link scanners: self-referred first visit lasting under a minute is flagged", () => {
    // The 10:51 AM cluster after the NC outreach emails: 2 sessions, 3 steps, ~0 s, referrer contrax.company.
    const s = computeLeadScore({ ...base, sessions: 2, radarStarted: true, pageViews: 2, activeSpanSeconds: 4, firstReferrer: "https://www.contrax.company/" });
    expect(s.score).toBe(0);
    expect(s.automated).toContain("email link scanner");
    expect(likelyAutomated({ sessions: 1, pageViews: 1, activeSpanSeconds: 0, firstReferrer: "https://contrax.company/radar", signedUp: false, savedBid: false })).not.toBeNull();
  });

  test("self-referral alone is not enough: a longer visit or another referrer stays human", () => {
    expect(likelyAutomated({ sessions: 2, pageViews: 3, activeSpanSeconds: 300, firstReferrer: "https://www.contrax.company/", signedUp: false, savedBid: false })).toBeNull();
    expect(likelyAutomated({ sessions: 2, pageViews: 3, activeSpanSeconds: 4, firstReferrer: "https://lm.facebook.com/", signedUp: false, savedBid: false })).toBeNull();
    expect(likelyAutomated({ sessions: 2, pageViews: 3, activeSpanSeconds: 4, firstReferrer: "https://notcontrax.company.evil.com/", signedUp: false, savedBid: false })).toBeNull();
    expect(likelyAutomated({ sessions: 2, pageViews: 3, activeSpanSeconds: 4, firstReferrer: null, signedUp: false, savedBid: false })).toBeNull();
  });

  test("isSelfReferrer", () => {
    expect(isSelfReferrer("https://www.contrax.company/radar")).toBe(true);
    expect(isSelfReferrer("https://contrax.company")).toBe(true);
    expect(isSelfReferrer("https://contrax.company.attacker.io/")).toBe(false);
    expect(isSelfReferrer("not a url")).toBe(false);
  });

  test("spanSeconds", () => {
    expect(spanSeconds("2026-10-02T08:51:00Z", "2026-10-02T08:52:01Z")).toBe(61);
    expect(spanSeconds(null, "2026-10-02T08:52:01Z")).toBeNull();
    expect(spanSeconds("x", "y")).toBeNull();
  });
});

describe("the People table hides likely-automated visitors by default", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(import.meta.dir, "..", "routes", "admin", "journeys.tsx"), "utf8") as string;

  test("hidden unless toggled on; watched visitors always shown", () => {
    expect(src).toContain("const [showAutomated, setShowAutomated] = useState(false);");
    expect(src).toContain("const isAutomated = (j: Journey) => !!j.lead_score?.automated && !j.watched;");
    expect(src).toContain("{people.map((j) => (");
    expect(src).not.toContain("{data.journeys.map((j) => (");
  });
});

describe("sameMinuteClusters (owner 2026-10-03)", () => {
  const t0 = Date.parse("2026-10-03T11:16:05Z");
  const row = (id: string, offsetSec: number, extra: Partial<ClusterCandidate> = {}) => ({
    id,
    firstSeenMs: t0 + offsetSec * 1000,
    visitSeconds: 20,
    landing: "/radar",
    exempt: false,
    ...extra,
  });

  test("flags 3 quick visitors on the same page in the same minute (Boardman, OR scanners)", () => {
    const out = sameMinuteClusters([row("a", 0), row("b", 4), row("c", 9)]);
    expect([...out.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(out.get("a")).toContain("3 visitors arrived on /radar");
  });

  test("works across a clock-minute boundary", () => {
    const out = sameMinuteClusters([row("a", 50), row("b", 58), row("c", 62)]);
    expect(out.size).toBe(3);
  });

  test("two visitors are not a cluster", () => {
    expect(sameMinuteClusters([row("a", 0), row("b", 5)]).size).toBe(0);
  });

  test("different landing pages or spread-out arrivals are not a cluster", () => {
    expect(sameMinuteClusters([row("a", 0), row("b", 5, { landing: "/pricing" }), row("c", 9)]).size).toBe(0);
    expect(sameMinuteClusters([row("a", 0), row("b", 70), row("c", 140)]).size).toBe(0);
  });

  test("visitors who stayed longer than a minute, or are exempt, are never flagged", () => {
    expect(sameMinuteClusters([row("a", 0), row("b", 5, { visitSeconds: 300 }), row("c", 9)]).size).toBe(0);
    expect(sameMinuteClusters([row("a", 0), row("b", 5, { exempt: true }), row("c", 9)]).size).toBe(0);
    expect(sameMinuteClusters([row("a", 0), row("b", 5, { visitSeconds: null }), row("c", 9)]).size).toBe(0);
  });
});

describe("dataCenterLocation (owner 2026-10-03)", () => {
  test("Boardman, OR is flagged, by code or full state name", () => {
    expect(dataCenterLocation("Boardman", "OR")).toContain("Boardman, OR");
    expect(dataCenterLocation(" boardman ", "Oregon")).toContain("data-center town");
  });

  test("Hamina, Finland (Google data center, region 09) is flagged", () => {
    expect(dataCenterLocation("Hamina", "09")).toContain("Hamina, 09");
    expect(dataCenterLocation("Hamina", "10")).toBeNull();
  });

  test("real towns, other states and missing data are not", () => {
    expect(dataCenterLocation("Newport", "NC")).toBeNull();
    expect(dataCenterLocation("Boardman", "OH")).toBeNull();
    expect(dataCenterLocation(null, "OR")).toBeNull();
    expect(dataCenterLocation("Boardman", null)).toBeNull();
  });
});

import { sourceLabel } from "./visitor-intel";

describe("sourceLabel (owner 2026-10-04)", () => {
  test("paid clicks read as ads, everything else unchanged", () => {
    expect(sourceLabel("google", "cpc")).toBe("Google Ads");
    expect(sourceLabel("bing", "CPC")).toBe("Bing Ads");
    expect(sourceLabel("google", "organic")).toBe("google");
    expect(sourceLabel("facebook", "social")).toBe("facebook");
    expect(sourceLabel(null, "cpc")).toBeNull();
  });
});

import { BOT_EXCLUSION_SQL } from "./bot-exclusion";
describe("Google ad-review addresses (owner 2026-10-05)", () => {
  test("66.102.* is excluded like Googlebot's 66.249.*", () => {
    expect(BOT_EXCLUSION_SQL).toContain("ip LIKE '66.102.%'");
    expect(BOT_EXCLUSION_SQL).toContain("ip LIKE '74.125.%'");
    expect(BOT_EXCLUSION_SQL).toContain("ip LIKE '66.249.%'");
  });
});
