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
  // Owner 2026-11-16: "Sector NOLA Water Treatment for HVAC · New Hampshire Agency · New Orleans, LA".
  test("a job located outside the state its source buys for is never an example", async () => {
    const { placeContradictsSource } = await import("./sample-bids");
    const nola = { naics_code: "238220", title: "Sector NOLA Water Treatment for HVAC", agency: "New Hampshire Purchasing Group (BidNet Direct)", source: "nh_bidnet", location: "New Orleans, LA" };
    expect(placeContradictsSource(nola)).toBe(true);
    expect(placeContradictsSource({ source: "nh_bidnet", location: "Concord, NH" })).toBe(false);
    expect(placeContradictsSource({ source: "nh_bidnet", location: "New Hampshire" })).toBe(false);
    // A federal source buys everywhere, and a row with no state in its location cannot contradict.
    expect(placeContradictsSource({ source: "sam_gov", location: "New Orleans, LA" })).toBe(false);
    expect(placeContradictsSource({ source: "nh_bidnet", location: null })).toBe(false);
    const rows = [nola, { naics_code: "238220", title: "Chiller and Ventilation Maintenance", agency: "City of Concord", source: "nh_bidnet", location: "Concord, NH" }];
    expect(pickEverydaySample(rows)).toEqual([1]);
    // With no clean row for the trade, the trade is left out: never the contradictory one.
    expect(pickEverydaySample([nola])).toEqual([]);
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
  test("the example AI brief is off the homepage (owner 2026-11-09 cleanup; it stays at /example-brief)", () => {
    const page = readFileSync("src/routes/index.tsx", "utf8");
    expect(page).not.toContain("<ExampleBrief");
    expect(page).not.toContain("Show an example AI brief");
  });
  test("the floating AI chat bubble is gone; Max is the one assistant (owner 2026-11-01)", () => {
    const root = readFileSync("src/routes/__root.tsx", "utf8");
    expect(root).not.toContain("<ChatWidget");
    // Owner 2026-11-06 ("hide the extra features"): Max is off the homepage too.
    expect(readFileSync("src/routes/index.tsx", "utf8")).not.toContain("<MaxAssistant />");
  });
});

// Owner 2026-11-16: "High-Impact Fixes to Tighten Conversion".
describe("homepage tightening", () => {
  const page = readFileSync("src/routes/index.tsx", "utf8");
  test("the trade and state search comes right after the two cards, before the bid preview", () => {
    expect(page.indexOf("<HomeChoice />")).toBeLessThan(page.indexOf("<HomeContractFinder sample"));
    expect(page.indexOf("<HomeContractFinder sample")).toBeLessThan(page.indexOf("<HomeBidPreview />"));
  });
  test("'Search open bids' is said once on the page's own text, and step one shows the morning email", () => {
    expect(page.match(/Search open bids/g)?.length).toBe(2); // the DIY card's label and its detail sentence
    expect(readFileSync("src/lib/brand-message.ts", "utf8")).not.toContain('cta: "Search open bids"');
    expect(page).toContain("<HomeExecutionLine sample={sample} />");
    expect(page).toContain("Your morning email · real bids open today");
    expect(page).toContain("const morning = sample.slice(0, 2);");
  });
  test("the done-for-you card names the scale, using only what the report includes", () => {
    const includes = readFileSync("src/lib/pipeline-report.ts", "utf8");
    expect(page).toContain("over the next 12 months: the 25 largest with who holds each one, the agency and the value, and the 10 companies holding the most");
    expect(includes).toContain("The 25 largest federal contracts");
    expect(includes).toContain("The 10 companies holding the most of it");
    expect(includes).toContain("The 12-month total");
    // The report has no buyer contact details, so the card must not promise them.
    expect(page).not.toMatch(/buyer contacts?/i);
  });
});
