/**
 * Locked incumbent & pricing intel on a bid page (owner 2026-11-08: "a teaser preview of Award
 * Autopsy (past winning price/incumbent) or Re-Compete Radar (contract end date + upcoming re-bids),
 * paired with a blurred preview and an 'Unlock Incumbent & Pricing Intel' button").
 *
 * The blurred rows are PLACEHOLDERS: the real winner and amounts never reach a free viewer's browser
 * (the server sends only the teaser facts in src/lib/intel-teaser.ts).
 */
import { trackEvent } from "~/lib/track";
import type { IntelTeaser } from "~/lib/intel-teaser";
import { STARTER_FIRST_MONTH_PRICE } from "~/lib/starter-offer";

const BLUR = "select-none blur-[5px]";

export function IntelTeaserCard({ teaser, bidId }: { teaser: IntelTeaser | null; bidId: number }) {
  const t = teaser ?? { endYear: null, recompeteSoon: false, ended: false, historyYears: 0 };
  const endText = t.endYear
    ? t.recompeteSoon
      ? `Current contract ends in ${t.endYear}: likely re-bid soon`
      : t.ended
        ? `Prior contract ended in ${t.endYear}`
        : `Current contract runs to ${t.endYear}`
    : null;
  return (
    <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3">
      <p className="text-sm font-semibold text-emerald-200">🏆 We found who won this work last time, and what they were paid.</p>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm" aria-label="Locked preview">
        <dt className="text-slate-400">Last winner</dt>
        <dd className={`${BLUR} text-white`} aria-hidden="true">Mxxxxxx Sxxxxxxx Group LLC</dd>
        <dt className="text-slate-400">Paid</dt>
        <dd className={`${BLUR} text-white`} aria-hidden="true">$000,000</dd>
        <dt className="text-slate-400">Price history</dt>
        <dd className="text-slate-200">
          {t.historyYears ? `${t.historyYears} year${t.historyYears === 1 ? "" : "s"} on record, ` : ""}
          <span className={BLUR} aria-hidden="true">$00,000 to $000,000 a year</span>
        </dd>
        {endText ? (
          <>
            <dt className="text-slate-400">Re-bid</dt>
            <dd className={t.recompeteSoon ? "font-semibold text-amber-300" : "text-slate-200"}>{endText}</dd>
          </>
        ) : null}
      </dl>
      <p className="mt-2 text-xs text-slate-400">From public federal award records (USAspending.gov).</p>
      <a
        href={`/upgrade?plan=starter&source=bid-intel&bid=${bidId}`}
        onClick={() => trackEvent("bid_intel_unlock_click", String(bidId))}
        className="mt-3 inline-block rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-400"
      >
        Unlock Incumbent &amp; Pricing Intel · ${STARTER_FIRST_MONTH_PRICE} for 30 days
      </a>
    </div>
  );
}
