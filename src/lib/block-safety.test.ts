import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ACCESS_BLOCK_MESSAGE, GEO_BLOCK_MESSAGE } from "./geo-block";
import { BLOCK_DAYS } from "./ip-block.server";

// Owner 2026-11-08: anti-scraping must not lock out real contractors on shared phone or office addresses.
describe("blocks leave real contractors a way back", () => {
  test("blocked and out-of-country visitors see how to reach us", () => {
    expect(ACCESS_BLOCK_MESSAGE).toContain("contrax.companyllc@gmail.com");
    expect(GEO_BLOCK_MESSAGE).toContain("VPN");
    expect(GEO_BLOCK_MESSAGE).toContain("contrax.companyllc@gmail.com");
    expect(readFileSync(new URL("../../vercel-entry.ts", import.meta.url), "utf8")).toContain("res.end(ACCESS_BLOCK_MESSAGE)");
  });

  test("console IP blocks end after 30 days, and re-blocking restarts the clock", () => {
    expect(BLOCK_DAYS).toBe(30);
    expect(readFileSync(new URL("./ip-block.server.ts", import.meta.url), "utf8")).toContain("blocked_at > NOW() - make_interval(days => ${BLOCK_DAYS})");
    const api = readFileSync(new URL("../routes/api/admin/track-visitor.ts", import.meta.url), "utf8");
    expect(api).toContain("ON CONFLICT (ip) DO UPDATE SET blocked_at = NOW()");
  });

  test("an address a signed-in member used can't be blocked", () => {
    const api = readFileSync(new URL("../routes/api/admin/track-visitor.ts", import.meta.url), "utf8");
    expect(api).toContain("COUNT(DISTINCT user_id)::int AS members");
    expect(api).toContain("so it wasn't blocked.");
  });
});
