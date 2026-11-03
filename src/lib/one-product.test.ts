import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { filterBidsToState, type SeoBid } from "./seo-landing";

// Owner 2026-11-03 ("do 2 and 3"): only the search and the $5 pass are offered
// until there are paying customers, and the state + trade pages (Texas mowing &
// landscaping first) read like a contractor would say it.
const read = (f: string) => readFileSync(f, "utf8");

describe("one product on the public pages", () => {
  test("no other products in the homepage footer, SEO footer, bid cards or bid page", () => {
    const home = read("src/routes/index.tsx");
    for (const gone of ['label: "Grants"', 'label: "Bid Data API"', 'label: "Award Leads"', 'label: "Supplier Directory"', 'label: "Veterans Against Diabetes"', "<SubLeads"]) {
      expect(home).not.toContain(gone);
    }
    const seo = read("src/lib/seo-landing.tsx");
    for (const gone of [">Bid Data API<", ">Award Leads<", ">Supplier Directory<", "$49 Bid Fit Review"]) expect(seo).not.toContain(gone);
    expect(read("src/routes/bid.$bidId.tsx")).not.toContain("$49 Bid Fit Review");
  });
});

describe("state + trade pages", () => {
  const bid = (id: number, title: string, due: string | null): SeoBid =>
    ({ id, title, agency: null, description: null, due_date: due, estimated_value: null, naics_code: null, location: "Austin, TX", set_aside: null, source_url: null, source: null, head_start_until: null }) as SeoBid;
  test("sorted by the real date (not the weekday in a date string), one row per job", () => {
    const rows = [
      bid(1, "Landscape", "Fri Jun 04 2027 00:00:00 GMT+0000"),
      bid(2, "Grounds Maintenance Services for the TxDOT Pampa Maintenance Office", "Fri Nov 13 2026 00:00:00 GMT+0000"),
      bid(3, "Grounds Maintenance Services for the TxDOT Pampa Maintenance Office", "Fri Nov 13 2026 00:00:00 GMT+0000"),
      bid(4, "Landscape Services", "Fri Nov 06 2026 00:00:00 GMT+0000"),
    ];
    expect(filterBidsToState(rows, "TX").map((b) => b.id)).toEqual([4, 2, 1]);
  });
  test("cards drop our source notes, NAICS and 'Not specified'; the list sells the 6 AM email", () => {
    const seo = read("src/lib/seo-landing.tsx");
    expect(seo).toContain("const summary = jobSummary(b.description, b.title);");
    expect(seo).not.toContain("<span>NAICS {b.naics_code}</span>");
    expect(seo).toContain("<DailyEmailOffer tradeLabel={label} stateName={name} count={data.count} />");
    expect(seo).toContain('void redirectToCheckout("starter");');
    const page = read("src/routes/contracts-in.$state_.$trade.tsx");
    expect(page).toContain('data.trade?.slug === "landscaping" ? "mowing & landscaping"');
    expect(page).toContain("headline={`${name} ${spoken} bids`}");
  });
});
