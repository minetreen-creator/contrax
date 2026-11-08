import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BID_CHECKLISTS, checklistBySlug, checklistHtml } from "./bid-checklists";
import { expandTrade } from "./trade-registry";

// Owner 2026-11-08: one-page downloadable bid checklists.
describe("bid checklists", () => {
  test("six checklists with unique slugs, each fitting one page", () => {
    expect(BID_CHECKLISTS.length).toBe(6);
    expect(new Set(BID_CHECKLISTS.map((c) => c.slug)).size).toBe(6);
    for (const c of BID_CHECKLISTS) {
      const items = c.sections.flatMap((s) => s.items);
      expect(items.length).toBeGreaterThan(15);
      expect(items.length).toBeLessThanOrEqual(36);
      expect(c.sections.map((s) => s.heading)).toContain("Submit");
      expect(expandTrade(c.trade).terms.length + expandTrade(c.trade).naicsCodes.length).toBeGreaterThan(0);
    }
    expect(checklistBySlug("municipal-landscaping-ifb")?.title).toBe("Municipal Landscaping IFB Checklist");
    expect(checklistBySlug("nope")).toBeNull();
  });

  test("never claims a rule applies to every bid", () => {
    const text = BID_CHECKLISTS.flatMap((c) => c.sections.flatMap((s) => s.items)).join("\n").toLowerCase();
    expect(text).not.toMatch(/\bfree\b/);
    expect(text).not.toMatch(/\bguarantee/);
    for (const c of BID_CHECKLISTS) expect(checklistHtml(c)).toContain("The solicitation and its addenda are the rules");
  });

  test("the download is a standalone, escaped HTML page", () => {
    const html = checklistHtml({ ...BID_CHECKLISTS[0], title: "A <b> & \"c\"" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("A &lt;b&gt; &amp; &quot;c&quot;");
    expect(html).toContain("@page{size:letter");
    expect(html).not.toMatch(/<script/i);
  });

  test("every checklist page is in the sitemap", () => {
    const sitemap = readFileSync(new URL("../../scripts/generate-sitemap.mjs", import.meta.url), "utf8");
    expect(sitemap).toContain('"/checklists"');
    for (const c of BID_CHECKLISTS) expect(sitemap).toContain(`"/checklists/${c.slug}"`);
  });
});
