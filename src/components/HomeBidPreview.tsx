import { useEffect, useState } from "react";
import { PREVIEW_MAX_ITEMS, PREVIEW_TAB_LABEL, PREVIEW_TRADE_WORDS, previewDay, previewStateHref, type BidPreview, type PreviewTrade } from "~/lib/bid-preview";
import { getBidPreviews } from "~/lib/bid-preview-fn";
import { STATE_NAMES } from "~/lib/contract-map";
import { US_STATES } from "~/lib/states";
import { trackEvent } from "~/lib/track";

/**
 * Homepage bid preview, right under the hero (owner 2026-11-16). Trade tabs; the agency's own
 * notice text on the left and the brief Contrax made from it on the right; then a state picker
 * that opens the live bids for that trade. Every tab is a real open bid (see ~/lib/bid-preview),
 * switching tabs asks for nothing, and with no qualifying bid the section is not drawn.
 */
export function HomeBidPreview() {
  const [previews, setPreviews] = useState<BidPreview[] | null>(null);
  const [trade, setTrade] = useState<PreviewTrade | null>(null);
  const [state, setState] = useState("");
  useEffect(() => {
    let active = true;
    getBidPreviews()
      .then((p) => {
        if (!active) return;
        setPreviews(p);
        if (p.length) {
          setTrade(p[0].trade);
          trackEvent("home_bid_preview_view", p[0].trade);
        }
      })
      .catch(() => active && setPreviews([]));
    return () => {
      active = false;
    };
  }, []);
  const p = previews?.find((x) => x.trade === trade) ?? null;
  if (!previews?.length || !p) return null;
  const s = p.summary;
  const dated = s.key_milestones.filter((m) => m.event.trim()).slice(0, PREVIEW_MAX_ITEMS);
  const musts = s.mandatory_requirements.filter((m) => m.text.trim()).slice(0, PREVIEW_MAX_ITEMS);
  const flags = s.red_flags.filter((m) => m.text.trim()).slice(0, 3);
  const words = PREVIEW_TRADE_WORDS[p.trade];
  return (
    <section aria-labelledby="home-bid-preview-title" className="bg-[#07162e] px-4 pb-8 pt-6 text-white sm:px-8">
      <div className="mx-auto max-w-7xl">
        <h2 id="home-bid-preview-title" className="text-xl font-bold sm:text-2xl">See what Contrax does with a real bid</h2>
        <p className="mt-1 text-sm text-slate-300">Pick your trade. Each one is an open bid today, not a mock-up.</p>
        <div role="tablist" aria-label="Trade" className="mt-4 flex flex-wrap gap-2">
          {previews.map((x) => (
            <button
              key={x.trade}
              type="button"
              role="tab"
              aria-selected={x.trade === p.trade}
              onClick={() => {
                setTrade(x.trade);
                trackEvent("home_bid_preview_tab", x.trade);
              }}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition ${x.trade === p.trade ? "border-amber-400 bg-amber-400 text-slate-950" : "border-white/20 text-slate-200 hover:border-amber-400"}`}
            >
              {PREVIEW_TAB_LABEL[x.trade]}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/15 bg-white/5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-300">What the agency posts</p>
              <span className="rounded-full bg-rose-500/20 px-2.5 py-0.5 text-xs font-bold text-rose-200">
                {p.noticeWords.toLocaleString("en-US")} words · plus the attached documents
              </span>
            </div>
            <p className="mt-2 text-sm font-semibold">{p.title}</p>
            <p className="mt-1 text-xs text-slate-400">{[p.agency, p.location].filter(Boolean).join(" · ")}</p>
            <p className="mt-3 max-h-72 overflow-hidden text-[13px] leading-relaxed text-slate-300 [mask-image:linear-gradient(to_bottom,black_72%,transparent)]">{p.notice}</p>
            <p className="mt-2 text-xs text-slate-400">The opening of the notice, word for word.</p>
          </div>

          <div className="rounded-2xl border-2 border-emerald-400/60 bg-emerald-400/10 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-200">What Contrax gives you</p>
              <span className="rounded-full bg-emerald-400/20 px-2.5 py-0.5 text-xs font-bold text-emerald-100">Plain-English breakdown</span>
            </div>
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-emerald-200">The job</dt>
                <dd className="mt-1 leading-snug text-slate-100">{s.summary}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-emerald-200">Key dates</dt>
                <dd className="mt-1">
                  <ul className="space-y-1 text-slate-100">
                    {dated.map((m) => (
                      <li key={`${m.event}-${m.date}`}>
                        {m.event}
                        {m.date ? <span className="font-semibold">: {previewDay(m.date)}</span> : null}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-emerald-200">What you must have</dt>
                <dd className="mt-1">
                  <ul className="space-y-1 text-slate-100">
                    {musts.map((m) => (
                      <li key={m.text} className="flex gap-2">
                        <span aria-hidden="true" className="text-emerald-300">✓</span>
                        <span>{m.text}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
              {flags.length > 0 && (
                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-amber-300">Watch out</dt>
                  <dd className="mt-1">
                    <ul className="space-y-1 text-amber-100">
                      {flags.map((m) => (
                        <li key={m.text} className="flex gap-2">
                          <span aria-hidden="true">⚠</span>
                          <span>{m.text}</span>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
            <p className="mt-3 text-xs text-slate-400">
              Made from this notice. Bids due {previewDay(p.due)}.{" "}
              <a href={`/bid/${p.id}?source=home_bid_preview`} onClick={() => trackEvent("home_bid_preview_click", "bid")} className="font-semibold text-emerald-200 underline underline-offset-2 hover:text-emerald-100">
                Open this bid
              </a>
            </p>
          </div>
        </div>

        <form
          className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4 sm:flex-row sm:items-center sm:justify-between"
          onSubmit={(e) => {
            e.preventDefault();
            if (!state) return;
            trackEvent("home_bid_preview_click", `state_${p.trade}`);
            window.location.assign(previewStateHref(STATE_NAMES[state], p.trade));
          }}
        >
          <label htmlFor="home-bid-preview-state" className="text-sm font-semibold">
            Want to see open {words} bids in your state right now?
          </label>
          <div className="flex gap-2">
            <select
              id="home-bid-preview-state"
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-white/20 bg-[#0b1f3d] px-3 py-2 text-sm text-white sm:w-48 sm:flex-none"
            >
              <option value="">Choose your state</option>
              {US_STATES.map((c) => (
                <option key={c} value={c}>{STATE_NAMES[c]}</option>
              ))}
            </select>
            <button type="submit" disabled={!state} className="whitespace-nowrap rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-300 disabled:opacity-60">
              See live bids free →
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
