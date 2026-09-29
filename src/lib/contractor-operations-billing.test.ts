import { describe, expect, test } from "bun:test";
import { grantsOperationsAccess, matchesOperationsPrice } from "./contractor-operations-billing.server";

describe("Contractor Operations paid access", () => {
  test("only Stripe's active or trialing status grants access", () => {
    for (const status of [null, undefined, "", "incomplete", "past_due", "unpaid", "paused", "canceled", "incomplete_expired"]) {
      expect(grantsOperationsAccess(status)).toBe(false);
    }
    expect(grantsOperationsAccess("active")).toBe(true);
    expect(grantsOperationsAccess("trialing")).toBe(true);
  });
});

describe("Contrax Payments price configuration", () => {
  const price = (amount: number, interval: "month" | "year", interval_count = 1) => ({ active: true, currency: "usd",
    unit_amount: amount, recurring: { interval, interval_count } }) as Parameters<typeof matchesOperationsPrice>[0];
  test("accepts only the exact monthly and annual recurring prices", () => {
    expect(matchesOperationsPrice(price(900, "month"), "month")).toBe(true);
    expect(matchesOperationsPrice(price(9000, "year"), "year")).toBe(true);
    expect(matchesOperationsPrice(price(9000, "month", 12), "year")).toBe(true);
    expect(matchesOperationsPrice(price(9000, "month"), "year")).toBe(false);
    expect(matchesOperationsPrice(price(9000, "month", 11), "year")).toBe(false);
    expect(matchesOperationsPrice(price(9000, "month"), "month")).toBe(false);
    expect(matchesOperationsPrice(price(900, "month"), "year")).toBe(false);
    expect(matchesOperationsPrice({ ...price(900, "month"), active: false }, "month")).toBe(false);
  });
});
