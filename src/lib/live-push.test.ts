import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { alertEligible, alertText, parseSubscription, subscriptionExpired } from "./live-push";

const visit = { ip: "73.12.34.56", path: "/radar", city: "Denver", region: "CO", internal: false };

describe("alertEligible", () => {
  test("a real visitor on a public page qualifies", () => {
    expect(alertEligible(visit)).toBe(true);
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
