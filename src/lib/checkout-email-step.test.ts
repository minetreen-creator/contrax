import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { checkoutFollowupEmail } from "./checkout-followup";
import { GUEST_EMAIL_REQUIRED, guestCheckoutEmail, guestNeedsEmail } from "./starter-offer";

// Owner 2026-11-04: "yes add the email step". Guests left the Stripe page before
// typing an email, so the hourly checkout follow-up had never sent once.
describe("guest $5 checkout asks for an email first", () => {
  test("a usable email is cleaned; anything else is refused", () => {
    expect(guestCheckoutEmail({ email: "  Pat@Example.COM " })).toBe("pat@example.com");
    for (const bad of [undefined, "", "pat", "pat@", "pat@example", "a b@x.com", 42]) expect(guestCheckoutEmail({ email: bad as any })).toBeNull();
  });

  test("only guests need it, and the daily path check is exempt", () => {
    expect(guestNeedsEmail(null, {})).toBe(true);
    expect(guestNeedsEmail(null, { email: "pat@example.com" })).toBe(false);
    expect(guestNeedsEmail(17, {})).toBe(false);
    expect(guestNeedsEmail(null, { probe: "path-check" })).toBe(false);
    expect(GUEST_EMAIL_REQUIRED).toContain("6 AM bid emails");
  });

  test("all three checkout entry points enforce it and pre-fill Stripe", () => {
    for (const f of ["src/routes/api/stripe/create-checkout-session.ts", "vercel-entry.ts", "serve.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(`${f}: ${src.includes("guestNeedsEmail(userId,")}`).toBe(`${f}: true`);
      expect(`${f}: ${src.includes("customerEmail: guestCheckoutEmail(")}`).toBe(`${f}: true`);
      expect(`${f}: ${src.includes("needEmail: true")}`).toBe(`${f}: true`);
    }
    expect(readFileSync("src/lib/stripe.ts", "utf8")).toContain("opts.userId == null && opts.customerEmail ? { customer_email: opts.customerEmail }");
  });

  test("every $5 button gets the step: the shared checkout asks, then retries once", () => {
    const src = readFileSync("src/lib/checkout.ts", "utf8");
    expect(src).toContain("Where should we send your 6 AM bid emails?");
    expect(src).toContain("if (response.status === 400 && !options?.email)");
    expect(src).toContain("return redirectToCheckout(planTier, { ...options, email });");
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
