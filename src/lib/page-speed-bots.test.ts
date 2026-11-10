import { expect, test } from "bun:test";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { automationMarker } from "~/lib/scraper-watch";
import { isBot } from "~/lib/tracking-intake";

// Owner 2026-11-10: the "Council Bluffs, IA" visitor the trail called a person.
const PTST = "Mozilla/5.0 (Linux; Android 8.1.0; Moto G (4)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36 PTST/261109.195727";
const PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36";

test("page-speed test agents are bots everywhere: intake, visitor counts and the trail", () => {
  expect(isBot(PTST)).toBe(true);
  expect(automationMarker(PTST)).toBe("ptst/");
  expect(automationMarker("Mozilla/5.0 ... Chrome-Lighthouse")).toBe("lighthouse");
  expect(BOT_EXCLUSION_SQL).toContain("LIKE '%ptst/%'");
  expect(BOT_EXCLUSION_SQL).toContain("LIKE '%lighthouse%'");
});

test("a real phone is not caught", () => {
  expect(isBot(PHONE)).toBe(false);
  expect(automationMarker(PHONE)).toBeNull();
});
