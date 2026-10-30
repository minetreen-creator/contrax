import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BLOCKED_USER_AGENT_SQL, HIDDEN_AD_CLICK_SQL, blockedUserAgent } from "./blocked-user-agents";
import { BOT_EXCLUSION_SQL } from "./bot-exclusion";
import { automationMarker } from "./scraper-watch";

// The NC "visitors" seen 2026-10-30, as the owner console printed them.
const SEEN = [
  "Mozilla/5.0 (Linux; Android 9; Redmi 5A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 9; Redmi 4A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Mobile Safari/537.36",
  // The other two variants in the 30-day check.
  "Mozilla/5.0 (Linux; Android 9; Redmi Note 5A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 9; Redmi Note 4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Mobile Safari/537.36",
];

const REAL = [
  // Current Chrome on Android (reduced UA), an iPhone, desktop Chrome, and a Redmi on current Chrome.
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Linux; Android 9; Redmi 5A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 11; Redmi Note 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Mobile Safari/537.36",
];

describe("blocked user agents", () => {
  test("the Redmi + Chrome 106 bot is matched", () => {
    for (const ua of SEEN) expect(blockedUserAgent(ua)).toBe("Redmi + Chrome 106 proxy bot");
  });

  test("real phones and browsers are not", () => {
    for (const ua of REAL) expect(blockedUserAgent(ua)).toBeNull();
    expect(blockedUserAgent("")).toBeNull();
    expect(blockedUserAgent(null)).toBeNull();
  });

  test("the SQL twin is part of the bot exclusion and the trail flags it", () => {
    expect(BOT_EXCLUSION_SQL).toContain(BLOCKED_USER_AGENT_SQL);
    // The SQL LIKE pieces are substrings of every matched UA.
    for (const ua of SEEN) {
      expect(ua).toContain("Android 9; Redmi ");
      expect(ua).toContain("Chrome/106.0.0.0 Mobile Safari/");
    }
    expect(automationMarker(SEEN[0])).toBe("Redmi + Chrome 106 proxy bot");
    expect(automationMarker(REAL[0])).toBeNull();
  });

  test("the Visitors board drops them too (its summary rows carry no user agent)", () => {
    const src = readFileSync(new URL("../routes/api/admin/journeys.ts", import.meta.url), "utf8");
    expect(src).toContain("BLOCKED_USER_AGENT_SQL");
    expect(src).toContain("blockedUaVids.has(");
  });

  test("the Houston / Fremont scanner networks are excluded from counts and the Visitors board", () => {
    expect(BOT_EXCLUSION_SQL).toContain("ip LIKE '69.25.91.%'");
    expect(BOT_EXCLUSION_SQL).toContain("ip LIKE '155.103.64.%'");
    const src = readFileSync(new URL("../routes/api/admin/journeys.ts", import.meta.url), "utf8");
    expect(src).toContain('ip.startsWith("69.25.91.")');
    expect(src).toContain('ip.startsWith("155.103.64.")');
  });

  test("Chrome 138 ad clicks are hidden from counts but never blocked", () => {
    const c138 = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";
    expect(blockedUserAgent(c138)).toBeNull();
    expect(automationMarker(c138)).toBeNull();
    expect(BOT_EXCLUSION_SQL).toContain(HIDDEN_AD_CLICK_SQL);
    expect(HIDDEN_AD_CLICK_SQL).toContain("medium,'') = 'cpc'");
    const src = readFileSync(new URL("../routes/api/admin/journeys.ts", import.meta.url), "utf8");
    expect(src).toContain("HIDDEN_AD_CLICK_SQL");
  });
});
