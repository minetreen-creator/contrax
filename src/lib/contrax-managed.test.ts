import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MANAGED_PRICE_CENTS, cleanManagedOrder, managedFromMetadata, managedMetadata, managedNotice, snapshotCreditApplies } from "./contrax-managed";

// Owner 2026-11-14: "no, make it a stripe payment" — Contrax Managed is a Stripe subscription.
const good = { email: " Lead@Example.com ", company: "Acme Federal", states: "Virginia,  Maryland and DC", trade: "IT services" };
const NOW = Date.parse("2026-11-14T20:00:00Z");
const paid = (daysAgo: number, over: Record<string, unknown> = {}) => ({
  created: NOW / 1000 - daysAgo * 86400, payment_status: "paid", amount_total: 14900, metadata: { product: "pipeline_report" }, ...over,
});

test("the charge matches the price on the page", () => {
  expect(MANAGED_PRICE_CENTS).toBe(49900);
  expect(readFileSync("src/routes/teams.tsx", "utf8")).toContain('export const MANAGED_PRICE = "$499";');
});

test("an order needs an email, a company, states and a line of work, and survives Stripe metadata", () => {
  const order = cleanManagedOrder(good)!;
  expect(order).toEqual({ email: "lead@example.com", company: "Acme Federal", states: "Virginia, Maryland and DC", trade: "IT services" });
  expect(cleanManagedOrder({ ...good, states: "" })).toBeNull();
  expect(cleanManagedOrder({ ...good, email: "x" })).toBeNull();
  expect(managedFromMetadata(managedMetadata(order))).toEqual(order);
  expect(managedFromMetadata({ ...managedMetadata(order), product: "pipeline_report" })).toBeNull();
});

test("the snapshot credit needs a paid $149 report inside 14 days", () => {
  expect(snapshotCreditApplies([paid(3)], NOW)).toBe(true);
  expect(snapshotCreditApplies([paid(15)], NOW)).toBe(false);
  expect(snapshotCreditApplies([paid(3, { payment_status: "unpaid" })], NOW)).toBe(false);
  expect(snapshotCreditApplies([paid(3, { metadata: { product: "bid_fit_review" } })], NOW)).toBe(false);
  expect(snapshotCreditApplies([], NOW)).toBe(false);
});

test("the owner hears when a client starts, cancels or fails to pay", () => {
  const order = cleanManagedOrder(good)!;
  const started = managedNotice(order, "started", "cs_1", true);
  expect(started.subject).toBe("NEW CLIENT: Contrax Managed, Acme Federal");
  expect(started.text).toContain("The $149 snapshot credit was applied to the first month.");
  expect(started.text).toContain("Report data trade: it-services");
  expect(started.title).toBe("💰 Contrax Managed started: $499 a month");
  expect(managedNotice(order, "cancelled", "sub_1").subject).toBe("Contrax Managed cancelled: Acme Federal");
  expect(managedNotice(order, "payment_failed", "in_1").title).toContain("payment failed");
});

test("it is a monthly Stripe subscription whose events stay out of the plan tiers", () => {
  const server = readFileSync("src/lib/contrax-managed.server.ts", "utf8");
  expect(server).toContain('mode: "subscription"');
  expect(server).toContain("unit_amount: MANAGED_PRICE_CENTS");
  expect(server).toContain('recurring: { interval: "month" }');
  expect(server).toContain("subscription_data: { metadata }");
  expect(server).toContain('duration: "once", max_redemptions: 1');
  const hook = readFileSync("src/lib/stripe.ts", "utf8");
  expect(hook).toContain("if (await handleManagedEvent(event)) return { success: true };");
  // Owned before the plan-tier flow sees it.
  expect(hook.indexOf("handleManagedEvent(event)")).toBeLessThan(hook.indexOf("handleBidScoutSubscriptionEvent(event)"));
  const route = readFileSync("src/routes/api/managed/checkout.ts", "utf8");
  expect(route).toContain("checkIpLimit");
  expect(route).toContain("cleanManagedOrder(raw)");
});

test("homepage step 2 is about subs and quotes only (owner 2026-11-14)", () => {
  expect(readFileSync("src/lib/brand-message.ts", "utf8")).not.toContain("crew housing");
});
