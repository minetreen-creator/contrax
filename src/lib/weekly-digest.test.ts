import { describe, expect, test } from "bun:test";
import { bidDigestHtml, radarMatchAlertHtml, starterPriceHtml, WEEKLY_DIGEST_LIST_LIMIT } from "./email";
import {
  isWeeklyDigestEligible,
  newYorkWeekday,
  shouldSendWeeklyDigest,
  weeklyDigestRecipients,
  weeklyUnsubscribeUrl,
  weeklyWindowBounds,
  weeklyWindowStart,
} from "./weekly-digest";

const DAY = 24 * 60 * 60 * 1000;
// Monday 2026-10-05 10:05 UTC = 6:05 AM EDT
const MONDAY_6AM = Date.parse("2026-10-05T10:05:00Z");

describe("weekly digest — who gets it", () => {
  test("free Basic users and expired trials get the weekly email", () => {
    expect(isWeeklyDigestEligible({ email: "a@x.com", plan_tier: "basic" }, MONDAY_6AM)).toBe(true);
    expect(isWeeklyDigestEligible({ email: "a@x.com", plan_tier: null }, MONDAY_6AM)).toBe(true);
    const expired = { email: "a@x.com", plan_tier: "starter", trial_started_at: new Date(MONDAY_6AM - 30 * DAY).toISOString() };
    expect(isWeeklyDigestEligible(expired, MONDAY_6AM)).toBe(true);
  });

  test("anyone on the daily email does not also get the weekly one", () => {
    expect(isWeeklyDigestEligible({ email: "a@x.com", plan_tier: "starter", subscription_status: "active" }, MONDAY_6AM)).toBe(false);
    expect(isWeeklyDigestEligible({ email: "a@x.com", plan_tier: "professional" }, MONDAY_6AM)).toBe(false);
    expect(isWeeklyDigestEligible({ email: "a@x.com", plan_tier: "basic", has_bid_scout: true }, MONDAY_6AM)).toBe(false);
    expect(isWeeklyDigestEligible({ email: "a@x.com", is_admin: true }, MONDAY_6AM)).toBe(false);
  });

  test("internal demo/seed tiers and blank addresses never get it", () => {
    expect(isWeeklyDigestEligible({ email: "a@x.com", plan_tier: "demo" }, MONDAY_6AM)).toBe(false);
    expect(isWeeklyDigestEligible({ email: "a@x.com", plan_tier: "seed" }, MONDAY_6AM)).toBe(false);
    expect(isWeeklyDigestEligible({ email: "  ", plan_tier: "basic" }, MONDAY_6AM)).toBe(false);
  });

  test("recipients are de-duplicated and unsubscribed addresses are dropped", () => {
    const rows = [
      { email: "A@x.com", plan_tier: "basic" },
      { email: "a@x.com", plan_tier: "basic" },
      { email: "gone@x.com", plan_tier: "basic" },
      { email: "paid@x.com", plan_tier: "starter", subscription_status: "active" },
    ];
    expect(weeklyDigestRecipients(rows, new Set(["gone@x.com"]), MONDAY_6AM)).toEqual(["A@x.com"]);
  });
});

describe("weekly digest — when", () => {
  test("Mondays in New York only", () => {
    expect(newYorkWeekday(MONDAY_6AM)).toBe("Monday");
    expect(shouldSendWeeklyDigest(null, MONDAY_6AM)).toBe(true);
    expect(shouldSendWeeklyDigest(null, MONDAY_6AM + DAY)).toBe(false);
    // 02:00 UTC Monday is still Sunday evening in New York
    expect(shouldSendWeeklyDigest(null, Date.parse("2026-10-05T02:00:00Z"))).toBe(false);
  });

  test("never twice within 6 days, even when forced", () => {
    expect(shouldSendWeeklyDigest(new Date(MONDAY_6AM - 2 * DAY), MONDAY_6AM, true)).toBe(false);
    expect(shouldSendWeeklyDigest(new Date(MONDAY_6AM - 7 * DAY), MONDAY_6AM)).toBe(true);
    expect(shouldSendWeeklyDigest(null, MONDAY_6AM + 2 * DAY, true)).toBe(true);
  });

  test("the window is the past week, never more than 8 days", () => {
    expect(weeklyWindowStart(null, MONDAY_6AM).getTime()).toBe(MONDAY_6AM - 7 * DAY);
    expect(weeklyWindowStart(new Date(MONDAY_6AM - 7 * DAY), MONDAY_6AM).getTime()).toBe(MONDAY_6AM - 7 * DAY);
    expect(weeklyWindowStart(new Date(MONDAY_6AM - 30 * DAY), MONDAY_6AM).getTime()).toBe(MONDAY_6AM - 8 * DAY);
  });
});

