import { describe, expect, test } from "bun:test";
import { expandTrade, isStrongTradeMatch } from "./trade-registry";

// Owner 2026-11-08 (Mission Control: a "security guard" search in Ohio returned 0): open bids the
// security guard and low voltage searches missed, read from the live bid table that morning.
const strong = (trade: string, title: string) => isStrongTradeMatch(title, null, null, null, expandTrade(trade));

describe("security guard search", () => {
  test("guard work named by the place guarded, escorts and patrols", () => {
    for (const t of [
      "2027 Security Services at Recreation Centers, Pools, and Playgrounds",
      "INSCOM G-2 Access Control and Security Escorts (ACES)",
      "Security Patrol Services",
      "Event Security for the County Fair",
    ]) expect(`${strong("security guard", t)} | ${t}`).toBe(`true | ${t}`);
  });
  test("IT security, alarm systems and lighting stay out", () => {
    for (const t of ["Information Security Services", "Cybersecurity Services", "Security Systems", "LED Street Security Lighting Luminaires", "City of Holladay- Security Systems"])
      expect(`${strong("security guard", t)} | ${t}`).toBe(`false | ${t}`);
  });
});

describe("low voltage search", () => {
  test("camera, access control and intrusion jobs are low-voltage work", () => {
    for (const t of [
      "RFP#185-26 Intrusion, Monitoring & Security Camera Systems",
      "Access Control Improvements at Piedmont Virginia Community College, Multiple Campuses",
      "Request for Quotes - CCTV Camera System",
      "Intrusion Detection System Upgrade",
    ]) expect(`${strong("low voltage", t)} | ${t}`).toBe(`true | ${t}`);
  });
  test("water intrusion and sewer camera inspection stay out", () => {
    for (const t of ["Water Intrusion Repairs", "General Sanitary Sewer Cleaning, CCTV, Flow Control-Bypass Pumping"])
      expect(`${strong("low voltage", t)} | ${t}`).toBe(`false | ${t}`);
  });
});
