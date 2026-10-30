import { describe, expect, test } from "bun:test";
import { expandTrade, isStrongTradeMatch, MAX_EXPANDED_TERMS, TRADE_ALIASES } from "./trade-registry";

// Owner 2026-10-30: "IT services, FL" returned 5 matches. The IT entry had grown
// past the term cap, so its newest phrases were dropped without a sound.
describe("trade term cap", () => {
  test("no registry entry has more synonyms than the cap keeps", () => {
    for (const [key, entry] of Object.entries(TRADE_ALIASES)) {
      // +1: the searched words themselves ride ahead of the synonyms.
      expect({ key, n: entry.synonyms.length + 1 <= MAX_EXPANDED_TERMS }).toEqual({ key, n: true });
    }
  });
});

describe("IT services matches everyday IT titles", () => {
  const it = expandTrade("IT services")!;
  const match = (t: string) => isStrongTradeMatch(t, null, null, null, it);
  test("titles seen on Florida's MFMP board and similar", () => {
    for (const t of [
      "ELECTRONIC HEALTH RECORD (EHR) SYSTEM",
      "CLOUD-BASED COMMUNICATIONS PLATFORM",
      "Case Management System Replacement",
      "Learning Management System",
      "Website Redesign and Hosting",
      "Microsoft 365 Licenses",
      "IT Staff Augmentation",
      "Computer Hardware",
      "Laptops and Desktops",
      "Network Equipment and Installation",
      "Data Analytics Platform",
    ]) expect({ t, m: match(t) }).toEqual({ t, m: true });
  });
  test("non-IT work stays out", () => {
    for (const t of [
      "HVAC System Replacement",
      "Stormwater Management System Improvements",
      "Fire Alarm System",
      "Hosting the Annual Festival: Tent Rental",
      "Network of Sidewalks Phase 2",
      "Janitorial Services",
    ]) expect({ t, m: match(t) }).toEqual({ t, m: false });
  });
});
