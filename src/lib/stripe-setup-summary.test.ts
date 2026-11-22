import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { stripeSetupSummary } from "./stripe-setup-summary";

// Owner 2026-11-22: "You can handle stripe". Starter renews each month, so the cancel page and the
// renewal events must be in place; the daily job checks, repairs and records only yes/no facts.
test("the summary says whether a renewing plan has what it needs, with no ids or addresses", () => {
  const good = stripeSetupSummary({
    keyMode: "live",
    webhookSecretSet: true,
    endpoints: [{ id: "we_1", url: "https://x", status: "enabled", missing: [] } as never],
    portal: { ready: true },
  });
  expect(good).toEqual({ keyMode: "live", webhookSecretSet: true, endpoints: 1, endpointsEnabled: 1, missingEvents: [], portalReady: true, ok: true });
  expect(JSON.stringify(good)).not.toContain("we_1");
  const bad = stripeSetupSummary({
    keyMode: "live",
    webhookSecretSet: true,
    endpoints: [{ status: "enabled", missing: ["invoice.paid"] }, { status: "disabled", missing: ["invoice.paid", "customer.subscription.deleted"] }],
    portal: { ready: false },
  });
  expect(bad.ok).toBe(false);
  expect(bad.missingEvents).toEqual(["customer.subscription.deleted", "invoice.paid"]);
  expect(bad.endpointsEnabled).toBe(1);
  expect(stripeSetupSummary({ keyMode: "test", webhookSecretSet: true, endpoints: [{ status: "enabled", missing: [] }], portal: { ready: true } }).ok).toBe(false);
});

test("the daily job repairs Stripe's setup and a subscriber's cancel page sets itself up", () => {
  expect(readFileSync("src/routes/api/cron/starter-pass.ts", "utf8")).toContain("stripeSetupSummary(await fixStripeSetup())");
  const tier = readFileSync("src/lib/tier-subscription.server.ts", "utf8");
  expect(tier).toContain("stripe.billingPortal.configurations.create(PORTAL_CONFIGURATION)");
  expect(tier).toContain("if (!isPortalConfigMissingError(first)) throw first;");
});
