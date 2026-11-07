import { expect, test } from "bun:test";
import { expandTrade, isStrongTradeMatch } from "./trade-registry";
import { IN_STATE_SCAN_LIMIT } from "./radar-scan-query";

// Owner 2026-11-07: "Do the same check for other trades." Titles are live open listings from that day.
const check = (trade: string, yes: string[], no: string[]) => {
  const e = expandTrade(trade);
  for (const t of yes) expect([trade, t, isStrongTradeMatch(t, null, null, null, e)]).toEqual([trade, t, true]);
  for (const t of no) expect([trade, t, isStrongTradeMatch(t, null, null, null, e)]).toEqual([trade, t, false]);
};

test("electrical: generators, transformers, street lighting and signals", () => check("electrical",
  ["PUBLIC ANNOUNCEMENT FOR TRANSFORMER REPLACEMENT (PHASE II) ITB-27-049", "Generator Installation (Brighton)",
   "Valrico Reclaimed Water Facility Diesel Generator Project", "Maintenance of Street Lighting on all Roads Within the Miami Beach City Limits",
   "Traffic Signals Replacement", "27-002 Traffic Signalization & Street Lighting", "Emergency Generator Inspections and Repairs"],
  ["Electric Grid Edge Utility Analytic Services", "Purchase of Diesel Generator"]));

test("plumbing: backflow, water heaters, pipe and valve work", () => check("plumbing",
  ["FEMA Pipe and Valve Maintenance & Installation Services", "Backflow Preventer Testing and Repair", "Water Heater Replacement"],
  ["FLEXIBLE RUBBER PIPE COUPLINGS"]));

test("painting: recoating and floor coating", () => check("painting",
  ["STRUCTURE RECOATING OVER RAILROADS", "Greensville Recoating and Repairs to Water Tank 799-10887-1284", "Resinous Industrial Floor Coating Furnish and Install"],
  ["Paint Supplies"]));

test("security guards: armed and unarmed security services; guardrails and IT security stay out", () => {
  for (const trade of ["security guard", "security guards"]) check(trade,
    ["Service Center - Unarmed Security Services", "24 Hour Armed Security Services-ftw"],
    ["Main Line Guardrail IFB", "PCI Compliance and Information Security Services", "Lifeguard Headquarters Repairs"]);
});

test("landscaping, HVAC and waste hauling phrases", () => {
  check("landscaping",
    ["Irrigation System Maintenance & Service at Austin State Hospital (ASH)", "Blanket Contract(s) for Aquatic Herbicide Application Services",
     "Crossroads Park Athletic Fields & Turf Management", "Annual Litter Abatement Program"],
    ["Shelter Supplies : Cat Litter, Pro Sorb 20-30lb bags"]);
  check("hvac", ["Computer Room Air Conditioner (CRAC) System Replacement, Camp San Luis Obispo"], ["Student Nutrition Refrigerated Truck"]);
  check("waste hauling",
    ["Roll-Off Container Services", "S--IN PATOKA RIVER NWR DUMPSTER SERVICE", "Commercial Garbage Collection Services"],
    ["Wastewater Collection Rehab", "Trash Bags", "Diesel Powered Trash Pump", "Garbage and Recycling Containers", "Garbage Truck Purchase"]);
});

test("the state pass reads enough rows for big trades (HVAC/CA lost 35 of 75 at 100)", () => {
  expect(IN_STATE_SCAN_LIMIT).toBeGreaterThanOrEqual(1000);
});
