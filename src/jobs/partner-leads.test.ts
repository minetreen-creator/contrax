import { describe, expect, test } from "bun:test";
import { PARTNER_SEEDS } from "~/lib/outreach";
import { nameOnSite, PARTNER_LEADS } from "./partner-leads";

describe("reseller leads (owner 2026-11-15, 'We need more than 8')", () => {
  test("a lead's page must carry the firm's own name", () => {
    expect(nameOnSite("Road Map Consulting", "Welcome to RoadMap Consulting, LLC")).toBe(true);
    expect(nameOnSite("The Gormley Group", "TGG | The Gormley Group helps contractors")).toBe(true);
    expect(nameOnSite("Hinz Consulting", "Acme Roofing: proposal support for consulting firms")).toBe(false);
    expect(nameOnSite("24 Hour Company", "The 24 Hour Company makes proposal graphics")).toBe(true);
  });

  test("a name made only of common words proves nothing", () => {
    expect(nameOnSite("Global Consulting Group", "Global Consulting Group")).toBe(false);
  });

  test("every lead has a name that can be checked, an https site, and is not already a seed", () => {
    const seedHosts = new Set(PARTNER_SEEDS.map(([, site]) => new URL(site).host.replace(/^www\./, "")));
    const hosts = new Set<string>();
    for (const [name, site] of PARTNER_LEADS) {
      expect(nameOnSite(name, name)).toBe(true);
      expect(site.startsWith("https://")).toBe(true);
      const host = new URL(site).host.replace(/^www\./, "");
      expect(seedHosts.has(host)).toBe(false);
      expect(hosts.has(host)).toBe(false);
      hosts.add(host);
    }
  });
});
