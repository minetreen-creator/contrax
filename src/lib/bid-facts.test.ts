import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { bidBreadcrumbs, bidKeyFacts, bidSeoTradeSlug, breadcrumbJsonLd, stateSlug } from "./bid-facts";
import { SIMILAR_BIDS_LIMIT } from "./similar-bids";

// Owner 2026-11-11 ("build it"): Google search sent 24 visitors in 14 days against 29,513 bid pages.
// A bid page carried one sentence about the job; it now carries the facts we hold and a trail up
// to the state and trade pages.
describe("which trade page a bid sits under", () => {
  test("a NAICS code decides, most specific first", () => {
    expect(bidSeoTradeSlug("561720", null)).toBe("janitorial");
    expect(bidSeoTradeSlug("238220", "Construction")).toBe("hvac");
    expect(bidSeoTradeSlug("238210", null)).toBe("electrical");
    expect(bidSeoTradeSlug("237310", null)).toBe("construction");
    expect(bidSeoTradeSlug("541512", null)).toBe("it-services");
    expect(bidSeoTradeSlug("562111", null)).toBe("waste-hauling");
  });

  test("a bid with no code uses its category, and unclear ones get no trade", () => {
    expect(bidSeoTradeSlug(null, "Janitorial")).toBe("janitorial");
    expect(bidSeoTradeSlug("", "Construction/Construction Services")).toBe("construction");
    expect(bidSeoTradeSlug(null, "Transportation")).toBeNull();
    expect(bidSeoTradeSlug(null, "Other")).toBeNull();
    expect(bidSeoTradeSlug("423830", "Janitorial")).toBeNull(); // a real code that is not one of our trades wins over the category
  });
});

describe("the trail above a bid", () => {
  test("state, then trade, then the bid", () => {
    const c = bidBreadcrumbs({ title: "Custodial Services", state_name: "North Carolina", naics_code: "561720", category: null });
    expect(c).toEqual([
      { name: "Contrax", href: "/" },
      { name: "North Carolina contracts", href: "/contracts-in/north-carolina" },
      { name: "Janitorial", href: "/contracts-in/north-carolina/janitorial" },
      { name: "Custodial Services", href: null },
    ]);
    expect(stateSlug("New Mexico")).toBe("new-mexico");
  });

  test("levels we cannot place are left out, never guessed", () => {
    expect(bidBreadcrumbs({ title: "Sweeper Parts", state_name: "Texas", naics_code: "423830", category: "Other" }).map((x) => x.name)).toEqual(["Contrax", "Texas contracts", "Sweeper Parts"]);
    expect(bidBreadcrumbs({ title: "X", state_name: null, naics_code: "561720", category: null }).map((x) => x.name)).toEqual(["Contrax", "X"]);
  });

  test("the structured data lists the same trail with full addresses", () => {
    const c = bidBreadcrumbs({ title: "Custodial Services", state_name: "Virginia", naics_code: "561720", category: null });
    const ld = breadcrumbJsonLd(c, "https://www.contrax.company/bid/42") as any;
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement.map((x: any) => x.item)).toEqual([
      "https://www.contrax.company/",
      "https://www.contrax.company/contracts-in/virginia",
      "https://www.contrax.company/contracts-in/virginia/janitorial",
      "https://www.contrax.company/bid/42",
    ]);
    expect(ld.itemListElement[3].position).toBe(4);
  });
});

describe("key facts", () => {
  const base = { buyer: "City of Hampton", place: "Hampton, VA", state_name: "Virginia", work_type: "Janitorial Services", naics_code: "561720", set_aside: null, posted: "Nov 3, 2026", due: "Nov 18, 2026", days_left: "7 days left", stated_value: null, size: { text: "$39K to $241K", scope: "nation" as const, count: 92 }, similar_total: 14 };

  test("lists what we hold, in a fixed order", () => {
    expect(bidKeyFacts(base)).toEqual([
      ["Buyer", "City of Hampton"],
      ["Place of work", "Hampton, VA (Virginia)"],
      ["Type of work", "Janitorial Services (NAICS 561720)"],
      ["Who can bid", "Open to small business"],
      ["Posted", "Nov 3, 2026"],
      ["Bids due", "Nov 18, 2026 (7 days left)"],
      ["Typical size of similar jobs", "$39K to $241K (an estimate from 92 similar federal contracts nationwide, not this bid's budget)"],
      ["Similar open bids in Virginia", "14"],
    ]);
  });

  test("a value the source states is shown instead of our estimate", () => {
    const rows = bidKeyFacts({ ...base, stated_value: "$1.4M" });
    expect(rows).toContainEqual(["Stated value", "$1.4M"]);
    expect(rows.map((r) => r[0])).not.toContain("Typical size of similar jobs");
  });

  test("a state figure says the state; missing facts are left out", () => {
    expect(bidKeyFacts({ ...base, size: { text: "$143K to $2.8M", scope: "state", count: 18 } })).toContainEqual(["Typical size of similar jobs", "$143K to $2.8M (an estimate from 18 similar federal contracts in Virginia, not this bid's budget)"]);
    const bare = bidKeyFacts({ buyer: null, place: null, state_name: null, work_type: null, naics_code: null, set_aside: "8(a)", posted: null, due: null, days_left: null, stated_value: null, size: null, similar_total: 0 });
    expect(bare).toEqual([["Who can bid", "8(a)"]]);
  });
});

describe("the bid page", () => {
  const page = readFileSync("src/routes/bid.$bidId.tsx", "utf8");

  test("shows the trail, its structured data and the key facts in the server render", () => {
    expect(page).toContain("<BidBreadcrumbs crumbs={crumbs} />");
    expect(page).toContain('type="application/ld+json"');
    expect(page).toContain("<BidKeyFacts");
    // The facts come from the route loader, so a crawler gets them without running scripts.
    const loader = page.slice(page.indexOf("const getPublicBid = createServerFn"), page.indexOf("const getBid = createServerFn"));
    expect(loader).toContain("...(await loadBidFacts(");
  });

  test("the notice link, documents and contact are still for members only", () => {
    const loader = page.slice(page.indexOf("const getPublicBid = createServerFn"), page.indexOf("const getBid = createServerFn"));
    expect(loader).toContain("source_url: null,");
    expect(loader).not.toContain("contact_email");
    const facts = readFileSync("src/lib/bid-facts.ts", "utf8");
    // The facts helper takes no link and no contact field at all.
    expect(facts).not.toContain("source_url");
    expect(facts).not.toContain("contact_");
    expect(facts).not.toContain("email");
    expect(facts).not.toContain("phone");
  });

  test("the size estimate in the facts is the free one: no winner, no single award", () => {
    expect(page).toContain("loadAreaAwards(state, naics, category, false)");
  });

  test("each bid links to more open bids than before", () => {
    expect(SIMILAR_BIDS_LIMIT).toBe(8);
  });
});
