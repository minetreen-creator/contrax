import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import {
  BID_PACK_FILES, BID_PACK_PRICE, BID_PACK_PRICE_CENTS, BID_PACK_PRODUCT, BID_PACK_SESSION_RE,
  bidPackBuyerEmail, bidPackDownloadHref, bidPackOwnerNotice, paidBidPack,
} from "./bid-pack";
import { BID_PACK_BYTES, BID_PACK_ZIP_BASE64 } from "./bid-pack-file";

const paid = { mode: "payment", payment_status: "paid", amount_total: BID_PACK_PRICE_CENTS, currency: "usd", metadata: { product: BID_PACK_PRODUCT } };

/** File names in a ZIP, read from its central directory. */
function zipNames(buf: Buffer): string[] {
  const names: string[] = [];
  let i = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  while (i >= 0 && buf.readUInt32LE(i) === 0x02014b50) {
    const n = buf.readUInt16LE(i + 28), extra = buf.readUInt16LE(i + 30), comment = buf.readUInt16LE(i + 32);
    names.push(buf.subarray(i + 46, i + 46 + n).toString("utf8"));
    i += 46 + n + extra + comment;
    if (i + 4 > buf.length) break;
  }
  return names;
}

describe("Public Bid Paperwork Pack (owner 2026-11-27)", () => {
  test("only a paid session for this product at this price opens the download", () => {
    expect(paidBidPack(paid)).toBe(true);
    expect(paidBidPack({ ...paid, payment_status: "unpaid" })).toBe(false);
    expect(paidBidPack({ ...paid, amount_total: 100 })).toBe(false);
    expect(paidBidPack({ ...paid, mode: "subscription" })).toBe(false);
    expect(paidBidPack({ ...paid, metadata: { product: "state_winners_list" } })).toBe(false);
    expect(paidBidPack(null)).toBe(false);
    expect(BID_PACK_SESSION_RE.test("cs_live_a1B2c3D4e5F6")).toBe(true);
    expect(BID_PACK_SESSION_RE.test("../etc/passwd")).toBe(false);
    expect(bidPackDownloadHref("cs_live_a1B2c3D4e5F6")).toBe("/api/bid-pack/download?session=cs_live_a1B2c3D4e5F6");
  });

  test("the file sold is a real ZIP holding every document the page lists", () => {
    const zip = Buffer.from(BID_PACK_ZIP_BASE64, "base64");
    expect(zip.length).toBe(BID_PACK_BYTES);
    expect(zip.subarray(0, 2).toString("latin1")).toBe("PK");
    const names = zipNames(zip);
    expect(names.length).toBe(BID_PACK_FILES.length);
    for (const f of BID_PACK_FILES) expect(names.some((n) => n.toLowerCase().includes(f.name.toLowerCase()) && n.endsWith(".docx"))).toBe(true);
    void inflateRawSync; // the documents are themselves ZIPs; their text is checked when the pack is built
  });

  test("the price reads the same everywhere and the emails use bare links", () => {
    expect(BID_PACK_PRICE).toBe("$19");
    expect(BID_PACK_PRICE_CENTS).toBe(1900);
    const mail = bidPackBuyerEmail("cs_live_a1B2c3D4e5F6");
    expect(mail.text).toContain("www.contrax.company/bid-pack?session=cs_live_a1B2c3D4e5F6");
    expect(mail.text).not.toContain("https://");
    for (const f of BID_PACK_FILES) expect(mail.text).toContain(f.name);
    expect(bidPackOwnerNotice("cs_x", null).subject).toBe("Paid: Public Bid Paperwork Pack ($19)");
  });

  test("the download checks payment first, the hook runs before the plan flow, and the page is in the sitemap", () => {
    const dl = readFileSync("src/routes/api/bid-pack/download.ts", "utf8");
    expect(dl.indexOf("bidPackPaidForSession(session)")).toBeLessThan(dl.indexOf("BID_PACK_ZIP_BASE64"));
    expect(dl).toContain('"Cache-Control": "private, no-store"');
    const stripe = readFileSync("src/lib/stripe.ts", "utf8");
    expect(stripe).toContain("if (await handleBidPackEvent(event)) return { success: true };");
    expect(readFileSync("scripts/generate-sitemap.mjs", "utf8")).toContain('["/bid-pack", "monthly", "0.7"]');
    expect(readFileSync("public/sitemap.xml", "utf8")).toContain("<loc>https://www.contrax.company/bid-pack</loc>");
    // The file is served from server code only: it is not in the public folder.
    const page = readFileSync("src/routes/bid-pack.tsx", "utf8");
    expect(page).not.toContain("bid-pack-file");
    expect(page).not.toContain(".zip\"");
  });

  test("it is on the main page and the daily site check opens its Stripe checkout", () => {
    const home = readFileSync("src/routes/index.tsx", "utf8");
    expect(home).toContain("href={`${BID_PACK_PATH}?source=home`}");
    expect(home).toContain("{BID_PACK_NAME}");
    const checks = readFileSync("src/lib/path-checks.ts", "utf8");
    expect(checks).toContain('name: "Paperwork pack checkout opens ($19)"');
    expect(checks).toContain('path: "/api/bid-pack/checkout"');
    const server = readFileSync("src/lib/bid-pack.server.ts", "utf8");
    expect(server).toContain('client_reference_id: "contrax-path-check"');
  });
});
