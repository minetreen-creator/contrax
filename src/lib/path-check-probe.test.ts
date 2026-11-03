import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { followupCandidate } from "./checkout-followup";
import { PATH_CHECKS } from "./path-checks";
import { PROBE_SESSION_SECONDS } from "./stripe";

// Owner 2026-11-03: the daily check's $5 checkout looked like a buyer under
// Stripe's Review sessions. It is now labeled and expires in ~30 minutes.
describe("path-check probe checkout", () => {
  test("the daily check asks for a labeled probe session", () => {
    const c = PATH_CHECKS.find((p) => p.name === "Checkout opens ($5 Starter, signed out)")!;
    expect(JSON.parse(c.body!)).toEqual({ planTier: "starter", interval: "month", probe: "path-check" });
  });
  test("the session is labeled and short-lived (Stripe's 30-minute minimum)", () => {
    expect(PROBE_SESSION_SECONDS).toBeGreaterThanOrEqual(30 * 60);
    const stripe = readFileSync("src/lib/stripe.ts", "utf8");
    expect(stripe).toContain('if (opts.probe) metadata.probe = "path_check";');
    expect(stripe).toContain('client_reference_id: "contrax-path-check"');
    expect(readFileSync("src/routes/api/stripe/create-checkout-session.ts", "utf8")).toContain('body.probe === "path-check"');
  });
  test("it never gets a checkout follow-up email", () => {
    const now = Date.now();
    const base = { created: Math.floor(now / 1000) - 3 * 3600, status: "open", paymentStatus: "unpaid" } as const;
    expect(followupCandidate({ ...base, metadata: { plan_tier: "starter", probe: "path_check" } } as any, now)).toBe(false);
  });
});
