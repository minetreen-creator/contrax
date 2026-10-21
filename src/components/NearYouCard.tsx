import { useEffect, useState } from "react";
import { STATE_NAMES } from "~/lib/contract-map";
import { getNearYou, NEAR_YOU_TRADES, nearYouRadarHref, type NearYou } from "~/lib/near-you";
import { trackEvent } from "~/lib/track";

/**
 * "What's open near you?" (owner 2026-10-21): the real number of bids open
 * right now in the visitor's approximate state, with one-tap trade chips into
 * Radar. Fetched client-side so the edge-cached homepage stays visitor-free;
 * renders nothing until it has a real count, and nothing outside the US.
 */
export function NearYouCard() {
  const [near, setNear] = useState<NearYou | null>(null);
  useEffect(() => {
    let alive = true;
    getNearYou()
      .then((d) => {
        if (!alive || !d.state || d.open <= 0) return;
        setNear(d);
        trackEvent("near_you_shown", d.state);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!near) return null;
  const name = STATE_NAMES[near.state] ?? near.state;
  return (
    <section aria-label={`Bids open in ${name}`} className="mx-auto mt-6 max-w-[1120px] px-4 sm:px-6">
      <div className="near-you-card rounded-2xl border border-emerald-400/40 bg-[#0c1c36] p-5 text-white shadow-[0_8px_30px_rgba(16,185,129,0.18)] sm:p-6">
        <p className="flex items-center gap-2.5 text-xs font-bold uppercase tracking-widest text-emerald-300">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          Open near you · live
        </p>
        <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">
          {near.open.toLocaleString("en-US")} government bids open right now in {name}
        </h2>
        {near.newToday > 0 ? (
          <p className="mt-1 text-sm font-semibold text-amber-300">
            +{near.newToday.toLocaleString("en-US")} new in the last 24 hours
          </p>
        ) : null}
        <p className="mt-3 text-sm text-slate-300">What does your business do?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {NEAR_YOU_TRADES.map((t) => (
            <a
              key={t}
              href={nearYouRadarHref(near.state, t)}
              onClick={() => trackEvent("near_you_trade_click", `${near.state}:${t}`)}
              className="rounded-full border border-slate-600 bg-slate-900/60 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:border-emerald-400 hover:bg-emerald-500/15"
            >
              {t}
            </a>
          ))}
          <a
            href={nearYouRadarHref(near.state)}
            onClick={() => trackEvent("near_you_trade_click", `${near.state}:other`)}
            className="rounded-full px-3.5 py-1.5 text-sm font-semibold text-emerald-300 hover:text-emerald-200"
          >
            Something else →
          </a>
        </div>
      </div>
    </section>
  );
}
