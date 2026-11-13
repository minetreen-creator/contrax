import { useEffect, useState } from "react";
import { displayTitle } from "~/lib/bid-title";
import { agencyDisplay } from "~/lib/bid-job-summary";
import { STATE_NAMES } from "~/lib/contract-map";
import { getOpenToAllBids, OPEN_TO_ALL_FIRST, type OpenToAllData } from "~/lib/open-to-all";
import { trackEvent } from "~/lib/track";

/**
 * "Open to all businesses (no set-aside)" (owner 2026-11-09): federal bids that name no set-aside,
 * listed apart from (and never counted in) the small-business matches. Radar fetches its list
 * after a search; the state pages pass the server-rendered one in.
 */
export function OpenToAllBids({
  trade,
  state,
  data: initial,
  where,
  tone = "dark",
}: {
  trade: string;
  state: string;
  data?: OpenToAllData | null;
  where: "radar" | "state_page";
  tone?: "dark" | "light";
}) {
  const [data, setData] = useState<OpenToAllData | null>(initial ?? null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (initial !== undefined) return;
    const t = trade.trim();
    if (!t) {
      setData(null);
      return;
    }
    let active = true;
    setAll(false);
    getOpenToAllBids({ data: { trade: t, state } })
      .then((d) => {
        if (active) setData(d);
      })
      .catch(() => {
        if (active) setData(null);
      });
    return () => {
      active = false;
    };
  }, [trade, state, initial]);

  const total = (data?.localCount ?? 0) + (data?.nationwideCount ?? 0);
  useEffect(() => {
    if (total > 0) trackEvent("open_to_all_shown", `${where}:${total}`);
  }, [total, where]);
  if (!data || total === 0 || data.bids.length === 0) return null;

  const dark = tone === "dark";
  const stateName = state ? (STATE_NAMES[state] ?? state) : "";
  const shown = all ? data.bids : data.bids.slice(0, OPEN_TO_ALL_FIRST);
  const due = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

  return (
    <section
      aria-label="Open to all businesses"
      className={
        dark
          ? "mt-8 rounded-2xl border border-sky-500/40 bg-slate-900/50 px-5 py-5"
          : "mt-8 rounded-2xl border border-sky-200 bg-sky-50/60 px-5 py-5"
      }
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className={`text-sm font-bold uppercase tracking-wide ${dark ? "text-sky-300" : "text-sky-800"}`}>
          🏛️ Open to all businesses (no set-aside)
        </h3>
        <span className={`text-xs font-semibold ${dark ? "text-slate-400" : "text-slate-500"}`}>{total} found</span>
      </div>
      <p className={`mt-1 text-sm leading-relaxed ${dark ? "text-slate-300" : "text-slate-600"}`}>
        Federal bids that name no set-aside are open to every company, small businesses included. Larger firms can bid
        too, so some are big jobs, and the companies that win them often hire local subcontractors.
        {stateName && data.localCount > 0
          ? ` ${data.localCount} ${data.localCount === 1 ? "is" : "are"} in ${stateName}.`
          : ""}
      </p>
      <ul className="mt-4 flex flex-col gap-3">
        {shown.map((b) => (
          <li key={b.id}>
            <a
              href={`/bid/${b.id}?source=open_to_all`}
              onClick={() => trackEvent("open_to_all_click", `${where}:${b.id}`)}
              className={
                dark
                  ? "block rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 hover:border-sky-400"
                  : "block rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-sky-400"
              }
            >
              <p className={`text-sm font-semibold ${dark ? "text-white" : "text-slate-900"}`}>{displayTitle(b.title)}</p>
              <p className={`mt-1 text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
                {[agencyDisplay(b.agency), b.local && stateName ? stateName : b.place ?? "Nationwide", due(b.due_date) ? `Due ${due(b.due_date)}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </a>
          </li>
        ))}
      </ul>
      {!all && data.bids.length > OPEN_TO_ALL_FIRST ? (
        <button
          type="button"
          onClick={() => {
            setAll(true);
            trackEvent("open_to_all_more", where);
          }}
          className={`mt-3 text-sm font-semibold ${dark ? "text-sky-300 hover:text-sky-200" : "text-sky-700 hover:text-sky-800"}`}
        >
          Show {data.bids.length - OPEN_TO_ALL_FIRST} more →
        </button>
      ) : null}
      {all && total > data.bids.length ? (
        <p className={`mt-3 text-xs ${dark ? "text-slate-500" : "text-slate-500"}`}>
          Showing the {data.bids.length} closing soonest of {total}.
        </p>
      ) : null}
    </section>
  );
}
