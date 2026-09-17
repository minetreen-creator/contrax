/**
 * Client-side checkout helper.
 *
 * Calls POST /api/stripe/create-checkout-session with the plan tier, then
 * redirects the browser to the Stripe Checkout URL returned by the server.
 */

type PlanTier = "starter" | "professional" | "agency" | "savings_premium";

/**
 * Redirect the browser to the Contrax Grants $19/month subscription checkout.
 *
 * Sign-in is required: an unauthenticated call gets a 401 from the API and the
 * user is sent to the free signup page (the server never creates a customer for
 * an unknown visitor). The price and quantity are entirely server-side, so this
 * helper sends NO body.
 */
export async function redirectToGrantsCheckout(): Promise<void> {
  try {
    const response = await fetch("/api/stripe/grants-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (response.ok) {
      const { url } = (await response.json()) as { url?: string };
      if (url) {
        window.location.href = url;
        return;
      }
    }
    if (response.status === 401) {
      window.location.href = "/signup?next=/grants";
      return;
    }
    const body = await response.text().catch(() => "unknown error");
    console.error("Grants checkout API error:", response.status, body);
    alert("Sorry, we couldn't start the checkout. Please try again or contact support.");
  } catch {
    alert("Checkout is temporarily unavailable. Please check your connection and try again.");
  }
}

/**
 * Open the Stripe Customer Portal for a Grants subscriber ("Manage
 * subscription"). Returns `true` when the redirect was initiated.
 */
export async function openGrantsPortal(): Promise<void> {
  try {
    const response = await fetch("/api/stripe/grants-portal-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (response.ok) {
      const { url } = (await response.json()) as { url?: string };
      if (url) {
        window.location.href = url;
        return;
      }
    }
    const body = await response.text().catch(() => "unknown error");
    console.error("Grants portal API error:", response.status, body);
    alert("Sorry, we couldn't open the billing portal. Please try again or contact support.");
  } catch {
    alert("The billing portal is temporarily unavailable. Please try again.");
  }
}

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
