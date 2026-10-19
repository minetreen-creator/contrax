import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-10-19 (funnel report): plan buy buttons recorded nothing, so an
// abandoned checkout was invisible. Every outcome of redirectToCheckout is
// now recorded, the click first.
describe("plan checkout tracking", () => {
  const src = readFileSync(new URL("./checkout.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export async function redirectToCheckout"));

  test("the click is recorded before the checkout request", () => {
    expect(body.indexOf('trackEvent("plan_checkout_started"')).toBeGreaterThan(0);
    expect(body.indexOf('trackEvent("plan_checkout_started"')).toBeLessThan(body.indexOf("fetch("));
  });

  test("redirect, sign-in and failure outcomes are recorded", () => {
    for (const e of ["plan_checkout_redirected", "plan_checkout_signin_required", "plan_checkout_failed"]) {
      expect(body).toContain(`trackEvent("${e}"`);
    }
  });
});
