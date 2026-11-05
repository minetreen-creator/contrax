import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { decodeWatermarks, encodeWatermark, newWatermarkToken, watermarkText } from "./bid-watermark";

describe("bid page watermark (owner 2026-11-05: Do all)", () => {
  test("a token survives encode → copy → decode, invisibly", () => {
    const t = newWatermarkToken();
    expect(t).toMatch(/^[0-9a-f]{8}$/);
    const text = watermarkText("Janitorial services for three county buildings.", t);
    expect(text.replace(/[⁠​‌]/g, "")).toBe("Janitorial services for three county buildings.");
    expect(decodeWatermarks(text)).toEqual([t]);
    // Pasted with other text around it, twice.
    expect(decodeWatermarks(`Scraped: ${text} and again ${text}`)).toEqual([t]);
  });

  test("two different visits are told apart", () => {
    const a = "0badf00d", b = "deadbeef";
    expect(decodeWatermarks(watermarkText("One bid.", a) + " " + watermarkText("Another bid.", b))).toEqual([a, b]);
  });

  test("no token, a bad token or plain text change nothing", () => {
    expect(watermarkText("Plain.", null)).toBe("Plain.");
    expect(encodeWatermark("xyz")).toBe("");
    expect(decodeWatermarks("No marks here")).toEqual([]);
    expect(decodeWatermarks(null)).toEqual([]);
  });

  test("the bid page records and renders it; the lookup is admin only and returns no IP", () => {
    const page = readFileSync("src/routes/bid.$bidId.tsx", "utf8");
    expect(page).toContain("recordBidWatermark(Number(r.id))");
    expect(page).toContain("watermarkText(");
    const server = readFileSync("src/lib/bid-watermark.server.ts", "utf8");
    expect(server).toContain('createHash("md5")');
    expect(server).not.toMatch(/SELECT[^`]*\bpv\.ip\b[^`]*FROM/);
    const api = readFileSync("src/routes/api/admin/watermark.ts", "utf8");
    expect(api).toContain("if (!user.is_admin)");
  });
});
