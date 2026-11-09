import { describe, expect, test } from "bun:test";
import { expandTrade, isStrongTradeMatch } from "./trade-registry";

// Owner 2026-11-09: North Carolina electrical and Georgia security guard read 0 in-state in Radar,
// and Texas electrical missed about a third of its open jobs. Real open notice titles.
const strong = (trade: string, title: string) => isStrongTradeMatch(title, null, null, null, expandTrade(trade));

describe("electrical phrase gaps", () => {
  test.each([
    "IFB 2026-075 Union County Judicial Center Temporary Generator Connections",
    "Warren Correctional Interior Lighting Installation Upgrades",
    "IFB 2027-013A Ag and Event Center Lighting Project",
    "Generators Preventative Maintenance and Repairs Services",
    "Generator Preventative Maintenance IFB# 2026-071",
    "West Airfield Lighting Vault",
    "STATE LET CONSTRUCTION CONTRACT, ANDREWS CO, SAFETY LIGHTING AT INTERSECTION, ADDED",
    "Operational Support Contracted Services (Opening #6) - Lighting Maintenance and Repair",
  ])("matches: %s", (title) => expect(strong("electrical", title)).toBe(true));

  test.each([
    "Meymandi Concert Hall Stage Lighting Fixtures",
    "Orange County Electric Ice Resurfacer Acquisition",
    "Water, Sewer, and Electric SCADA Master Plan",
  ])("still no match: %s", (title) => expect(strong("electrical", title)).toBe(false));
});

describe("security guard phrase gaps", () => {
  test.each([
    "RFP #27007 On-Site Security Services Task Order Contract",
    "On-site Security Services Task Order Contract",
    "Pre-Advertisement Notice for On Call P.O.S.T Certified Security Services",
  ])("matches: %s", (title) => expect(strong("security guard", title)).toBe(true));

  test.each([
    "Managed Information Technology & Cybersecurity Services",
    "Managed Security Services for Network Monitoring",
  ])("IT security stays out: %s", (title) => expect(strong("security guard", title)).toBe(false));
});
