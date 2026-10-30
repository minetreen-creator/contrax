import { describe, expect, test } from "bun:test";
import { BLOCKED_USER_AGENT_SQL, blockedUserAgent } from "./blocked-user-agents";
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
});
