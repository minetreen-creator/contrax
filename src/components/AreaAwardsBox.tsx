import type { AreaAwards } from "~/lib/area-awards";
import { shortDollars, typicalRangeText } from "~/lib/area-awards";
import { STARTER_FIRST_MONTH_PRICE } from "~/lib/starter-offer";
import { PRICE_LOOKUP_PRICE_LABEL } from "~/lib/price-lookup";
import { trackEvent } from "~/lib/track";
import { useState } from "react";

const day = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null;

/**
 * "What similar federal jobs went for" (owner 2026-11-07). Recent federal
 * contracts for the same kind of work in the same state, from USAspending.
 * Paid plans see the winners and amounts; everyone else sees the count.
 */
export function AreaAwardsBox({ data, stateName, bidId }: { data: AreaAwards; stateName: string | null; bidId?: number }) {
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  // $9 for this one bid (owner 2026-11-14: "What did this sell for?"). Offered only when there are awards to show.
  const buyLookup = async () => {
    if (!bidId || buying) return;
    setBuying(true);
    setBuyError(null);
    trackEvent("price_lookup_click", String(bidId));
    try {
      const res = await fetch("/api/price-lookup/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bidId }) });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (j.url) {
        window.location.href = j.url;
        return;
      }
      setBuyError(j.error ?? "Checkout is unavailable right now.");
    } catch {
      setBuyError("Checkout is unavailable right now.");
    }
    setBuying(false);
  };
  const where = stateName ?? data.state;
  const since = day(data.since);
  const count = `${data.total} federal contract${data.total === 1 ? "" : "s"}`;
  return (
    <section id="typical-size" aria-label="Federal winning prices" className="mt-5 rounded-2xl border border-emerald-500/40 bg-slate-900 px-5 py-4">
      <h2 className="text-sm font-bold text-emerald-200">
        {data.total > 0 ? `💰 What similar federal jobs in ${where} went for` : "💰 What similar federal jobs go for"}
      </h2>
      <p className="mt-1 text-sm text-slate-300">
        {data.total > 0 ? (
          <>
            {count} for {data.label} work in {where}
            {since ? ` since ${since}` : ""}, from USAspending.gov.
          </>
        ) : (
          <>No recent federal contracts for {data.label} work in {where} on record, so this is the picture nationwide, from USAspending.gov.</>
        )}
      </p>
      {data.typical && (
        <p className="mt-3 text-sm text-slate-200">
          Typical contract size{data.typical.scope === "nation" ? " nationwide" : ""}{" "}
          <b className="text-base text-white">{typicalRangeText(data.typical)}</b>
          <span className="block text-xs text-slate-400">
            {data.typical.scope === "nation"
              ? `An estimate: the middle half of ${data.typical.count.toLocaleString("en-US")} federal contracts for this work across the country${data.total > 0 ? `, because ${where} has too few for a range of its own` : ""}. It is not this bid's budget.`
              : "An estimate: the middle half of those contracts. It is not this bid's budget."}
          </span>
        </p>
      )}
      {data.total === 0 ? null : data.detail ? (
        <>
          <p className="mt-3 text-sm text-slate-200">
            Typical award <b className="text-white">{shortDollars(data.detail.median)}</b>
            {data.total > 1 && (
              <>
                {" "}
                · range {shortDollars(data.detail.low)} to {shortDollars(data.detail.high)}
              </>
            )}
          </p>
          <ul className="mt-3 divide-y divide-slate-800 text-sm">
            {data.detail.awards.map((a) => (
              <li key={a.url} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0">
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-white hover:text-emerald-200">
                    {a.winner}
                  </a>
                  <span className="block truncate text-xs text-slate-400">
                    {[a.agency, day(a.awardedOn)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 font-semibold text-emerald-300">{shortDollars(a.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Federal awards of $25K and up. Each name links to the public award record.</p>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate-300">See who won each one and what each was paid.</p>
          {bidId ? (
            <>
              <button
                type="button"
                onClick={buyLookup}
                disabled={buying}
                className="mt-3 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-300 disabled:opacity-60"
              >
                {buying ? "Opening checkout…" : `See what they sold for · ${PRICE_LOOKUP_PRICE_LABEL}`}
              </button>
              <p className="mt-1 text-xs text-slate-400">One-time, for this bid. No account or subscription needed.</p>
              {buyError && <p className="mt-1 text-xs text-rose-300">{buyError}</p>}
              <a href="/upgrade?plan=starter" className="mt-2 block text-xs font-semibold text-emerald-300 hover:text-emerald-200">
                Or see it on every bid with Starter, ${STARTER_FIRST_MONTH_PRICE} for 30 days →
              </a>
            </>
          ) : (
            <a href="/upgrade?plan=starter" className="mt-2 inline-block text-sm font-semibold text-emerald-300 hover:text-emerald-200">
              Unlock with Starter, ${STARTER_FIRST_MONTH_PRICE} for 30 days →
            </a>
          )}
        </>
      )}
    </section>
  );
}
