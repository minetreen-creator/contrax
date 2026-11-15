import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { alertEligible, alertText, chatReplyAlertText, hotAlertText, hotPushPage, parseSubscription, subscriptionExpired } from "./live-push";

const visit = { ip: "73.12.34.56", path: "/radar", city: "Denver", region: "CO", internal: false, verifiedHuman: true };

describe("alertEligible", () => {
  test("a real visitor on a public page qualifies", () => {
    expect(alertEligible(visit)).toBe(true);
  });

  test("unclassified visitors never alert, including when BotID is unavailable", () => {
    expect(alertEligible({ ...visit, verifiedHuman: false })).toBe(false);
  });

  test("admins, test accounts and admin pages never alert", () => {
    expect(alertEligible({ ...visit, internal: true })).toBe(false);
    expect(alertEligible({ ...visit, path: "/admin/live" })).toBe(false);
  });

  test("our test IP, Anthropic, crawlers and link previews never alert", () => {
    for (const ip of ["34.214.71.218", "160.79.106.4", "66.249.66.1", "157.240.1.1", "40.77.167.2"]) {
      expect(alertEligible({ ...visit, ip })).toBe(false);
    }
  });

  test("email link scanners from data-center towns never alert", () => {
    expect(alertEligible({ ...visit, city: "Boardman", region: "OR" })).toBe(false);
    expect(alertEligible({ ...visit, city: "Ashburn", region: "VA" })).toBe(false);
  });
});

test("intake shares the verified verdict across a batch and gates pushes on it", () => {
  const src = readFileSync("src/lib/tracking-intake.ts", "utf8");
  expect(src).toContain("botState.verifiedHuman = result.isBot === false");
  expect(src).toContain("verifiedHuman: botState.verifiedHuman");
  expect(src).toContain("handleIntake(itemRequest, undefined, i > 0, botState)");
});

describe("alertText", () => {
  test("new vs returning, place and device, never an IP or email", () => {
    const a = alertText({ city: "Denver", region: "CO", device: "mobile", returning: false, path: "/radar?trade=hvac", visitId: "v1" });
    expect(a.title).toContain("New visitor");
    expect(a.body).toBe("Denver, CO · Mobile · /radar");
    const b = alertText({ city: null, region: null, device: null, returning: true, path: "/", visitId: "v2" });
    expect(b.title).toContain("Returning");
    expect(b.body).toBe("Unknown location · Device unknown · /");
    expect(a.tag).not.toBe(b.tag);
  });
});

describe("parseSubscription", () => {
  const good = { endpoint: "https://web.push.apple.com/abc123", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } };
  test("accepts a real browser subscription", () => {
    expect(parseSubscription(good)).toEqual({ endpoint: good.endpoint, p256dh: good.keys.p256dh, auth: good.keys.auth });
  });
  test("rejects http, missing keys and junk", () => {
    expect(parseSubscription({ ...good, endpoint: "http://evil.test/x" })).toBeNull();
    expect(parseSubscription({ endpoint: good.endpoint })).toBeNull();
    expect(parseSubscription({ ...good, keys: { p256dh: "<script>", auth: "x" } })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
  });
});

describe("expired devices and authorization", () => {
  test("404 and 410 remove a subscription; other errors keep it", () => {
    expect(subscriptionExpired(404)).toBe(true);
    expect(subscriptionExpired(410)).toBe(true);
    expect(subscriptionExpired(500)).toBe(false);
    expect(subscriptionExpired(undefined)).toBe(false);
  });

  test("the push API requires an admin session and binds devices to that user", () => {
    const src = readFileSync("src/routes/api/admin/push.ts", "utf8");
    expect(src).toContain("if (!user.is_admin)");
    expect(src).toContain("saveSubscription(a.userId, sub)");
    const server = readFileSync("src/lib/live-push.server.ts", "utf8");
    expect(server).toContain("ON CONFLICT DO NOTHING RETURNING visitor_id");
  });
});

