/**
 * Client-side checkout helper.
 *
 * Calls POST /api/stripe/create-checkout-session with the plan tier, then
 * redirects the browser to the Stripe Checkout URL returned by the server.
 * Falls back to a legacy Stripe payment link if the API call fails.
 */

type PlanTier = "starter" | "professional" | "agency" | "savings_premium";

/** Legacy payment links — used as fallback when the API is unavailable. */
const LEGACY_PAYMENT_LINKS: Record<PlanTier, string> = {
  starter: "https://buy.stripe.com/28E00lgGbdvS88ccyYf7i05",
  professional: "https://buy.stripe.com/14A28tey30J61JOdD2f7i04",
  agency: "https://buy.stripe.com/7sY28t9dJ9fC3RW56wf7i03",
  savings_premium: "https://buy.stripe.com/9B614p3TpdvSfAEdD2f7i06",
};

/**
 * Redirect the browser to a Stripe Checkout Session for the given plan tier.
 *
 * If the API is unavailable (e.g., no Stripe key configured), falls back to
 * opening a legacy Stripe payment link in a new tab.
 *
 * @param planTier - The plan to purchase
 * @param fallbackHref - Optional fallback URL (uses legacy payment link by default)
 * @returns A promise that resolves when the redirect is initiated
 */
export async function redirectToCheckout(
  planTier: PlanTier,
  fallbackHref?: string,
): Promise<void> {
  try {
    const response = await fetch("/api/stripe/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planTier }),
    });

    if (response.ok) {
      const { url } = (await response.json()) as { url: string };
      if (url) {
        window.location.href = url;
        return;
      }
    }
  } catch {
    // API unreachable — fall through to fallback
  }

  // Fallback: open legacy payment link
  const href = fallbackHref ?? LEGACY_PAYMENT_LINKS[planTier];
  window.open(href, "_blank", "noopener noreferrer");
}
