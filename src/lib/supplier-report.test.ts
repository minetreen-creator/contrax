import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SUPPLIER_NOT_YET, SUPPLIER_PRICE, cleanSupplierRequest, supplierDay, supplierMoney, supplierNotice } from "./supplier-report";

describe("supplier report (owner 2026-11-18)", () => {
  test("a request needs a real email and a real state; the business type falls back", () => {
    expect(cleanSupplierRequest({ email: "nope", state: "SC" })).toEqual({ ok: false, error: "Enter the email address the report should go to." });
    expect(cleanSupplierRequest({ email: "a@b.co", state: "ZZ" })).toEqual({ ok: false, error: "Pick the state you sell in." });
    expect(cleanSupplierRequest(null).ok).toBe(false);
    expect(cleanSupplierRequest({ email: " Buyer@Truss.CO ", state: "sc", company: "  Carolina   Truss ", type: "made-up" })).toEqual({
      ok: true,
      request: { email: "buyer@truss.co", company: "Carolina Truss", type: "other", state: "SC" },
    });
  });
  test("the owner's notice names the company, business, state and email", () => {
    const m = supplierNotice({ email: "buyer@truss.co", company: "Carolina Truss", type: "materials", state: "SC" });
    expect(m.subject).toBe("Supplier report request: Carolina Truss, South Carolina");
    expect(m.text).toContain("Business: Building materials or supply");
    expect(m.text).toContain("Email: buyer@truss.co");
    expect(m.text).toContain(SUPPLIER_PRICE);
  });
  test("money and dates read plainly", () => {
    expect(supplierMoney(7918965)).toBe("$7.9 million");
    expect(supplierMoney(890535)).toBe("$890,535");
    expect(supplierMoney(1_300_000_000)).toBe("$1.3 billion");
    expect(supplierMoney(0)).toBe("");
    expect(supplierDay("2026-12-18T00:00:00.000Z")).toBe("Dec 18");
    expect(supplierDay("nonsense")).toBe("");
  });
  test("the page never promises local award winners, has no checkout, and the homepage links to it", () => {
    const page = readFileSync(new URL("../routes/suppliers.tsx", import.meta.url), "utf8");
    expect(SUPPLIER_NOT_YET).toContain("not in the report yet");
    expect(page).toContain("{SUPPLIER_NOT_YET}");
    expect(page).not.toContain("redirectToCheckout");
    expect(page).toContain('fetch("/api/supplier-report"');
    expect(readFileSync(new URL("../routes/index.tsx", import.meta.url), "utf8")).toContain('href="/suppliers"');
  });
});
