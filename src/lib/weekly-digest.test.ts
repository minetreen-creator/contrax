import { describe, expect, test } from "bun:test";
import { bidDigestHtml } from "./email";
import {
  isWeeklyDigestEligible,
  newYorkWeekday,
  shouldSendWeeklyDigest,
  weeklyDigestRecipients,
  weeklyUnsubscribeUrl,
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
