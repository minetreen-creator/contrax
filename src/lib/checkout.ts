/**
 * Client-side checkout helper.
 *
 * Calls POST /api/stripe/create-checkout-session with the plan tier, then
 * redirects the browser to the Stripe Checkout URL returned by the server.
 */

import { trackEvent } from "~/lib/track";

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
 * Open the Stripe Customer Portal for a PLAN-TIER customer (Starter /
 * Professional / Agency) — the "Manage subscription" button in
 * Settings → Plan & Trial. Returns a user-presentable message when it could not
 * be opened (including when the Stripe account has no portal configuration yet,
 * which the API reports as a 503 with a clear message), or `{ ok: true }` once
 * the redirect has been initiated.
 */
export async function openBillingPortal(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    const response = await fetch("/api/stripe/portal-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (response.ok) {
      const { url } = (await response.json()) as { url?: string };
      if (url) {
        window.location.href = url;
        return { ok: true };
      }
    }
    if (response.status === 401) {
      window.location.href = "/login";
      return { ok: true };
    }
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    console.error("Billing portal API error:", response.status, body);
    return {
      ok: false,
      error:
        body?.error ?? "We couldn't open the billing portal. Please try again or contact support.",
    };
  } catch {
    return {
      ok: false,
      error: "The billing portal is temporarily unavailable. Please try again.",
    };
  }
}

/**
 * Redirect the browser to a Stripe Checkout Session for the given plan tier.
 *
 * If the API call fails (network error or server error), alerts the user and
 * does NOT redirect. There is no silent fallback — silently routing users to
 * a different checkout page with potentially wrong pricing is a liability.
 *
 * A 401 means the visitor is not signed in (a checkout is NEVER created for an
 * anonymous caller): they are sent to signup and returned to the plans page.
 *
 * @param planTier - The plan to purchase
 * @param options - Optional checkout options: { promoCode: "VAD26" } for the
 *   Veterans Against Diabetes partner code, { interval: "year" } for yearly
 *   billing (10 × monthly). Backward compatible — omitting the second argument
 *   sends the standard monthly checkout.
 * @returns A promise that resolves when the redirect is initiated
 */
const CHECKOUT_EMAIL_KEY = "contrax_checkout_email";

function rememberedEmail(): string {
  try {
    return window.localStorage.getItem(CHECKOUT_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * The guest email step (owner 2026-11-04: "yes add the email step"): a small
 * dialog asking where the 6 AM bid emails should go, before Stripe. Resolves
 * with the trimmed address, or null when the visitor closes it. Plain DOM so
 * every $5 button (bid page, Radar, pricing, homepage) gets the same step.
 */
export interface CheckoutPreview {
  stateName: string;
  bids: { title: string; place: string; due: string }[];
}

const escapeText = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Owner 2026-11-06 (a New York visitor clicked $5 twice and closed this box):
 * show what the $5 buys right in the box, from real bids posted in the
 * visitor's state this week. PURE: the preview block's HTML, or "" without bids.
 */
export function checkoutPreviewHtml(p: CheckoutPreview | null | undefined): string {
  if (!p || p.bids.length === 0) return "";
  const rows = p.bids
    .slice(0, 3)
    .map(
      (b) =>
        `<li style="padding:8px 0;border-top:1px solid #e2e8f0"><p style="margin:0;font-size:13px;font-weight:700;line-height:1.35;color:#0f172a">${escapeText(b.title)}</p><p style="margin:2px 0 0;font-size:12px;color:#64748b">${escapeText(b.place)}${b.place ? " · " : ""}<span style="color:#be123c;font-weight:600">Due ${escapeText(b.due)}</span></p></li>`,
    )
    .join("");
  return `<div data-preview style="margin:0 0 14px;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px 4px;background:#f8fafc">
      <p style="margin:0 0 2px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64748b">New this week in ${escapeText(p.stateName)}</p>
      <ul style="list-style:none;margin:0;padding:0">${rows}</ul>
      <p style="margin:4px 0 6px;font-size:11px;color:#64748b">Real bids. Your 6 AM email is matched to your own trade and states.</p>
    </div>`;
}

async function loadCheckoutPreview(): Promise<CheckoutPreview | null> {
  try {
    const [{ getEmailSample }, { STATE_NAMES }] = await Promise.all([import("~/lib/near-you"), import("~/lib/contract-map")]);
    const d = await Promise.race([getEmailSample(), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
    if (!d || !d.state || d.bids.length === 0) return null;
    const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return {
      stateName: STATE_NAMES[d.state] ?? d.state,
      bids: d.bids.map((b) => ({ title: b.title, place: [b.agency, b.location].filter(Boolean).join(" · "), due: day(b.due) })),
    };
  } catch {
    return null;
  }
}

export function askCheckoutEmail(message?: string, preview?: CheckoutPreview | null): Promise<string | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-label", "Where should we send your bid emails?");
    wrap.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.55)";
    wrap.innerHTML = `<form style="width:100%;max-width:400px;max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#0f172a;border-radius:16px;padding:22px;box-shadow:0 20px 50px rgba(0,0,0,.3);font-family:inherit">
      <p style="margin:0;font-size:18px;font-weight:700">Where should we send your 6 AM bid emails?</p>
      <p style="margin:6px 0 14px;font-size:14px;color:#475569">Your new bids go to this address every morning. Next you'll pay $5 on Stripe's secure page.</p>
      ${checkoutPreviewHtml(preview)}
      <input type="email" name="email" required autocomplete="email" inputmode="email" placeholder="you@yourbusiness.com" style="width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:12px;font-size:16px" />
      <p data-err style="display:none;margin:8px 0 0;font-size:13px;color:#b91c1c"></p>
      <button type="submit" style="margin-top:14px;width:100%;border:0;border-radius:12px;padding:12px;background:#fbbf24;color:#0f172a;font-size:16px;font-weight:700;cursor:pointer">Continue to secure checkout</button>
      <button type="button" data-cancel style="margin-top:8px;width:100%;border:0;background:none;color:#475569;font-size:14px;cursor:pointer">Not now</button>
    </form>`;
    const form = wrap.querySelector("form")!;
    const input = wrap.querySelector("input")!;
    const err = wrap.querySelector<HTMLElement>("[data-err]")!;
    input.value = rememberedEmail();
    if (message) {
      err.textContent = message;
      err.style.display = "block";
    }
    const close = (v: string | null) => {
      wrap.remove();
      resolve(v);
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
        err.textContent = "Please enter a valid email address.";
        err.style.display = "block";
        return;
      }
      try {
        window.localStorage.setItem(CHECKOUT_EMAIL_KEY, v);
      } catch {
        /* storage blocked: the email still goes to checkout */
      }
      close(v);
    });
    wrap.querySelector("[data-cancel]")!.addEventListener("click", () => close(null));
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) close(null);
    });
    document.body.appendChild(wrap);
    input.focus();
  });
}

