import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-08: a bottom bar worded for each state and clause page, linking to the $5 Starter.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("page-worded offer bar", () => {
  test("links to the $5 Starter checkout, hides for a week, never covers the page's first screen", () => {
    const src = read("./StickyOfferBar.tsx");
    expect(src).toContain("/upgrade?plan=starter&source=");
    expect(src).toContain("7 * 86_400_000");
    expect(src).toMatch(/window\.scrollY > /);
    expect(src).toContain("no automatic renewal");
    expect(src).not.toMatch(/\bfree\b/i);
  });
  test("state pages name the state; clause pages name the clause", () => {
    expect(read("../lib/seo-landing.tsx")).toContain("Get new ${STATE_NAMES[props.signupState]} bids in your trade emailed every morning");
    expect(read("../routes/clauses/$clauseNumber.tsx")).toContain("Bidding on contracts with ${sourceLabel} ${clause.clause_number}?");
  });
});
