import { describe, expect, test } from "bun:test";
import { KONAMI, MAX_TOOLS, maxEasterEgg, maxPrompt, parseMaxReply, sanitizeMaxHistory, stateCode } from "./max";

describe("Max replies", () => {
  test("parses the JSON reply and keeps only known CTAs and states", () => {
    expect(parseMaxReply(JSON.stringify({ say: "Found 3.", cta: "email", trade: "janitorial", state: "ut" }))).toEqual({ say: "Found 3.", cta: "email", trade: "janitorial", state: "UT" });
    expect(parseMaxReply(JSON.stringify({ say: "Hi", cta: "buy now", state: "ZZ" }))).toEqual({ say: "Hi", cta: null, trade: null, state: null });
    expect(parseMaxReply("plain text").say).toBe("plain text");
    expect(parseMaxReply("").say).toMatch(/lost my train/);
  });
  test("history keeps only user/assistant text, last 8", () => {
    const h = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
    expect(sanitizeMaxHistory([...h, { role: "system", content: "x" }, null])).toHaveLength(8);
    expect(sanitizeMaxHistory("nope")).toEqual([]);
  });
  test("states", () => {
    expect(stateCode("va")).toBe("VA");
    expect(stateCode("Virginia")).toBeNull();
  });
});

describe("Max's tools and prompt", () => {
  test("seven read-only lookups", () => {
    expect(MAX_TOOLS.map((t) => t.function.name)).toEqual(["search_open_bids", "bid_details", "state_overview", "recent_winners", "contracts_ending_soon", "industry_days", "prime_contractors"]);
  });
  test("the prompt forbids invented facts and requires lookups", () => {
    const p = maxPrompt("Sunday, October 25, 2026");
    expect(p).toContain("never invent a bid");
    expect(p).toContain("Always look things up with the tools");
  });
});

describe("Easter eggs", () => {
  test("secret phrases, any punctuation or case", () => {
    expect(maxEasterEgg("Show me the MONEY!")?.effect).toBe("money");
    expect(maxEasterEgg("do a barrel roll")?.effect).toBe("barrel");
    expect(maxEasterEgg("I am Ironman")?.effect).toBe("ironman");
    expect(maxEasterEgg("RED ALERT")?.effect).toBe("redalert");
    expect(maxEasterEgg("beam me up, Max")?.effect).toBe("beam");
    expect(maxEasterEgg("who made you?")?.say).toMatch(/Virginia/);
    expect(maxEasterEgg("tell me a joke", 0)?.say).toMatch(/ladder/);
  });
  test("ordinary questions go to the AI", () => {
    expect(maxEasterEgg("any cleaning contracts in Virginia?")).toBeNull();
    expect(maxEasterEgg("show me the bids in Ohio")).toBeNull();
  });
  test("konami code", () => {
    expect(KONAMI).toHaveLength(10);
  });
});
