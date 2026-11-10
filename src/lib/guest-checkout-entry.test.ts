import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { bidStarterHref } from "~/lib/bid-job-summary";

// Owner 2026-11-10 ("2"): pay without making an account first. Every $5 button goes to the Starter
// plan page; signed out, it shows one button to Stripe, and /post-checkout creates the account.
test("no $5 button sends a signed-out visitor through the signup form first", () => {
  expect(bidStarterHref(7, false)).toBe("/upgrade?plan=starter&bid=7");
  for (const f of ["src/components/HomeContractFinder.tsx", "src/lib/seo-landing.tsx", "src/routes/radar.tsx", "src/routes/pricing/index.tsx"]) {
    expect(readFileSync(f, "utf8")).not.toContain("/signup?plan=starter");
  }
});

test("the plan page gives a signed-out $5 visitor one button to Stripe, with the trust line", () => {
  const page = readFileSync("src/routes/upgrade.tsx", "utf8");
  expect(page).toContain('{!signedIn && plan === "starter" && checkout !== "cancelled" && (');
  expect(page).toContain('await redirectToCheckout("starter", { interval: "month" })');
  expect(page).toContain("No account needed first.");
  expect(page).toContain("<CheckoutTrust");
  // Guest Starter checkout is allowed by the server and the account is made after payment.
  expect(readFileSync("src/routes/api/stripe/create-checkout-session.ts", "utf8")).toContain("guestCheckoutAllowed(body)");
  expect(readFileSync("src/routes/post-checkout.tsx", "utf8")).toContain("creates/links the user account");
});
