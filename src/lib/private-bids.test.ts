import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PRIVATE_BID_REQUESTS, privateBidBySlug, privateBidPublished, publishedPrivateBids } from "./private-bids";

describe("private bid requests (owner 2026-11-18)", () => {
  test("every request has a unique slug, real places and the owner's permission on record", () => {
    const slugs = PRIVATE_BID_REQUESTS.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const r of PRIVATE_BID_REQUESTS) {
      expect(r.slug).toMatch(/^[a-z0-9-]+$/);
      expect(r.locations.length).toBeGreaterThan(0);
      expect(r.scope.length).toBeGreaterThan(0);
      expect(r.permission).toContain("permission");
    }
  });
  test("a request is published only once the owner has confirmed how to bid", () => {
    for (const r of PRIVATE_BID_REQUESTS) expect(privateBidPublished(r)).toBe(r.contact !== null);
    expect(publishedPrivateBids().every((r) => r.contact !== null)).toBe(true);
    expect(privateBidBySlug("nope")).toBeNull();
    expect(privateBidBySlug("kasselmann-hood-cleaning-ky-in")?.locations).toHaveLength(8);
    // The owner confirmed the address on 2026-11-18, so the first request is published.
    expect(publishedPrivateBids().map((r) => r.slug)).toContain("kasselmann-hood-cleaning-ky-in");
    expect(publishedPrivateBids().map((r) => r.slug)).toContain("advanced-pro-cleaning-salt-lake-city-warehouse");
    expect(privateBidBySlug("advanced-pro-cleaning-salt-lake-city-warehouse")?.deadline).toBe("2026-12-01");
    // A subcontract with no published pay says so instead of leaving it out.
    expect(privateBidBySlug("advanced-pro-cleaning-salt-lake-city-warehouse")?.scope.join(" ")).toContain("monthly pay is not in the notice");
  });
  test("the page shows a contact only when there is one, and is not indexed before that", () => {
    const page = readFileSync(new URL("../routes/private-bids.$slug.tsx", import.meta.url), "utf8");
    expect(page).toContain('privateBidPublished(loaderData) ? "index, follow" : "noindex, follow"');
    expect(page).toContain("We are confirming with the owner where bids should go.");
    expect(page).toContain("{PRIVATE_BIDS_DISCLAIMER}");
  });
});