export async function redirectToCheckout(
  planTier: PlanTier,
  options?: { promoCode?: string; interval?: "month" | "year"; founding?: boolean; email?: string },
): Promise<void> {
  // Owner 2026-10-19 (funnel report): plan buy buttons recorded nothing, so a
  // started-then-abandoned checkout was invisible. Label = "plan:interval".
  const label = `${planTier}:${options?.interval === "year" ? "year" : "month"}${options?.founding ? ":founding" : ""}`;
  trackEvent("plan_checkout_started", label);
  try {
    const payload: Record<string, unknown> = { planTier };
    if (options?.promoCode) {
      payload.promoCode = options.promoCode;
    }
    if (options?.interval === "year") {
      payload.interval = "year";
    }
    if (options?.founding) {
      payload.founding = true;
    }
    if (options?.email) payload.email = options.email;

    const response = await fetch("/api/stripe/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // A guest $5 checkout needs an email first (owner 2026-11-04): ask, then retry once.
    if (response.status === 400 && !options?.email) {
      const j = (await response.clone().json().catch(() => null)) as { needEmail?: boolean } | null;
      if (j?.needEmail) {
        trackEvent("plan_checkout_email_asked", label);
        const preview = await loadCheckoutPreview();
        if (preview) trackEvent("plan_checkout_preview_shown", label);
        const email = await askCheckoutEmail(undefined, preview);
        if (!email) {
          trackEvent("plan_checkout_email_closed", label);
          return;
        }
        trackEvent("plan_checkout_email_given", label);
        return redirectToCheckout(planTier, { ...options, email });
      }
    }

    if (response.ok) {
      const { url } = (await response.json()) as { url: string };
      if (url) {
        trackEvent("plan_checkout_redirected", label);
        window.location.href = url;
        return;
      }
    }

    // Not signed in — no checkout was created. Send them to signup and bring
    // them back to the plans page.
    if (response.status === 401) {
      trackEvent("plan_checkout_signin_required", label);
      window.location.href = `/signup?plan=${planTier}&next=${encodeURIComponent(`/upgrade?plan=${planTier}`)}`;
      return;
    }

    // A refused founding checkout (spots taken / count unavailable) carries a
    // message the visitor should see as-is.
    if (options?.founding) {
      trackEvent("plan_checkout_failed", `${label}:${response.status}`);
      const err = (await response.json().catch(() => null)) as { error?: string } | null;
      alert(err?.error ?? "The founding-member offer is unavailable right now.");
      return;
    }

    // API responded but not OK — log the error for debugging
    const body = await response.text().catch(() => "unknown error");
    console.error("Checkout API error:", response.status, body);
    trackEvent("plan_checkout_failed", `${label}:${response.status}`);
    alert("Sorry, we couldn't start the checkout. Please try again or contact support.");
  } catch {
    // Network error — API unreachable
    trackEvent("plan_checkout_failed", `${label}:network`);
    alert("Checkout is temporarily unavailable. Please check your connection and try again.");
  }
}
