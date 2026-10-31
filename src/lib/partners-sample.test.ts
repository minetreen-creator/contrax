import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-10-31 trust cleanup: /partners shows seeded example companies, so it
// must say so and never offer their made-up contact details.
describe("/partners sample companies", () => {
  const page = readFileSync("src/routes/partners.tsx", "utf8");
  test("labels the listings as samples", () => {
    expect(page).toContain("<b>Sample companies.</b>");
    expect(page).toContain("They are not real businesses");
  });
  test("offers no contact button for the made-up companies", () => {
    expect(page).not.toContain("Contact partner");
  });
});
