import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { etStamp, evidenceCsv, evidencePart, inReconBlock, isScraperFingerprint, EVIDENCE_COLUMNS } from "./scraper-evidence";

// Owner 2026-11-05: "do that" (save the scraper evidence for the lawyer).
const CHROME_119 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";
const FIREFOX_121 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";
const CHROME_141 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

describe("scraper evidence export", () => {
  test("keeps only the Nov 5 scraper's browsers", () => {
    expect(isScraperFingerprint(CHROME_119)).toBe(true);
    expect(isScraperFingerprint(FIREFOX_121)).toBe(true);
    expect(isScraperFingerprint(CHROME_141)).toBe(false);
    expect(isScraperFingerprint(null)).toBe(false);
  });

  test("recon rows are the two SkyQuantum /23 blocks only", () => {
    expect(inReconBlock("69.25.91.7")).toBe(true);
    expect(inReconBlock("155.103.64.200")).toBe(true);
    expect(inReconBlock("155.103.66.1")).toBe(false);
    expect(inReconBlock("169.25.90.1")).toBe(false);
  });

  test("only the two named parts are accepted", () => {
    expect(evidencePart("burst")).toBe("burst");
    expect(evidencePart("recon")).toBe("recon");
    expect(evidencePart("all")).toBeNull();
  });

  test("CSV quotes every cell, escapes quotes and defuses formulas", () => {
    const row = Object.fromEntries(EVIDENCE_COLUMNS.map((c) => [c, ""])) as Record<(typeof EVIDENCE_COLUMNS)[number], string>;
    const csv = evidenceCsv([{ ...row, path: '/bid/1?q="x"', referrer: "=HYPERLINK(1)" }]);
    expect(csv.split("\r\n")[0]).toBe(EVIDENCE_COLUMNS.join(","));
    expect(csv).toContain('"/bid/1?q=""x"""');
    expect(csv).toContain(`"'=HYPERLINK(1)"`);
  });

  test("times are written in Eastern time", () => {
    expect(etStamp(new Date("2026-11-05T17:20:05Z"))).toBe("2026-11-05 12:20:05");
  });

  test("the download is admin-only and linked from the Command Center", () => {
    const api = readFileSync("src/routes/api/admin/evidence-export.ts", "utf8");
    expect(api).toContain('if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 })');
    expect(api).toContain('"Cache-Control": "private, no-store"');
    expect(readFileSync("src/routes/admin/command.tsx", "utf8")).toContain("/api/admin/evidence-export?part=burst");
  });
});
