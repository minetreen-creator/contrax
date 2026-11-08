import { describe, expect, test } from "bun:test";
import { PAGE_MARK, RED_FLAG_RULES, scanRedFlags } from "./red-flags";

// Owner 2026-11-08: flag hidden dealbreakers in a solicitation so estimators read the right parts.
const SAMPLE = [
  "SECTION 1. The Contractor shall complete all work within 120 calendar days. Liquidated damages of $500 per calendar day will be assessed for each day beyond the completion date.",
  "A bid bond or bid security in the amount of 5% of the bid is required. The successful bidder shall furnish a performance bond and a payment bond each for 100% of the contract price.",
  "This project is subject to prevailing wage rates; the wage determination is attached and certified payroll is due weekly.",
  "A mandatory pre-bid meeting will be held on November 18, 2026 at 10:00 AM. Bidders shall carry commercial general liability insurance of $2,000,000 per occurrence and $4,000,000 aggregate.",
  "Bidders must have a minimum of five (5) years of experience on projects of similar size. Retainage of 10% will be withheld from each progress payment.",
  "A DBE participation goal of 12% applies. All workers on site must pass a background check. The contractor shall warrant all work for two (2) years.",
].join(PAGE_MARK);

describe("red-flag scanner", () => {
  test("finds each kind of dealbreaker with the sentence and page it came from", () => {
    const flags = scanRedFlags(SAMPLE);
    const ids = flags.map((f) => f.id);
    expect(ids).toEqual([
      "liquidated-damages", "prevailing-wage", "bonding", "mandatory-meeting", "insurance-limits",
      "experience", "retainage", "participation-goals", "background-checks", "long-warranty",
    ]);
    const ld = flags.find((f) => f.id === "liquidated-damages")!;
    expect(ld.snippets[0]).toEqual({ page: 1, text: "Liquidated damages of $500 per calendar day will be assessed for each day beyond the completion date." });
    expect(flags.find((f) => f.id === "bonding")!.count).toBe(4);
    expect(flags.find((f) => f.id === "insurance-limits")!.snippets[0].page).toBe(4);
  });

  test("plain text without page markers has no page numbers", () => {
    const [f] = scanRedFlags("Work requires a Secret clearance for all staff.");
    expect(f).toMatchObject({ id: "security-clearance", count: 1, snippets: [{ page: null, text: "Work requires a Secret clearance for all staff." }] });
  });

  test("ordinary wording raises nothing", () => {
    expect(scanRedFlags("Provide janitorial services three nights per week at the City Hall annex. Questions are due by email.")).toEqual([]);
    expect(scanRedFlags("General liability insurance is required.")).toEqual([]);
    expect(scanRedFlags("The warranty period is one year.")).toEqual([]);
  });

  test("snippets are capped and de-duplicated", () => {
    const text = Array.from({ length: 6 }, (_, i) => `Item ${i}: a performance bond is required.`).join(" ");
    const [f] = scanRedFlags(text);
    expect(f.count).toBe(6);
    expect(f.snippets.length).toBe(3);
    expect(RED_FLAG_RULES.length).toBeGreaterThanOrEqual(10);
  });
});
