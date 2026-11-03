import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-03: /local-bids still said "Start my 7-day trial" after the
// trial ended (2026-11-01). The shared SEO template and the CEO post now send
// visitors to the search instead.
describe("no leftover trial buttons", () => {
  test("the SEO landing template and CEO post have no 'Start my 7-day trial'", () => {
    for (const f of ["src/lib/seo-landing.tsx", "src/components/CEOPosts.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toContain("Start my 7-day trial");
    }
    const seo = readFileSync("src/lib/seo-landing.tsx", "utf8");
    expect(seo).toContain("🔍 See open bids now →");
    expect(seo).toContain("No card to search · $5 for 30 days to open every notice · No automatic renewal");
    expect(seo).not.toContain("No credit card · Cancel anytime");
  });
});
