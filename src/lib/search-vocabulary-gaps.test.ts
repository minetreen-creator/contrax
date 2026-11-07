import { expect, test } from "bun:test";
import { expandTrade, tradeTextIncludes } from "./trade-registry";

// Owner 2026-11-07 ("Do 1,2"): the 60-day Radar search log's thin searches. Read-only reach check
// (open bids, nationally): siding 21 -> 58, gutters 9 -> 58, windows 54 -> 149, insulation 37 -> 64,
// drywall 22 -> 28, well service 0 -> 31.
const hits = (q: string, title: string) => tradeTextIncludes(title, expandTrade(q));

test("each thin search now reaches the bids that trade actually posts", () => {
  expect(hits("siding", "Sharon Housing Trust: Siding, Windows, Doors, Trim, and Paint")).toBe(true);
  expect(hits("gutters", "Marshall M.S. Roof & Fascia Replacement")).toBe(true);
  expect(hits("insulation", "Spray Foam Applied Insulation at the Great Swamp Outdoor Education Center")).toBe(true);
  expect(hits("windows", "Acosta Operations Center (BP 04 - Interior Glazing) RE-BID")).toBe(true);
  expect(hits("drywall", "Law Enforcement/Emergency Ops Center - GYPSUM BOARD ASSEMLBIES")).toBe(true);
  expect(hits("well service", "Residential Well Drilling for One Home")).toBe(true);
});

test("window replacement is windows work, not janitorial; window cleaning stays janitorial", () => {
  const rep = expandTrade("window replacement");
  expect(rep.naicsCodes).toEqual(["238150"]);
  expect(rep.terms).not.toContain("janitorial");
  expect(expandTrade("window cleaning").terms).toContain("janitorial");
});

test("no false friends: a sewer wet well is not a water well", () => {
  expect(hits("well service", "Arcadia Wet Well Rehabilitation")).toBe(false);
  expect(expandTrade("well service").naicsCodes).toEqual([]); // 237110 is every water and sewer line job
  expect(expandTrade("roofing").terms).not.toContain("siding");
});
