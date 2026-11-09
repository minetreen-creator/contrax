import { expect, test } from "bun:test";
import { isLowContent, LOW_CONTENT_SQL, SETTLEMENT_NOTICE_RE } from "./low-content";

// Owner 2026-11-09: settlement and final-payment notices are not bids. Real open titles.
test("settlement and final-payment notices are hidden from every listing", () => {
  for (const t of [
    "Notice of Partial Settlement - Flintco LLC - QC Existing Lab Renovations",
    "Final Settlement IFB-423002-A3 2026 Concrete Rehabilitation Projects",
    "Notice of Final Settlement - Cherokee Trail Feeder CIP - CTH Roof",
    "Notice of Final Payment CONSTRUCTION OF FURROW ROAD MINI CIRCULAR INTERSECTIONS",
    "Norice of Final Settlement - DW Playground Village East and Walnut Hills",
    "Settlement notice: Law Future Technologies Building",
    "Notice Final Settlement: 2025.239-2025 Miscellaneous Steel Bridge Rail Repairs",
  ]) {
    expect(SETTLEMENT_NOTICE_RE.test(t)).toBe(true);
    expect(isLowContent(t, "Denver, CO", null)).toBe(true);
  }
});

test("titles that only mention the word stay", () => {
  for (const t of [
    "Opioid Settlement Community Funding",
    "Request for Grant Proposals - Opioid Settlement Community Grants",
    "PQ List for Title and Settlement Services",
    "County Route 3 over West Settlement Creek Bridge Replacement, Town of Halcott",
  ]) {
    expect(isLowContent(t, "Albany, NY", null)).toBe(false);
  }
});

test("the shared SQL filter carries the same rule, and the old short-title rule is unchanged", () => {
  expect(LOW_CONTENT_SQL).toContain("AND NOT (COALESCE(title, '') ~* '\\m(final|partial)\\s+settlement\\M");
  expect(LOW_CONTENT_SQL).toContain("cardinality(string_to_array(btrim(title), ' ')) < 5");
  expect(isLowContent("Tubas", "Unknown", null)).toBe(true);
  expect(isLowContent("Roof Repair Services for City Hall", "Unknown", null)).toBe(false);
});
