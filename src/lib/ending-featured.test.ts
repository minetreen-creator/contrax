import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { featuredEnding, pickFeatured, FEATURED_MIN_AMOUNT } from "./ending-featured";
import type { Recompete } from "./federal-trade-data";

const c = (over: Partial<Recompete> = {}): Recompete => ({
  award_key: "CONT_AWD_1", trade_slug: "janitorial", award_id: "HQ0001", recipient_name: "ACME FACILITY SERVICES LLC", recipient_uei: null,
  amount: 2_500_000, start_date: "2022-03-31", end_date: "2027-03-31", agency: "Department of Defense", sub_agency: "Washington Headquarters Services",
  description: "CUSTODIAL SERVICES FOR BUILDING 4", pop_state: "VA", naics_code: "561720", naics_description: null, ...over,
});

test("a visitor gets the job, agency, value and end date, and nothing that names the holder", () => {
  const f = featuredEnding(c(), false, "Janitorial")!;
  expect(f.title).toBe("Custodial Services for Building 4");
  expect(f.agency).toBe("Washington Headquarters Services");
  expect(f.amount).toBe(2_500_000);
  expect(f.end_date).toBe("2027-03-31");
  expect(f.holder).toBeNull();
  expect(f.award_key).toBeNull();
  expect(f.award_id).toBeNull();
  expect(JSON.stringify(f).toLowerCase()).not.toContain("acme");
});

test("a description that names the holder is replaced, so the name cannot leak", () => {
  const f = featuredEnding(c({ description: "OPTION YEAR 2 - ACME FACILITY SERVICES JANITORIAL" }), false, "Janitorial")!;
  expect(f.title).toBe("Janitorial contract");
});

test("a signed-in viewer sees the holder and the federal record", () => {
  const f = featuredEnding(c(), true, "Janitorial")!;
  expect(f.holder).toBe("ACME FACILITY SERVICES LLC");
  expect(f.award_key).toBe("CONT_AWD_1");
});

test("the contract shown is the largest one not already listed by name below, and never a small one", () => {
  const big = c({ award_key: "A" }), next = c({ award_key: "B", amount: 900_000 }), small = c({ award_key: "C", amount: FEATURED_MIN_AMOUNT - 1 });
  expect(pickFeatured([big, next, small], ["A"])?.award_key).toBe("B");
  expect(pickFeatured([small], [])).toBeNull();
  expect(pickFeatured([], [])).toBeNull();
  expect(featuredEnding(null, false, "Janitorial")).toBeNull();
});

test("the page hides the holder on the server and puts the card above the search form", () => {
  const page = readFileSync(new URL("../routes/recompetes.tsx", import.meta.url), "utf8");
  expect(page).toContain("featuredEnding(pickFeatured(candidates, result.rows.map((r) => r.award_key)), signedIn, ");
  expect(page.indexOf("<FeaturedContract ")).toBeLessThan(page.indexOf('<form method="get" action="/recompetes"'));
  expect(page).toContain('trackEvent("recompetes_featured_click", d.trade)');
});
