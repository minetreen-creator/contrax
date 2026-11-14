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
