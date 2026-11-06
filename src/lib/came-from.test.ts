import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cameFromLabel } from "./scraper-watch";

// Owner 2026-11-04, on a DC visitor who landed on /industry-days: "so how did they go right to that page?"
const r = (referrer: string | null, source: string | null = null, medium: string | null = null) => ({ referrer, source, medium });

describe("Visitor trail: where they came from", () => {
  test("search engines, social apps and AI assistants get plain names", () => {
    expect(cameFromLabel([r("https://www.google.com/")])).toBe("Google search");
    expect(cameFromLabel([r("https://www.bing.com/search?q=industry+days")])).toBe("Bing search");
    expect(cameFromLabel([r("https://l.facebook.com/l.php?u=x")])).toBe("Facebook");
    expect(cameFromLabel([r("https://m.facebook.com/")])).toBe("Facebook");
    expect(cameFromLabel([r("https://chatgpt.com/")])).toBe("ChatGPT");
    expect(cameFromLabel([r("https://www.linkedin.com/feed/")])).toBe("LinkedIn");
  });

  test("Contrax's own pages never count; the first outside site wins", () => {
    expect(cameFromLabel([r("https://www.contrax.company/radar"), r("https://sam.gov/opp/123")])).toBe("sam.gov");
  });

  test("a campaign tag is used when there is no outside referrer, else Direct", () => {
    expect(cameFromLabel([r(null, "fb_group")])).toBe("Campaign: fb_group");
    expect(cameFromLabel([r(null, "fb_group", "social")])).toBe("Campaign: fb_group (social)");
    expect(cameFromLabel([r(null, "direct", "(none)")])).toStartWith("Direct");
    expect(cameFromLabel([r("https://www.contrax.company/")])).toStartWith("Direct");
    expect(cameFromLabel([])).toStartWith("Direct");
    expect(cameFromLabel([r("not a url")])).toStartWith("Direct");
  });

  test("the panel shows it, and only the host is ever shown (never a full link)", () => {
    expect(readFileSync("src/routes/admin/live.tsx", "utf8")).toContain("Came from");
    expect(cameFromLabel([r("https://example.org/private?token=abc")])).toBe("example.org");
  });
});

describe("Industry Days in the site menu", () => {
  // Owner 2026-11-06 ("hide the extra features"): the header is Contracts and Pricing only;
  // /industry-days still works by direct link and search.
  test("the header no longer links to /industry-days", () => {
    expect(readFileSync("src/components/SiteHeader.tsx", "utf8")).not.toContain('href="/industry-days"');
  });
});

// Owner 2026-11-04: an iPhone visitor showed "Campaign: google". The saved
// first-arrival source "google" is a Google search (organic) unless it came
// with a Google Ads click id (cpc).
describe("first-arrival attribution reads plainly", () => {
  test("google organic is a Google search, google cpc is Google Ads", () => {
    expect(cameFromLabel([r(null, "google", "organic")])).toBe("Google search");
    expect(cameFromLabel([r(null, "google", "cpc")])).toBe("Google Ads");
    expect(cameFromLabel([r(null, "facebook", "social")])).toBe("Facebook");
    expect(cameFromLabel([r(null, "linkedin", "social")])).toBe("LinkedIn");
  });
});
