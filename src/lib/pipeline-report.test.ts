import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { REPORT_PRICE, REPORT_PRICE_CENTS, cleanOrder, orderFromMetadata, orderMetadata, ownerNotice } from "./pipeline-report";

// Owner 2026-11-14: a one-time report for $149 before asking for $499 a month.
const good = { email: " Buyer@Example.com ", company: "Acme  Federal", state: "va", trade: "IT services" };

test("one price, stated once", () => {
  expect(REPORT_PRICE).toBe("$149");
  expect(REPORT_PRICE_CENTS).toBe(14900);
});

test("an order needs a real email, company, state and line of work", () => {
  expect(cleanOrder(good)).toEqual({ email: "buyer@example.com", company: "Acme Federal", state: "VA", trade: "IT services" });
  expect(cleanOrder({ ...good, email: "nope" })).toBeNull();
  expect(cleanOrder({ ...good, state: "ZZ" })).toBeNull();
  expect(cleanOrder({ ...good, trade: "" })).toBeNull();
  expect(cleanOrder({ ...good, company: 7 })).toBeNull();
  expect(cleanOrder(null)).toBeNull();
});

test("the order survives the trip through Stripe metadata, and other products are ignored", () => {
  const order = cleanOrder(good)!;
  expect(orderFromMetadata(orderMetadata(order))).toEqual(order);
  expect(orderFromMetadata({ ...orderMetadata(order), product: "bid_fit_review" })).toBeNull();
  expect(orderFromMetadata(null)).toBeNull();
});

test("the owner's notice says what was bought and where to send it", () => {
  const n = ownerNotice(cleanOrder(good)!, "cs_test_1");
  expect(n.subject).toBe("PAID: $149 pipeline report, IT services in Virginia");
  expect(n.text).toContain("Send to: buyer@example.com");
  expect(n.text).toContain("cs_test_1");
});

test("checkout charges the stated price, only a paid session notifies, and the webhook is wired", () => {
  const server = readFileSync("src/lib/pipeline-report.server.ts", "utf8");
  expect(server).toContain("unit_amount: REPORT_PRICE_CENTS");
  expect(server).toContain('mode: "payment"');
  expect(server).toContain("session.amount_total === REPORT_PRICE_CENTS");
  expect(server).toContain("if (!isPaidReportSession(session)) return true;");
  expect(readFileSync("src/lib/stripe.ts", "utf8")).toContain("if (await handleReportEvent(event)) return { success: true };");
  const route = readFileSync("src/routes/api/pipeline-report/checkout.ts", "utf8");
  expect(route).toContain("checkIpLimit");
  expect(route).toContain("cleanOrder(raw)");
});

test("the teams page offers the single report above the monthly one", () => {
  const page = readFileSync("src/routes/teams.tsx", "utf8");
  expect(page).toContain('<section id="done-for-you"');
  expect(page.indexOf("<PipelineReportOrder />")).toBeLessThan(page.indexOf("Contrax Managed: {MANAGED_PRICE} a month"));
  const form = readFileSync("src/components/PipelineReportOrder.tsx", "utf8");
  expect(form).toContain("One payment, no subscription.");
  expect(form).toContain("not a promise of a rebid");
});
