import { expect, test } from "bun:test";
import { isStrongTradeMatch, naicsCodeExpansion } from "./trade-registry";

// Owner 2026-11-17: a Virginia visitor searched 518210, 238990 and 811310; each showed 3 matches.
test("a code search for specialty trades also finds untagged fencing, paving and striping bids by title", () => {
  const e = naicsCodeExpansion("238990")!;
  for (const title of ["Perimeter Fencing, Capital Project No. 2739", "D2 Fencing Maintenance and Repair Services", "Mill And Repave Power Plant Parking Lot - Asphalt Paving", "Pavement Markings", "Guardrail Rebuilding, Knox County", "Athletic Field Artificial Turf Replacement"]) {
    expect(isStrongTradeMatch(title, null, null, null, e)).toBe(true);
  }
  // Not this code's work, and no code on the row: stays out.
  for (const title of ["Janitorial Services for City Hall", "Parking Lot Sweeping Services", "Network Switch Replacement"]) {
    expect(isStrongTradeMatch(title, null, null, null, e)).toBe(false);
  }
  // A row tagged with the code is still a match whatever its title says.
  expect(isStrongTradeMatch("Miscellaneous Site Work", null, null, "238990", e)).toBe(true);
});

test("hosting and machinery repair codes read the words those bids use", () => {
  const hosting = naicsCodeExpansion("518210")!;
  expect(isStrongTradeMatch("Cloud Hosting Services for the Permitting System", null, null, null, hosting)).toBe(true);
  expect(isStrongTradeMatch("Colocation and Data Center Services", null, null, null, hosting)).toBe(true);
  expect(isStrongTradeMatch("Laptop Computers", null, null, null, hosting)).toBe(false);
  const repair = naicsCodeExpansion("811310")!;
  expect(isStrongTradeMatch("Emergency Generator Maintenance and Repair", null, null, null, repair)).toBe(true);
  expect(isStrongTradeMatch("Forklift Repair Services", null, null, null, repair)).toBe(true);
  expect(isStrongTradeMatch("Custodial Supplies", null, null, null, repair)).toBe(false);
});

test("the three codes carry more than a handful of phrases", () => {
  expect(naicsCodeExpansion("518210")!.terms.length).toBeGreaterThanOrEqual(12);
  expect(naicsCodeExpansion("238990")!.terms.length).toBeGreaterThanOrEqual(20);
  expect(naicsCodeExpansion("811310")!.terms.length).toBeGreaterThanOrEqual(14);
});
