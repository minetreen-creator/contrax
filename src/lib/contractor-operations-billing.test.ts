import { describe, expect, test } from "bun:test";
import { grantsOperationsAccess } from "./contractor-operations-billing.server";

describe("Contractor Operations paid access", () => {
  test("only Stripe's active or trialing status grants access", () => {
    for (const status of [null, undefined, "", "incomplete", "past_due", "unpaid", "paused", "canceled", "incomplete_expired"]) {
      expect(grantsOperationsAccess(status)).toBe(false);
    }
    expect(grantsOperationsAccess("active")).toBe(true);
    expect(grantsOperationsAccess("trialing")).toBe(true);
  });
});
