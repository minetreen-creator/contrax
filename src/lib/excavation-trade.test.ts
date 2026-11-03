import { describe, expect, test } from "bun:test";
import { expandTrade, isStrongTradeMatch } from "./trade-registry";

// Owner 2026-11-03: a Greenwood, SC visitor searched "Excavation" and got 2
// matches. Governments post excavation work as site work, clearing and
// grubbing, culverts, ditches, trenching, drainage, ponds and mains.
const e = expandTrade("Excavation");
const m = (t: string) => isStrongTradeMatch(t, null, null, null, e);

describe("Excavation & Site Work", () => {
  test("is its own trade (NAICS 238910) with the words governments use", () => {
    expect(e.naicsCodes).toEqual(["238910"]);
    for (const w of ["sitework", "clearing and grubbing", "culvert", "trenching", "detention pond", "water main"]) expect(e.terms).toContain(w);
  });
  test("matches the jobs excavators bid", () => {
    for (const t of [
      "Sitework Improvements at Elementary School",
      "Clearing and Grubbing",
      "Culvert Replacement on County Road 12",
      "Ditch Cleaning and Maintenance",
      "Trenching Services",
      "Drainage Improvements",
      "Water Main Replacement",
      "Detention Pond Construction",
      "Excavation and Backfill for Water Main",
      "Grading Services for Park",
    ]) expect(m(t)).toBe(true);
  });
  test("equipment and material buys are not excavation work", () => {
    for (const t of ["Excavator Rental", "Purchase of One Mini Excavator", "Culvert Pipe Purchase", "Interior Plumbing Repair"]) expect(m(t)).toBe(false);
  });
});
