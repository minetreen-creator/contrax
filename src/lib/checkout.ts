/**
 * Client-side checkout helper.
 *
 * Calls POST /api/stripe/create-checkout-session with the plan tier, then
 * redirects the browser to the Stripe Checkout URL returned by the server.
 */

type PlanTier = "starter" | "professional" | "agency" | "savings_premium";

/**
 * Redirect the browser to a Stripe Checkout Session for the given plan tier.
 *
 * If the API call fails (network error or server error), alerts the user and
 * does NOT redirect. There is no silent fallback — silently routing users to
 * a different checkout page with potentially wrong pricing is a liability.
 *
 * @param planTier - The plan to purchase
 * @param options - Optional checkout options (e.g. { promoCode: "VAD26" } for
 *   the Veterans Against Diabetes partner code). Backward compatible — omitting
 *   the second argument sends the standard checkout.
 * @returns A promise that resolves when the redirect is initiated
 */
export async function redirectToCheckout(
  planTier: PlanTier,
  options?: { promoCode?: string },
): Promise<void> {
  try {
    const payload: Record<string, unknown> = { planTier };
    if (options?.promoCode) {
      payload.promoCode = options.promoCode;
    }

    const response = await fetch("/api/stripe/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const { url } = (await response.json()) as { url: string };
      if (url) {
        window.location.href = url;
        return;
      }
    }

    // API responded but not OK — log the error for debugging
    const body = await response.text().catch(() => "unknown error");
    console.error("Checkout API error:", response.status, body);
    alert("Sorry, we couldn't start the checkout. Please try again or contact support.");
  } catch {
    // Network error — API unreachable
    alert("Checkout is temporarily unavailable. Please check your connection and try again.");
  }
}
