import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { EVERYDAY_SAMPLE_TRADES, isHandsOnWork, pickEverydaySample } from "./sample-bids";

// Owner 2026-10-31 homepage review: "fix all".
describe("homepage examples are everyday trades, not SDVOSB jargon", () => {
  test("one row per trade, in trade order, skipping unreadable titles", () => {
    const rows = [
      { naics_code: "561730", title: "Landscape Maintenance for Neighborhood Parcels", agency: "City of Virginia Beach" },
      { naics_code: "561720", title: "59--ACCESSORY KIT", agency: "DLA" },
      { naics_code: "561720", title: "Custodial Services for City Hall", agency: "Town of Cary" },
      { naics_code: "561730", title: "Mowing Services", agency: "County" },
      { naics_code: "561612", title: "Security Guard Services", agency: "Port Authority" },
    ];
    expect(pickEverydaySample(rows)).toEqual([2, 0, 4]);
    expect(EVERYDAY_SAMPLE_TRADES.map((t) => t.label)).toContain("Janitorial");
  });
  test("engineering, design and consulting contracts are not trade examples", () => {
    expect(isHandsOnWork("Request for Qualifications (RFQ) – Mechanical, Electrical and Plumbing (MEP) Engineering Basic Ordering Agreement Professional Services")).toBe(false);
    expect(isHandsOnWork("Design Services for Roof and HVAC Replacements")).toBe(false);
    expect(isHandsOnWork("Chiller and Ventilation Maintenance")).toBe(true);
    expect(isHandsOnWork("Janitorial Services - Crystal City")).toBe(true);
  });
  test("an agency's own listing beats an aggregator copy; the copy is the fallback", () => {
    const rows = [
      { naics_code: "561720", title: "Research Park Custodial Services", agency: "Washington Purchasing Group (BidNet Direct)", source: "wa_bidnet" },
      { naics_code: "561720", title: "Custodial Services for City Hall", agency: "City of Raleigh", source: "nc_raleigh" },
      { naics_code: "561730", title: "Lawn Weed Control Bid", agency: "Utah Purchasing Group (BidNet Direct)", source: "ut_bidnet" },
    ];
    expect(pickEverydaySample(rows)).toEqual([1, 2]);
  });
  test("the homepage uses the everyday sample and plain-English label", () => {
    const page = readFileSync("src/routes/index.tsx", "utf8");
    const finder = readFileSync("src/components/HomeContractFinder.tsx", "utf8");
    expect(page).toContain("getEverydaySample()");
    expect(page).not.toContain("getSdvosbSample");
    expect(finder).toContain("Open right now · a few real examples");
    expect(finder).not.toContain("Live SDVOSB opportunities");
  });
});

describe("homepage length and the phone chat bubble", () => {
  test("the example AI brief is collapsed behind one tap", () => {
    const page = readFileSync("src/routes/index.tsx", "utf8");
    const open = page.indexOf("<details");
    expect(open).toBeGreaterThan(-1);
    expect(page.indexOf('<ExampleBrief variant="embed" />')).toBeGreaterThan(open);
    expect(page).toContain("Show an example AI brief");
  });
  test("the floating AI chat bubble is gone; Max is the one assistant (owner 2026-11-01)", () => {
    const root = readFileSync("src/routes/__root.tsx", "utf8");
    expect(root).not.toContain("<ChatWidget");
    expect(readFileSync("src/routes/index.tsx", "utf8")).toContain("<MaxAssistant />");
  });
});
