import { useEffect, useState } from "react";
import { displayTitle } from "~/lib/bid-title";
import { redirectToCheckout } from "~/lib/checkout";
import { rememberCheckoutBid } from "~/lib/checkout-resume";
import { STARTER_FIRST_MONTH_PRICE } from "~/lib/starter-offer";
import { trackEvent } from "~/lib/track";
import { CheckoutTrust } from "~/components/CheckoutTrust";

/**
 * The bid-page $5 confirm step (owner 2026-11-08, "yes 2"): 4 of the day's 6 Stripe checkouts came
 * from the bid page's $5 button and none paid. One short sheet between the tap and Stripe: THIS bid
 * (buyer, number, deadline), what $5 gets right away, and "one time, no automatic renewal" in big
 * type. Continuing remembers the bid so the buyer lands back on it, unlocked, after paying.
 * Every line is true of the Starter pass today (src/lib/starter-pass.ts).
 */
export interface UnlockBidSummary {
  title?: string | null;
  agency?: string | null;
  due_date?: string | null;
  solicitation_number?: string | null;
  /** The notice lists a point of contact (never shown here; only whether one exists). */
  has_contact?: boolean;
}

function dueLine(due: string | null | undefined): string | null {
  if (!due) return null;
  const t = Date.parse(due);
  if (Number.isNaN(t)) return null;
  const days = Math.ceil((t - Date.now()) / 86_400_000);
  const date = new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return days >= 0 ? `Due ${date} · ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} left`}` : `Due ${date}`;
}

export function UnlockBidSheet({ bidId, bid, onClose }: { bidId: number; bid?: UnlockBidSummary | null; onClose: () => void }) {
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    trackEvent("bid_lock_sheet_shown", String(bidId));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bidId, onClose]);

  const due = dueLine(bid?.due_date);
  const go = () => {
    if (opening) return;
    setOpening(true);
    trackEvent("bid_lock_sheet_continue", String(bidId));
    rememberCheckoutBid(bidId);
    redirectToCheckout("starter").finally(() => setOpening(false));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="unlock-bid-title" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 text-slate-900 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <p id="unlock-bid-title" className="text-lg font-extrabold leading-tight">
            Unlock this bid for ${STARTER_FIRST_MONTH_PRICE}
          </p>
          <button type="button" onClick={onClose} aria-label="Close" className="px-1 text-xl leading-none text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          {bid?.title ? <p className="font-semibold leading-snug">{displayTitle(bid.title)}</p> : null}
          {bid?.agency ? <p className="mt-0.5 text-slate-600">{bid.agency}</p> : null}
          <p className="mt-1 text-xs text-slate-500">
            {[bid?.solicitation_number ? `Bid #${bid.solicitation_number}` : null, due].filter(Boolean).join(" · ")}
          </p>
        </div>

        <p className="mt-4 text-sm font-semibold">Right after you pay:</p>
        <ul className="mt-1.5 space-y-1.5 text-sm text-slate-700">
          <li>✓ This bid&apos;s official notice and documents, with how to submit</li>
          {bid?.has_contact ? <li>✓ The buyer&apos;s contact for this bid</li> : null}
          <li>✓ Every new bid in your trade and states, emailed at 6 AM, for 30 days</li>
          <li>✓ Every other locked bid on Contrax, open for 30 days</li>
        </ul>

        <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-center">
          <p className="text-base font-extrabold text-slate-900">${STARTER_FIRST_MONTH_PRICE} one time. No automatic renewal.</p>
          <p className="mt-0.5 text-xs text-slate-600">On day 30 it simply ends. We email you once before; do nothing and you&apos;re never charged again.</p>
        </div>

        <button
          type="button"
          onClick={go}
          disabled={opening}
          className="mt-4 w-full rounded-xl bg-amber-400 px-4 py-3 text-base font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-60"
        >
          {opening ? "Opening secure checkout…" : `Continue to secure checkout: $${STARTER_FIRST_MONTH_PRICE}`}
        </button>
        <CheckoutTrust className="mt-2 text-center" />
        <p className="mt-1 text-center text-xs text-slate-500">You&apos;ll come right back to this bid.</p>
        <button type="button" onClick={onClose} className="mt-2 w-full py-1 text-center text-sm text-slate-500 underline">
          Not now
        </button>
      </div>
    </div>
  );
}
