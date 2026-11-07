import { expect, test } from "bun:test";
import { expandTrade, isStrongTradeMatch, RELATED_TRADE_TERMS } from "./trade-registry";

// Owner 2026-11-07: "Recent search only showed 6 trucking bids in VA?" Titles below are live open
// Virginia listings from that day.
const trucking = expandTrade("trucking");
const strong = (title: string) => isStrongTradeMatch(title, null, null, null, trucking);

test("hauling work worded without 'trucking' is now a trucking match", () => {
  for (const t of [
    "IFB# 161286 Delivered Aggregate - MsVille",
    "161314 Delivered Aggregate Loudoun County",
    "ITB 27-271156/SW ROLL-OFF DUMPSTER RENTALS",
    "ITB - Biosolids Management Services",
    "Dump Truck Hauling Services - On Call",
    "161225 Material Hauling Services",
  ]) expect(strong(t)).toBe(true);
});

test("truck care, vehicle buys, salt supply and buses stay out", () => {
  for (const t of [
    "TRUCK WASHING SERVICES FOR HEAVY EQUIPMENT",
    "Truck Alignment Parts and Services",
    "Rock Salt (Sodium Chloride)",
    "School Bus Transportation",
    "Dump Truck Purchase",
    "2026 Mack Dump Truck",
  ]) expect(strong(t)).toBe(false);
});

test("VDOT M7B snow contracts and towing are related trucking work, not default matches", () => {
  expect(strong("2026-2027 M7B Snow Removal Services Harrisonburg Residency")).toBe(false);
  for (const t of ["m7b", "m-7b", "snow removal equipment", "emergency towing", "towing services"]) {
    expect(RELATED_TRADE_TERMS.trucking).toContain(t);
  }
  expect(RELATED_TRADE_TERMS.hauling).toBe(RELATED_TRADE_TERMS.trucking);
});
