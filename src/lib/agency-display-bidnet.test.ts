import { expect, test } from "bun:test";
import { agencyDisplay } from "~/lib/bid-job-summary";
import { collapseAggregatorMirrors } from "~/lib/notice-dedupe";

test("a BidNet purchasing group is not shown as the buyer (owner 2026-11-10)", () => {
  expect(agencyDisplay("Connecticut Purchasing Group (BidNet Direct)")).toBe("A Connecticut public agency (posted on BidNet Direct)");
  expect(agencyDisplay("Empire State Purchasing Group (BidNet Direct)")).toBe("A New York public agency (posted on BidNet Direct)");
  expect(agencyDisplay("Virginia & DC Purchasing Group (BidNet Direct)")).toBe("A Virginia or DC public agency (posted on BidNet Direct)");
  expect(agencyDisplay("Ohio Purchasing Group (BidNet Direct)")).toBe("An Ohio public agency (posted on BidNet Direct)");
  expect(agencyDisplay("Idaho Purchasing Group (BidNet Direct)")).toBe("An Idaho public agency (posted on BidNet Direct)");
  expect(agencyDisplay("Utah Purchasing Group (BidNet Direct)")).toBe("A Utah public agency (posted on BidNet Direct)");
  expect(agencyDisplay("City of New London")).toBe("City of New London");
});

test("the New London janitorial job listed by CTsource and BidNet a day apart counts once", () => {
  const rows = [
    { id: 1, title: "Janitorial Services for Community Recreation Center", agency: "City of New London", source: "ct_webprocure", due_date: "2026-12-02T19:00:00Z" },
    { id: 2, title: "Janitorial Services for Community Recreation Center", agency: "Connecticut Purchasing Group (BidNet Direct)", source: "ct_bidnet", due_date: "2026-12-04T04:59:00Z" },
    { id: 3, title: "Janitorial Services", agency: "Connecticut Purchasing Group (BidNet Direct)", source: "ct_bidnet", due_date: "2026-11-22T04:59:00Z" },
  ];
  expect(collapseAggregatorMirrors(rows).rows.map((r) => r.id)).toEqual([1, 3]);
});

test("Max's bid search and the morning email collapse BidNet copies too", async () => {
  const { readFileSync } = await import("node:fs");
  expect(readFileSync("src/lib/max.server.ts", "utf8")).toContain("collapseAggregatorMirrors(rows).rows.filter(");
  expect(readFileSync("src/lib/digest-inputs.server.ts", "utf8")).toContain("await dropAggregatorMirrors(rows)");
});

// Owner 2026-11-11: the Radar bid list still read "Ohio Purchasing Group (BidNet Direct)" as the buyer.
test("public bid lists show the readable buyer label, not the BidNet group", async () => {
  const { readFileSync } = await import("node:fs");
  const files = [
    "src/routes/radar.tsx", "src/routes/app.tsx", "src/routes/map.tsx", "src/routes/awards.tsx", "src/routes/learn/government-contracting.tsx",
    "src/routes/contracts-hvac-mechanical.tsx", "src/components/HomeContractFinder.tsx", "src/components/OpenToAllBids.tsx", "src/components/MarketPage.tsx",
    "src/components/EmailSample.tsx", "src/components/LiveOpportunities.tsx", "src/components/RadarLoginNotify.tsx", "src/components/SavedRadarMatches.tsx",
  ];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    expect({ f, uses: src.includes("agencyDisplay(") }).toEqual({ f, uses: true });
    expect({ f, raw: /\{\[(?:b|bid)\.agency,|>\{(?:b|bid|m)\.agency\}</.test(src) }).toEqual({ f, raw: false });
  }
  expect(readFileSync("src/routes/radar.tsx", "utf8")).toContain("{[agencyDisplay(b.agency), due(b.due_date) && `due ${due(b.due_date)}`]");
});
