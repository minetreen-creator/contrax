import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { checkoutFollowupEmail } from "./checkout-followup";
import { guestCheckoutEmail } from "./starter-offer";

// Owner 2026-11-07 ("Trace it and build it"): the email box before Stripe lost
// every real guest who saw it (3 of 3 in 30 days), so the $5 checkout is one tap
// again: guests go straight to Stripe, which collects the email.
describe("one-tap guest $5 checkout", () => {
  test("an email we already have is cleaned for pre-filling; anything else is ignored", () => {
    expect(guestCheckoutEmail({ email: "  Pat@Example.COM " })).toBe("pat@example.com");
    for (const bad of [undefined, "", "pat", "pat@", "pat@example", "a b@x.com", 42]) expect(guestCheckoutEmail({ email: bad as any })).toBeNull();
  });

  test("no checkout entry point asks for an email first; each still pre-fills Stripe when it has one", () => {
    for (const f of ["src/routes/api/stripe/create-checkout-session.ts", "vercel-entry.ts", "serve.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(`${f}: ${src.includes("needEmail")}`).toBe(`${f}: false`);
      expect(`${f}: ${src.includes("customerEmail: guestCheckoutEmail(")}`).toBe(`${f}: true`);
    }
    expect(readFileSync("src/lib/stripe.ts", "utf8")).toContain("opts.userId == null && opts.customerEmail ? { customer_email: opts.customerEmail }");
  });

  test("the shared $5 button goes straight to Stripe: no email box, no retry", () => {
    const src = readFileSync("src/lib/checkout.ts", "utf8");
    expect(src).not.toContain("Where should we send your 6 AM bid emails?");
    expect(src).not.toContain("plan_checkout_email_asked");
    expect(src).toContain("const email = options?.email ?? rememberedEmail();");
  });

  test("the follow-up names the $5 pass and the search they ran", () => {
    const m = checkoutFollowupEmail({
      metadata: { plan_tier: "starter", starter_pass: "true" },
      search: { trade: "janitorial", state: "LA" },
      postalAddress: "100 Main St, Richmond VA 23219",
      unsubscribeUrl: "https://www.contrax.company/api/outreach/unsubscribe?t=x",
    });
    expect(m.subject).toBe("Your $5 Contrax pass is one click away");
    expect(m.text).toContain("new janitorial bids in LA every morning at 6 AM for 30 days");
    expect(m.text).toContain("$5 once, with no automatic renewal");
    expect(m.text).toContain("nothing was charged");
  });
});
