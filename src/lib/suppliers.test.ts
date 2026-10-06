import { describe, expect, test } from "bun:test";
import { parseSupplierQuery, validateSupplierProfile } from "./suppliers";

const good = {
  company_name: "  Blue Ridge Mechanical LLC ",
  uei: "abc123def456",
  certifications: ["sdvosb", "SMALL", "SDVOSB"],
  naics: "238220, 238210",
  states: "va, nc",
  city: "Roanoke",
  capabilities: "Commercial HVAC installation and service for federal buildings.",
  website: "blueridgemech.com",
  contact_name: "Pat Lee",
  contact_email: "Pat@BlueRidgeMech.com",
  contact_phone: "",
};

describe("supplier directory (owner 2026-10-06, idea #8)", () => {
  test("a good listing is normalized", () => {
    const r = validateSupplierProfile(good);
    expect(r).toEqual({
      ok: true,
      profile: {
        company_name: "Blue Ridge Mechanical LLC",
        uei: "ABC123DEF456",
        certifications: ["SDVOSB", "SMALL"],
        naics: ["238220", "238210"],
        states: ["VA", "NC"],
        city: "Roanoke",
        capabilities: "Commercial HVAC installation and service for federal buildings.",
        website: "https://blueridgemech.com",
        contact_name: "Pat Lee",
        contact_email: "pat@blueridgemech.com",
        contact_phone: null,
        listed: true,
      },
    });
  });

  test("each required field gets a plain-words error", () => {
    const bad: Record<string, unknown>[] = [
      { company_name: "" },
      { uei: "short" },
      { certifications: ["GOLD"] },
      { naics: "" },
      { naics: "23822x" },
      { states: "" },
      { states: "Virginia" },
      { capabilities: "HVAC" },
      { website: "not a site" },
      { contact_name: "" },
      { contact_email: "nope" },
    ];
    for (const b of bad) {
      const r = validateSupplierProfile({ ...good, ...b });
      expect(r.ok).toBe(false);
    }
  });

  test("a business can hide its listing", () => {
    const r = validateSupplierProfile({ ...good, listed: false });
    expect(r.ok && r.profile.listed).toBe(false);
  });

  test("search filters ignore junk", () => {
    expect(parseSupplierQuery(new URLSearchParams("naics=2382&state=va&cert=hubzone&q=hvac"))).toEqual({ naics: "2382", state: "VA", cert: "HUBZONE", q: "hvac" });
    expect(parseSupplierQuery(new URLSearchParams("naics=abc&state=Virginia&cert=GOLD"))).toEqual({ naics: null, state: null, cert: null, q: null });
  });
});

describe("Prime Access plan", async () => {
  const { tierHasSupplierContacts, tierHasAwardLeads, isDataFeedTier, DATA_FEED_PLANS } = await import("./data-feed-billing.server");
  test("only Prime Access (and owner-granted plans) see contacts", () => {
    expect(tierHasSupplierContacts("primes")).toBe(true);
    expect(tierHasSupplierContacts(null)).toBe(true);
    for (const t of ["starter", "pro", "leads"]) expect(tierHasSupplierContacts(t)).toBe(false);
    expect(tierHasAwardLeads("primes")).toBe(false);
  });
  test("$199/month checkout tier", () => {
    expect(isDataFeedTier("primes")).toBe(true);
    expect(DATA_FEED_PLANS.primes.cents).toBe(19900);
  });
});
