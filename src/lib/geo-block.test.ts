import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { geoBlocked } from "./geo-block";

describe("US-only access (owner 2026-11-05: Block non-US)", () => {
  const visit = (country: string | null, pathname = "/bid/941259") => geoBlocked({ country, pathname });

  test("non-US visitors are refused on pages and APIs", () => {
    for (const c of ["PK", "BD", "MX", "BR", "VN", "DZ", "AE", "IT", "AR", "pk"]) expect(visit(c)).toBe(true);
    expect(visit("PK", "/")).toBe(true);
    expect(visit("BD", "/api/event")).toBe(true);
    expect(visit("MX", "/signup")).toBe(true);
  });

  test("US states and territories, and an unknown country, are allowed", () => {
    for (const c of ["US", "PR", "GU", "VI", "AS", "MP", "UM", "us"]) expect(visit(c)).toBe(false);
    expect(visit(null)).toBe(false);
    expect(visit("")).toBe(false);
  });

  test("signed-in browsers are blocked too; machine endpoints never are", () => {
    expect(visit("IT", "/dashboard")).toBe(true);
    expect(visit("IT", "/admin/command")).toBe(true);
    for (const p of ["/api/stripe/webhook", "/api/webhooks/update", "/api/cron/sync-bids", "/robots.txt", "/sitemap.xml", "/sitemap-bids.xml", "/.well-known/security.txt"]) {
      expect(visit("IE", p)).toBe(false);
    }
  });

  test("the request entry refuses a geo-blocked request before anything else runs", () => {
    const entry = readFileSync("vercel-entry.ts", "utf8");
    const block = entry.indexOf("geoBlocked({");
    expect(block).toBeGreaterThan(0);
    expect(block).toBeLessThan(entry.indexOf('url.pathname === "/api/stripe/webhook"'));
    expect(entry).toContain('req.headers["x-vercel-ip-country"]');
  });
});
