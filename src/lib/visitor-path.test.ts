import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-14 ("changing the pages a visitor moves through"): the done-for-you path is
// homepage → real sample report → order form on that page → Stripe → a thank-you page.
const read = (f: string) => readFileSync(f, "utf8");

test("the homepage's done-for-you lane opens the sample report, not a price", () => {
  const home = read("src/routes/index.tsx");
  expect(home).toContain('href: "/sample-report?source=home_lane"');
  expect(home).toContain('cta: "Read a real report"');
});

test("the sample report carries the order form, so nobody is sent away to buy", () => {
  const page = read("src/routes/sample-report.tsx");
  expect(page).toContain('<PipelineReportOrder from="sample" />');
  expect(page).toContain('<div id="order"');
  expect(page).toContain('href="#order"');
  // No link back to itself from the form.
  expect(read("src/components/PipelineReportOrder.tsx")).toContain('{from === "teams" && (');
});

test("a paid order lands on a thank-you page; a cancelled one returns to where it started", () => {
  const report = read("src/lib/pipeline-report.server.ts");
  expect(report).toContain("success_url: `${SITE}/order-received?kind=report`");
  expect(report).toContain("`${SITE}/sample-report?report=cancelled#order`");
  expect(report).toContain("`${SITE}/teams?report=cancelled#done-for-you`");
  expect(read("src/lib/contrax-managed.server.ts")).toContain("success_url: `${SITE}/order-received?kind=managed`");
  expect(read("src/routes/api/pipeline-report/checkout.ts")).toContain('.from === "sample" ? "sample" : "teams"');
});

test("the thank-you page says what happens next, offers the credit, and is not indexed", () => {
  const page = read("src/routes/order-received.tsx");
  expect(page).toContain('{ name: "robots", content: "noindex, nofollow" }');
  expect(page).toContain("What happens next");
  expect(page).toContain("{REPORT_CREDIT_NOTE}");
  expect(page).toContain('s.kind === "managed" ? "managed" : "report"');
});

test("the ending-contracts gate offers the prepared report beside the account", () => {
  const page = read("src/routes/recompetes.tsx");
  expect(page).toContain('href="/sample-report?source=recompetes"');
  expect(page).toContain("Rather have it prepared for you?");
});

// Owner 2026-11-14 ("equal"): the homepage speaks to both customers with the same weight.
test("the homepage opens with one headline and two equal lanes, and the search is the second section", () => {
  const home = read("src/routes/index.tsx");
  expect(home).toContain('export const HOME_HEADLINE = "Win government work. Find it yourself, or have it prepared for you.";');
  expect(home.match(/<h1/g)?.length).toBe(1);
  expect(home).toContain('heading="h2"');
  expect(home).toContain('who: "For contractors and small businesses"');
  expect(home).toContain('who: "For companies with someone who sells to government"');
  // Neither lane is styled as the main one: both render from the same markup.
  expect(home.match(/HOME_LANES\.map/g)?.length).toBe(1);
  const finder = read("src/components/HomeContractFinder.tsx");
  expect(finder).toContain('id="find-bids"');
  expect(finder).toContain("const Title = heading;");
  expect(finder.match(/<h1/g)).toBeNull();
  // Search engines and assistants are told about both customers.
  expect(home).toContain("Win government work two ways");
});

// Owner 2026-11-14: three tweaks to the homepage.
test("the footer links the comparison pages in a row, not a fifth column", () => {
  const home = read("src/routes/index.tsx");
  for (const t of ["highergov", "govtribe", "cleatus"]) expect(home).toContain(`{ href: "/compare/${t}", label: "Contrax vs. `);
  expect(home).toContain('<nav aria-label="Compare"');
  // "All comparisons" leads to a page that actually lists them.
  expect(read("src/routes/compare/index.tsx")).toContain("href={`/compare/${t.slug}`}");
  expect(home).toContain("lg:grid-cols-4");
});

test("the homepage mentions the AI connection under the three steps and points at the instructions", () => {
  expect(read("src/routes/index.tsx")).toContain('href="/teams?source=home_ai#ai"');
  expect(read("src/routes/teams.tsx")).toContain('<p id="ai"');
});

test("each lane carries small links of the same shape; the report lane offers a sample per trade", () => {
  const home = read("src/routes/index.tsx");
  expect(home).toContain('{ label: "Janitorial", href: "/sample-report?m=va-janitorial&source=home_lane" }');
  expect(home).toContain('{ label: "HVAC and plumbing", href: "/sample-report?m=tx-hvac&source=home_lane" }');
  expect(home.match(/moreLabel: /g)?.length).toBe(2);
  expect(home.match(/lane\.more\.map/g)?.length).toBe(1);
});