describe("weekly digest — paid head start", () => {
  test("the listed window ends 7 days ago, and consecutive Mondays tile", () => {
    const first = weeklyWindowBounds(null, MONDAY_6AM);
    expect(first.end.getTime()).toBe(MONDAY_6AM - 7 * DAY);
    expect(first.start.getTime()).toBe(MONDAY_6AM - 14 * DAY);
    const next = weeklyWindowBounds(new Date(MONDAY_6AM), MONDAY_6AM + 7 * DAY);
    expect(next.start.getTime()).toBe(first.end.getTime());
    expect(next.end.getTime()).toBe(MONDAY_6AM);
  });

  test("the email counts the bids still in their head start", () => {
    const bid = { bid_id: 1, title: "Snow plowing", agency: "City", source_url: "https://x", location: "Ohio", due_date: null };
    const html = bidDigestHtml([bid], 1, { unsubscribeUrl: weeklyUnsubscribeUrl("t"), headStartCount: 12 });
    expect(html).toContain("+ 12 newer bids were posted in the last 7 days.");
    expect(bidDigestHtml([bid], 1, { unsubscribeUrl: weeklyUnsubscribeUrl("t") })).not.toContain("newer bid");
  });
});

describe("weekly digest — top 5 only (owner 2026-10-08)", () => {
  test("bids past the top 5 are pointed to Starter, not listed", () => {
    expect(WEEKLY_DIGEST_LIST_LIMIT).toBe(5);
    const bid = { bid_id: 1, title: "Snow plowing", agency: "City", source_url: "https://x", location: "Ohio", due_date: null };
    const html = bidDigestHtml([bid], 28, { unsubscribeUrl: weeklyUnsubscribeUrl("t") });
    expect(html).toContain("+ 27 more new bids on Starter.");
    expect(bidDigestHtml([bid], 28)).toContain("+ 27 more new bids on Contrax.");
  });
});

describe("weekly digest — email", () => {
  const bid = { bid_id: 1, title: "Snow plowing", agency: "City", source_url: "https://x", location: "Ohio", due_date: null };

  test("the weekly email names Starter and carries the unsubscribe link", () => {
    const url = weeklyUnsubscribeUrl("abc123");
    expect(url).toBe("https://www.contrax.company/api/email/weekly-unsubscribe?token=abc123");
    const html = bidDigestHtml([bid], 1, { unsubscribeUrl: url });
    expect(html).toContain("this past week");
    expect(html).toContain("Starter");
    expect(html).toContain("$19/month");
    expect(html).toContain(url);
  });

  test("the daily email is unchanged: no Starter pitch, no unsubscribe line", () => {
    const html = bidDigestHtml([bid], 1);
    expect(html).toContain("since your last digest");
    expect(html).not.toContain("weekly-unsubscribe");
    expect(html).not.toContain("$19/month");
  });
});

describe("founding offer in the free emails (owner 2026-10-03)", () => {
  const bid = { bid_id: 1, title: "Snow plowing", agency: "City", source_url: "https://x", location: "Ohio", due_date: null };
  const unsub = weeklyUnsubscribeUrl("t");

  test("weekly email pitches $9 for life while spots remain", () => {
    const html = bidDigestHtml([bid], 1, { unsubscribeUrl: unsub, foundingSpots: 7 });
    expect(html).toContain("$9/month for life");
    expect(html).toContain("7 spots left");
    expect(html).toContain("Claim a founding spot");
    expect(html).not.toContain("$19/month");
  });

  test("weekly email falls back to $19 when full or unknown", () => {
    for (const spots of [0, null, undefined]) {
      const html = bidDigestHtml([bid], 1, { unsubscribeUrl: unsub, foundingSpots: spots });
      expect(html).toContain("$19/month");
      expect(html).not.toContain("founding");
    }
  });

  test("radar match alert pitches the founding price only while spots remain", () => {
    expect(radarMatchAlertHtml([bid], 0, "https://u", 1)).toContain("(only 1 spot left)");
    const full = radarMatchAlertHtml([bid], 0, "https://u", 0);
    expect(full).toContain("Starter is $19/month");
    expect(full).not.toContain("founding");
    expect(radarMatchAlertHtml([bid], 0, "https://u")).toContain("Starter is $19/month");
  });

  test("starterPriceHtml", () => {
    expect(starterPriceHtml(3)).toContain("3 spots left");
    expect(starterPriceHtml(null)).toBe("$19/month");
  });
});
