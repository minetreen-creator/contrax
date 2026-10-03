import { useEffect, useState } from "react";
import { redirectToCheckout } from "~/lib/checkout";
import { trackEvent } from "~/lib/track";

type Offer = { available: boolean; remaining: number; limit: number; monthlyUsd: number };

/**
 * Founding-member offer banner (owner 2026-10-03): Starter at $9/month for
 * life for the first 10 customers. The spot count comes from
 * /api/founding-offer (live Stripe count, edge-cached 5 minutes); nothing
 * renders until it answers, and nothing renders when the offer is closed or
 * the count is unavailable — the banner never shows a made-up number.
 */
export function FoundingOffer({ source }: { source: "pricing" | "upgrade" }) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/founding-offer")
      .then((r) => (r.ok ? r.json() : null))
      .then((o: Offer | null) => {
        if (!alive || !o?.available) return;
        setOffer(o);
        trackEvent("founding_offer_shown", source);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [source]);
  if (!offer) return null;
  const claim = async () => {
    setBusy(true);
    trackEvent("founding_offer_clicked", source);
    await redirectToCheckout("starter", { founding: true });
    setBusy(false);
  };
  return (
    <section
      aria-label="Founding member offer"
      className="mx-auto mt-10 max-w-3xl rounded-2xl border-2 border-amber-400 bg-amber-50 p-6 text-center shadow-sm sm:p-8"
    >
      <p className="text-xs font-bold uppercase tracking-widest text-amber-700">Founding member offer</p>
      <h3 className="mt-2 text-2xl font-bold text-slate-900">
        Starter for ${offer.monthlyUsd}/month, for life
      </h3>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-slate-700">
        For our first {offer.limit} customers only. Everything in Starter, at ${offer.monthlyUsd} a month instead of
        $19 for as long as you stay subscribed. Cancel anytime.
      </p>
      <p className="mt-3 text-sm font-semibold text-amber-800">
        {offer.remaining} of {offer.limit} spots left
      </p>
      <button
        type="button"
        onClick={claim}
        disabled={busy}
        className="mt-5 rounded-xl bg-amber-500 px-6 py-3 text-base font-bold text-white shadow transition hover:bg-amber-600 active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? "Opening checkout…" : `Claim the $${offer.monthlyUsd} founding price`}
      </button>
    </section>
  );
}