describe("hot-lead push (owner 2026-10-27)", () => {
  test("buy, Bid Scout, founding and data pages are hot; reading bids is not", () => {
    for (const p of ["/pricing", "/upgrade?plan=starter", "/signup", "/bid-scout", "/founding-businesses", "/data", "/post-checkout"]) {
      expect(hotPushPage(p)).toBe(true);
    }
    for (const p of ["/", "/radar", "/bid/123", "/contracts-in/texas/construction", "/admin/live", "/database"]) {
      expect(hotPushPage(p)).toBe(false);
    }
  });
  test("lock-screen text names place, device and page, never an IP", () => {
    const t = hotAlertText({ city: "Miami", region: "FL", device: "mobile", path: "/pricing?x=1", visitId: "v1" });
    expect(t.title).toBe("🔥 Hot lead on Contrax");
    expect(t.body).toBe("Someone in Miami, FL is looking at /pricing on their phone right now.");
    expect(t.tag).toBe("hot-v1");
  });
});

describe("chatReplyAlertText", () => {
  test("quotes the reply, opens Mission Control, one card per visitor", () => {
    const t = chatReplyAlertText({ visitorId: "v123", body: "  Yes, I do\n roofing in Tucson " });
    expect(t.title).toBe("💬 A visitor replied on Contrax");
    expect(t.body).toBe('"Yes, I do roofing in Tucson" Open Mission Control to answer.');
    expect(t.tag).toBe("chat-v123");
    expect(t.url).toBe("/admin/live");
  });
  test("long replies are cut short", () => {
    const t = chatReplyAlertText({ visitorId: "v", body: "x".repeat(500) });
    expect(t.body.startsWith(`"${"x".repeat(139)}…"`)).toBe(true);
  });
});

// Owner 2026-11-15: "he's been on the upgrade pages the other day but never upgrades" → "yes".
test("a signed-in account back on a buy page without a plan alerts once a day, with no email or IP", async () => {
  const { repeatUpgradeEligible, repeatUpgradePage, repeatUpgradeText } = await import("./live-push");
  const { readFileSync } = await import("node:fs");
  expect(repeatUpgradePage("/upgrade?plan=starter")).toBe(true);
  expect(repeatUpgradePage("/pricing")).toBe(true);
  expect(repeatUpgradePage("/signup")).toBe(false);
  const free = { subscription_status: null, full_access: false, plan_tier: "basic" };
  // The first look is not a pattern; the second is.
  expect(repeatUpgradeEligible(free, 0)).toBe(false);
  expect(repeatUpgradeEligible(free, 1)).toBe(true);
  // Paying, granted, demo and unknown accounts never alert.
  expect(repeatUpgradeEligible({ ...free, subscription_status: "active" }, 3)).toBe(false);
  expect(repeatUpgradeEligible({ ...free, full_access: true }, 3)).toBe(false);
  expect(repeatUpgradeEligible({ ...free, plan_tier: "demo" }, 3)).toBe(false);
  expect(repeatUpgradeEligible(undefined, 3)).toBe(false);
  const t = repeatUpgradeText({ userId: "412", day: "2026-11-15", city: "Port Saint Lucie", region: "FL", earlierVisits: 1 });
  expect(t.body).toContain("Port Saint Lucie, FL");
  expect(t.body).toContain("2nd time");
  expect(t.body).not.toMatch(/@|\d+\.\d+\.\d+\.\d+/);
  expect(t.tag).toBe("upgrade-repeat-412-2026-11-15");
  const server = readFileSync("src/lib/live-push.server.ts", "utf8");
  expect(server).toContain("VALUES ('upgrade-repeat', ${key})");
  const intake = readFileSync("src/lib/tracking-intake.ts", "utf8");
  expect(intake).toContain("if (userId && repeatUpgradePage(pagePath))");
});
