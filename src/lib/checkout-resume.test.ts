import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { clearCheckoutStarted, rememberCheckoutStarted, RESUME_WINDOW_MS, startedCheckoutPlan } from "./checkout-resume";

// Owner 2026-11-08: someone who opened the $5 checkout, backed out and signed up should be offered it again.
function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe("resuming a started checkout", () => {
  test("remembered for 48 hours, then forgotten; cleared on purpose", () => {
    const s = memory();
    const t = Date.parse("2026-11-08T14:57:00Z");
    rememberCheckoutStarted("starter", t, s);
    expect(startedCheckoutPlan(t + 60_000, s)).toBe("starter");
    expect(startedCheckoutPlan(t + RESUME_WINDOW_MS + 1, s)).toBeNull();
    clearCheckoutStarted(s);
    expect(startedCheckoutPlan(t + 60_000, s)).toBeNull();
  });

  test("bad or missing storage never throws", () => {
    const s = memory();
    s.setItem("contrax_checkout_started", "{not json");
    expect(startedCheckoutPlan(Date.now(), s)).toBeNull();
    expect(startedCheckoutPlan(Date.now(), null)).toBeNull();
  });

  test("checkout remembers the plan; the Basic bar offers one-tap resume; success clears it", () => {
    expect(readFileSync(new URL("./checkout.ts", import.meta.url), "utf8")).toContain("rememberCheckoutStarted(planTier)");
    const bar = readFileSync(new URL("../components/BasicUpgradeBar.tsx", import.meta.url), "utf8");
    expect(bar).toContain("Your account is ready. Finish your $");
    expect(bar).toContain('redirectToCheckout("starter")');
  });
});
