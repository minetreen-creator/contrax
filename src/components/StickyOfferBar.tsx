/**
 * A slim bar pinned to the bottom of search pages, worded for the page (owner 2026-11-08: "On every
 * /contracts-in/[state] and /clauses/[number] page, add a sticky banner tailored to that exact page
 * (e.g., 'Get new California commercial trade bids emailed every morning'), linking directly into
 * your Stripe checkout").
 *
 * It appears once the visitor scrolls past the first screen (it never covers the page's own search
 * button), links to the $5 Starter checkout, and "×" hides it for a week on this device.
 */
import { useEffect, useState } from "react";
import { STARTER_FIRST_MONTH_PRICE } from "~/lib/starter-offer";
import { trackEvent } from "~/lib/track";

const DISMISS_KEY = "contrax_offer_bar_dismissed";
const SNOOZE_MS = 7 * 86_400_000;

export function StickyOfferBar({ text, source }: { text: string; source: string }) {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY));
      setDismissed(Number.isFinite(at) && at > 0 && Date.now() - at < SNOOZE_MS);
    } catch {
      setDismissed(false);
    }
    const onScroll = () => setVisible(window.scrollY > Math.min(600, window.innerHeight * 0.8));
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const shown = visible && !dismissed;
  useEffect(() => {
    if (shown) trackEvent("offer_bar_shown", source);
  }, [shown, source]);
  if (!shown) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-amber-500/40 bg-slate-950/95 px-3 py-2.5 text-white shadow-2xl backdrop-blur print:hidden" role="region" aria-label="Daily bid email offer">
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">
          📧 {text}
          <span className="hidden font-normal text-slate-400 sm:inline"> · ${STARTER_FIRST_MONTH_PRICE} for 30 days, no automatic renewal</span>
        </p>
        <a
          href={`/upgrade?plan=starter&source=${encodeURIComponent(source)}`}
          onClick={() => trackEvent("offer_bar_click", source)}
          className="shrink-0 rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400"
        >
          ${STARTER_FIRST_MONTH_PRICE} Starter →
        </a>
        <button
          type="button"
          aria-label="Hide for a week"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, String(Date.now()));
            } catch {
              /* storage blocked */
            }
            setDismissed(true);
            trackEvent("offer_bar_dismiss", source);
          }}
          className="shrink-0 rounded px-1 text-xl leading-none text-slate-400 hover:text-white"
        >
          ×
        </button>
      </div>
    </div>
  );
}
