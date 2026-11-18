import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FACEBOOK_ANONYMOUS_RADAR_RESULTS, FREE_ANONYMOUS_RADAR_RESULTS, anonymousPreviewLimit, isFacebookArrival } from "./radar-config";

describe("Facebook visitors see 10 bids before the locked card (owner 2026-11-18)", () => {
  test("only a Facebook arrival gets the larger preview", () => {
    expect(FREE_ANONYMOUS_RADAR_RESULTS).toBe(3);
    expect(FACEBOOK_ANONYMOUS_RADAR_RESULTS).toBe(10);
    expect(anonymousPreviewLimit(false)).toBe(3);
    expect(anonymousPreviewLimit(true)).toBe(10);
  });
  test("recognises Facebook referrers and tagged links, and nothing else", () => {
    expect(isFacebookArrival("https://facebook.com/", "/contracts-in/south-carolina/construction")).toBe(true);
    expect(isFacebookArrival("https://lm.facebook.com/", "/radar")).toBe(true);
    expect(isFacebookArrival("https://m.facebook.com/groups/1", "/")).toBe(true);
    expect(isFacebookArrival("", "/bid/5?utm_source=facebook&utm_medium=social")).toBe(true);
    expect(isFacebookArrival("https://www.google.com/", "/radar")).toBe(false);
    expect(isFacebookArrival("https://notfacebook.com/", "/radar")).toBe(false);
    expect(isFacebookArrival("https://facebook.com.evil.example/", "/radar")).toBe(false);
    expect(isFacebookArrival(null, "/radar?q=utm_source%3Dfacebook")).toBe(false);
  });
  test("the scan uses the limit for the preview and the locked ids, and tells the page", () => {
    const radar = readFileSync(new URL("../routes/radar.tsx", import.meta.url), "utf8");
    expect(radar).toContain("previewPool.slice(0, previewLimit)");
    expect(radar).toContain("matches.slice(previewLimit).map((m) => m.id)");
    expect(radar).toContain("previewLimit,");
    expect(radar).toContain("Math.min(totalMatches, freeCap)");
  });
});
