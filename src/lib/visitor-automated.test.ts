import { describe, expect, test } from "bun:test";
import { computeLeadScore, likelyAutomated, spanSeconds, type ScoreSignals } from "./visitor-intel";

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
