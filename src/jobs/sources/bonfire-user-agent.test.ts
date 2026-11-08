import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BONFIRE_USER_AGENT } from "./bonfire-public";

// Owner 2026-11-08: "keep ContraxBot as the bot identity" — the Bonfire reader (169 boards)
// identified itself as desktop Chrome; it now says who it is.
describe("Bonfire reader identity", () => {
  test("it identifies as ContraxBot, not a browser", () => {
    expect(BONFIRE_USER_AGENT).toBe("Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)");
    expect(BONFIRE_USER_AGENT).not.toContain("Chrome/");
    const src = readFileSync(new URL("./bonfire-public.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/Chrome\/\d+\.0\.0\.0 Safari/);
  });
});
