import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { bidPageHref } from "../components/RadarLoginNotify";

// Owner 2026-11-08: a new member saved a match from the dashboard banner and never opened a bid page.
describe("saved-match banner opens our bid page", () => {
  test("links go to the Contrax bid page, not the agency site", () => {
    expect(bidPageHref(123)).toBe("/bid/123");
    const src = readFileSync(new URL("../components/RadarLoginNotify.tsx", import.meta.url), "utf8");
    expect(src).not.toContain("source_url");
    expect(src).toContain("Open this bid");
    expect(src).toContain("/upgrade?plan=starter&source=saved_match");
  });

  test("save-all reports which bids it saved", () => {
    const api = readFileSync(new URL("../routes/api/radar-save-all.ts", import.meta.url), "utf8");
    expect(api).toContain("savedIds: toSave");
  });
});
