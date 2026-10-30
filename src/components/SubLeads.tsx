import { useEffect, useMemo, useRef, useState } from "react";
import { STATE_NAMES } from "~/lib/contract-map";
import { getNearYou } from "~/lib/near-you";
import { companyDisplayName, orderForState, shortAmount, subLeadTrade, type SubLead } from "~/lib/sub-leads";
import { trackEvent } from "~/lib/track";

const SHOWN = 6;
const PRIME_EMAIL = "contrax.companyllc@gmail.com";

/**
 * Homepage "Subcontracting leads" (owner 2026-10-30: "for the subs, can we make
 * a list on the homepage?"). Companies that just won federal service work
 * outside their home state usually need a local crew; the visitor's state is
 * listed first. Public award records (USAspending); nobody's email is shown.
 */
export function SubLeads({ leads }: { leads: SubLead[] | null | undefined }) {
  const [state, setState] = useState("");
  const [all, setAll] = useState(false);
  const shown = useRef(false);

  useEffect(() => {
    let alive = true;
    getNearYou()
      .then((d) => alive && d.state && setState(d.state))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const ordered = useMemo(() => orderForState(leads ?? [], state), [leads, state]);
  const inState = state ? ordered.filter((l) => l.workState === state).length : 0;

  useEffect(() => {
    if (!ordered.length || shown.current) return;
    shown.current = true;
    trackEvent("sub_leads_shown", String(ordered.length));
  }, [ordered.length]);

  if (!ordered.length) return null;
  const list = all ? ordered : ordered.slice(0, SHOWN);
  const stateName = state ? STATE_NAMES[state] ?? state : "";

  return (
    <section aria-labelledby="sub-leads-title" className="mx-auto max-w-[1120px] px-4 py-10 sm:px-6">
      <div className="rounded-3xl border border-emerald-400/30 bg-[#0a1a24] p-5 text-white shadow-[0_10px_40px_rgba(16,185,129,0.15)] sm:p-8">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Subcontracting leads · updated weekdays</p>
        <h2 id="sub-leads-title" className="mt-2 text-2xl font-extrabold sm:text-3xl">
          These companies just won work far from home. They may need your crew.
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          Federal service contracts won in the last 30 days by companies based in another state. Winners like these
          usually hire a local subcontractor to do the work.
          {stateName && inState > 0 ? ` ${inState} ${inState === 1 ? "is" : "are"} in ${stateName}, listed first.` : ""}
        </p>

        <ul className="mt-5 divide-y divide-white/10">
          {list.map((l) => {
            const name = companyDisplayName(l.recipient);
            const trade = subLeadTrade(l.naics);
            const work = STATE_NAMES[l.workState] ?? l.workState;
            const home = [l.recipientCity ? companyDisplayName(l.recipientCity) : null, l.recipientState].filter(Boolean).join(", ");
            const q = encodeURIComponent([l.recipient, l.recipientCity, l.recipientState].filter(Boolean).join(" "));
            return (
              <li key={`${l.recipient}-${l.workState}`} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-white">
                    {name} <span className="font-normal text-slate-400">· {home}</span>
                  </p>
                  <p className="text-sm text-slate-300">
                    Won <span className="font-semibold text-emerald-300">{shortAmount(l.amount)}</span> in {trade} work in{" "}
                    <span className={l.workState === state ? "font-semibold text-amber-300" : "font-semibold text-white"}>{work}</span>
                    {l.agency ? ` · ${companyDisplayName(l.agency)}` : ""}
                  </p>
                </div>
                <a
                  href={`https://www.google.com/search?q=${q}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => trackEvent("sub_leads_lookup", `${l.workState}:${trade}`)}
                  className="shrink-0 text-sm font-semibold text-emerald-300 hover:text-emerald-200"
                >
                  Look them up →
                </a>
              </li>
            );
          })}
        </ul>

        {ordered.length > SHOWN && (
          <button
            type="button"
            onClick={() => {
              setAll((v) => !v);
              trackEvent("sub_leads_more", String(ordered.length));
            }}
            className="mt-2 text-sm font-semibold text-slate-300 underline hover:text-white"
          >
            {all ? "Show fewer" : `Show all ${ordered.length}`}
          </button>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-white/5 p-4 text-sm text-slate-300">
            <p className="font-semibold text-white">Local contractor?</p>
            Reach out to the winner and offer your crew. Want work you can bid on directly too?{" "}
            <a href="/radar" onClick={() => trackEvent("sub_leads_radar", state || "none")} className="font-semibold text-emerald-300 underline">
              See open bids in your trade
            </a>
            .
          </div>
          <div className="rounded-xl bg-white/5 p-4 text-sm text-slate-300">
            <p className="font-semibold text-white">Won a contract like these?</p>
            Tell us the trade and city and we'll send a list of local companies near the job site. Your first list is free.{" "}
            <a
              href={`mailto:${PRIME_EMAIL}?subject=${encodeURIComponent("Free local subcontractor list")}`}
              onClick={() => trackEvent("sub_leads_prime_ask", state || "none")}
              className="font-semibold text-emerald-300 underline"
            >
              Ask for my list
            </a>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">Source: USAspending.gov award records. Company names and amounts as reported.</p>
      </div>
    </section>
  );
}
