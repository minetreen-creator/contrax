import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PREVIEW_TRADES, PREVIEW_TAB_LABEL, previewDay, previewExcerpt, previewStateHref, wordCount } from "./bid-preview";
import { SEO_TRADE_BY_SLUG } from "./seo-trades";

// Owner 2026-11-16: the homepage bid preview. Real open bids only; nothing invented.
describe("homepage bid preview", () => {
  test("every tab is a trade the site has pages for, janitorial first", () => {
    expect(PREVIEW_TRADES[0]).toBe("janitorial");
    for (const t of PREVIEW_TRADES) {
      expect(SEO_TRADE_BY_SLUG[t]).toBeTruthy();
      expect(PREVIEW_TAB_LABEL[t].length).toBeGreaterThan(2);
    }
  });

  test("the excerpt keeps the notice's own words and ends at a sentence when it can", () => {
    const short = "Clean four buildings.  Monday to Friday.";
    expect(previewExcerpt(short)).toBe("Clean four buildings. Monday to Friday.");
    const long = `${"The contractor shall furnish all labor and supervision. ".repeat(30)}`;
    const cut = previewExcerpt(long, 300);
    expect(cut.length).toBeLessThanOrEqual(300);
    expect(cut.endsWith(".")).toBe(true);
    expect(long.replace(/\s+/g, " ").startsWith(cut)).toBe(true);
    const noStops = "word ".repeat(200);
    expect(previewExcerpt(noStops, 100).endsWith("…")).toBe(true);
    expect(wordCount("a  b\nc")).toBe(3);
  });

  test("the state picker opens that state's open bids for the trade", () => {
    expect(previewStateHref("New York", "janitorial")).toBe("/contracts-in/new-york/janitorial?source=home_bid_preview");
    expect(previewDay("2026-12-04")).toBe("Dec 4, 2026");
    expect(previewDay("2026-12-04T15:00:00Z")).toBe("Dec 4, 2026");
    expect(previewDay("TBD")).toBe("TBD");
  });

  test("the loader only reads stored briefs and applies the example rules; the widget invents nothing", () => {
    const fn = readFileSync("src/lib/bid-preview-fn.ts", "utf8");
    expect(fn).toContain("selectExampleBrief(candidates, now).best");
    expect(fn).toContain("b.ai_summary IS NOT NULL");
    expect(fn).not.toContain("generateAndStoreBrief");
    const ui = readFileSync("src/components/HomeBidPreview.tsx", "utf8");
    for (const invented of ["Match", "Fit Score", "CleanPro", "Page 19", "48-Page"]) expect(ui).not.toContain(invented);
    expect(ui).toContain("if (!previews?.length || !p) return null;");
    expect(readFileSync("src/routes/index.tsx", "utf8")).toContain("<HomeBidPreview />");
  });
});
