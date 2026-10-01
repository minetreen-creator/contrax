import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  DIGEST_TIER_ORDER,
  DIGEST_TRIAL_DAYS,
  digestBidsToList,
  digestRecipients,
  digestWindowStart,
  isDigestEligible,
  type DigestUserRow,
} from "~/lib/digest-recipients";
import { computeTrialStatus, TIER_ORDER } from "~/lib/trial";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const ahead = (days: number) => new Date(NOW + days * DAY).toISOString();

const user = (over: Partial<DigestUserRow>): DigestUserRow => ({ email: "owner@example.com", ...over });

describe("bid digest goes to paying users only", () => {
  test("free Basic users do not get it", () => {
    expect(isDigestEligible(user({ plan_tier: "basic" }), NOW)).toBe(false);
    expect(isDigestEligible(user({ plan_tier: null }), NOW)).toBe(false);
    expect(isDigestEligible(user({}), NOW)).toBe(false);
  });

  test("paying Starter+ subscribers get it", () => {
    for (const tier of ["starter", "professional", "agency"]) {
      expect(isDigestEligible(user({ plan_tier: tier, subscription_status: "active" }), NOW)).toBe(true);
    }
  });

  test("a running trial gets it; an expired trial does not", () => {
    expect(isDigestEligible(user({ plan_tier: "professional", trial_started_at: ago(3) }), NOW)).toBe(true);
    expect(isDigestEligible(user({ plan_tier: "professional", trial_started_at: ago(15) }), NOW)).toBe(false);
  });

  test("admins and Bid Scout subscribers get it whatever their tier", () => {
    expect(isDigestEligible(user({ is_admin: true }), NOW)).toBe(true);
    expect(isDigestEligible(user({ email: "minetreen@gmail.com" }), NOW)).toBe(true);
    expect(isDigestEligible(user({ plan_tier: "basic", has_bid_scout: true }), NOW)).toBe(true);
  });

  test("an access grant counts only while it runs", () => {
    expect(isDigestEligible(user({ full_access: true, access_expires_at: ahead(5) }), NOW)).toBe(true);
    expect(isDigestEligible(user({ full_access: true, access_expires_at: ago(1) }), NOW)).toBe(false);
    expect(isDigestEligible(user({ plan_tier: "professional", access_expires_at: ago(1), subscription_status: "active" }), NOW)).toBe(false);
  });

  test("the demo tier and blank emails never get it", () => {
    expect(isDigestEligible(user({ plan_tier: "demo" }), NOW)).toBe(false);
    expect(isDigestEligible(user({ email: " ", is_admin: true }), NOW)).toBe(false);
  });

  test("agrees with computeTrialStatus on expiry for Starter+ tiers", () => {
    expect(DIGEST_TIER_ORDER).toEqual(TIER_ORDER);
    expect(DIGEST_TRIAL_DAYS).toBe(14);
    const cases: Partial<DigestUserRow>[] = [
      { trial_started_at: ago(1) },
      { trial_started_at: ago(13) },
      { trial_started_at: ago(20) },
      { trial_started_at: ago(20), subscription_status: "active" },
      { trial_started_at: null },
      { access_expires_at: ahead(2) },
      { access_expires_at: ago(2) },
    ];
    for (const tier of ["starter", "professional", "agency"]) {
      for (const c of cases) {
        const row = user({ plan_tier: tier, ...c });
        const status = computeTrialStatus(row.trial_started_at, row.plan_tier, row.subscription_status, row.access_expires_at, !!row.full_access);
        expect(`${tier} ${JSON.stringify(c)} -> ${isDigestEligible(row, NOW)}`).toBe(`${tier} ${JSON.stringify(c)} -> ${!status.expired}`);
      }
    }
  });

  test("the recipient list drops ineligible users and duplicate addresses", () => {
    const rows: DigestUserRow[] = [
      { email: "free@example.com", plan_tier: "basic" },
      { email: "Paid@example.com", plan_tier: "starter", subscription_status: "active" },
      { email: "paid@example.com", plan_tier: "starter", subscription_status: "active" },
      { email: "scout@example.com", has_bid_scout: true },
    ];
    expect(digestRecipients(rows, NOW)).toEqual(["Paid@example.com", "scout@example.com"]);
  });
});

describe("digest bid list", () => {
  test("lists the soonest deadlines first, undated last, capped", () => {
    const bids = [
      { id: 1, due_date: "2026-11-01T00:00:00Z" },
      { id: 2, due_date: null },
      { id: 3, due_date: "2026-10-05T00:00:00Z" },
      { id: 4, due_date: "2026-10-20T00:00:00Z" },
    ];
    expect(digestBidsToList(bids).map((b) => b.id)).toEqual([3, 4, 1, 2]);
    expect(digestBidsToList(bids, 2).map((b) => b.id)).toEqual([3, 4]);
  });
});

describe("emails go out once a day, in the morning", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

  test("the 4-hourly sync sends no email", () => {
    const runner = read("src/jobs/runner.ts");
    expect(runner).not.toContain("SELECT email FROM users`");
    expect(runner).not.toContain("sendBidDigest(");
    const sync = read(".github/workflows/sync-bids.yml");
    expect(sync).not.toContain("run: bun run radar-alerts");
  });

  test("the daily workflow sends the digest and the Radar alerts each morning", () => {
    const daily = read(".github/workflows/daily-emails.yml");
    // 6 AM Eastern: 10:00 UTC in summer, 11:00 UTC in winter; a gate keeps one
    expect(daily).toContain('cron: "0 10 * * *"');
    expect(daily).toContain('cron: "0 11 * * *"');
    expect(daily).toContain("TZ=America/New_York date +%H");
    expect(daily).toContain('[ "$hour" = "06" ]');
    expect(daily).toContain("run: bun run bid-digest");
    expect(daily).toContain("run: bun run radar-alerts");
    expect(read("package.json")).toContain('"bid-digest": "bun run src/jobs/send-bid-digest.ts"');
  });

  test("the morning digest uses the paid-recipient rule and logs only real sends", () => {
    const job = read("src/jobs/send-bid-digest.ts");
    expect(job).toContain("digestRecipients(users)");
    expect(job).toContain("digestWindowStart(");
    expect(job).toMatch(/if \(sent\) \{\s*await sql\(\)`\s*INSERT INTO bid_digest_log/);
  });

  test("the window starts at the last real send, 24h with none, at most 48h back", () => {
    const now = Date.parse("2026-10-02T11:50:00Z");
    expect(digestWindowStart(null, now).toISOString()).toBe("2026-10-01T11:50:00.000Z");
    expect(digestWindowStart("2026-10-01T11:52:00Z", now).toISOString()).toBe("2026-10-01T11:52:00.000Z");
    expect(digestWindowStart("2026-09-20T11:50:00Z", now).toISOString()).toBe("2026-09-30T11:50:00.000Z");
  });
});
