import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { BidAlertCapture } from "~/components/BidAlertCapture";
import { getIndustryDays } from "~/lib/industry-days-data";
import { stateCounts, type IndustryDayRow } from "~/lib/industry-days";
import { STATE_CODE_TO_NAME } from "~/lib/location-state";
import { trackEvent } from "~/lib/track";

/**
 * /industry-days — upcoming government industry days, contractor summits,
 * matchmaking and small-business outreach events (src/lib/industry-days.ts).
 * Owner 2026-10-25, after the USACE Charleston / SAME Federal Contractor
 * Summit flyer: the room where small contractors meet the buyers and primes.
 */
export const Route = createFileRoute("/industry-days")({
  loader: () => getIndustryDays(),
  head: () => {
    const title = "Government industry days and contractor events";
    const desc =
      "Upcoming federal industry days, contractor summits, matchmaking and small business outreach events by state, from live government notices. Free on Contrax.";
    return {
      meta: [
        { title: `${title} | Contrax` },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
      ],
      links: [{ rel: "canonical", href: "https://www.contrax.company/industry-days" }],
    };
  },
  component: IndustryDaysPage,
});

function dayLabel(d: string | null): string {
  if (!d) return "Date in the notice";
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function IndustryDaysPage() {
  const { rows }: { rows: IndustryDayRow[] | null } = Route.useLoaderData();
  const all = rows ?? [];
  const [state, setState] = useState("");
  const states = useMemo(() => stateCounts(all), [all]);
  const shown = state ? all.filter((r) => r.state === state) : all;

  return (
    <div className="min-h-screen bg-slate-50">
      <SiteHeader />
      <section className="bg-gradient-to-b from-[#0a1f44] to-[#123a72] px-4 py-14 text-center text-white">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-amber-400">Industry days &amp; contractor events</p>
        <h1 className="mx-auto mt-3 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">Meet the buyers before the bid drops</h1>
        <p className="mx-auto mt-4 max-w-2xl text-blue-100">
          Industry days, contractor summits and matchmaking sessions are where agencies preview what they plan to buy and primes look for small business partners. Here are the upcoming ones from live government notices.
        </p>
        <p className="mt-6 text-sm font-semibold text-amber-300">📅 {all.length} upcoming event{all.length === 1 ? "" : "s"}</p>
      </section>

      <main className="mx-auto max-w-4xl space-y-8 px-4 py-10">
        {rows === null ? (
          <p className="rounded-xl bg-white p-4 text-sm text-slate-600">The event list couldn&apos;t be read just now. Please check back soon.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="ind-state" className="text-sm font-semibold text-slate-700">
                State
              </label>
              <select
                id="ind-state"
                value={state}
                onChange={(e) => {
                  setState(e.target.value);
                  trackEvent("industry_days_state", e.target.value || "all");
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="">All states ({all.length})</option>
                {states.map((s) => (
                  <option key={s.code} value={s.code}>
                    {STATE_CODE_TO_NAME[s.code] ?? s.code} ({s.count})
                  </option>
                ))}
              </select>
            </div>

            {shown.length === 0 ? (
              <p className="rounded-xl bg-white p-4 text-sm text-slate-600">No upcoming events{state ? ` in ${STATE_CODE_TO_NAME[state] ?? state}` : ""} right now. New notices arrive every few hours.</p>
            ) : (
              <ul className="space-y-3">
                {shown.map((r: IndustryDayRow) => (
                  <li key={r.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                    <p className="text-sm font-bold text-amber-700">{dayLabel(r.date)}</p>
                    <p className="mt-1 text-lg font-bold text-slate-900">{r.title}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {r.agency}
                      {r.location ? ` · ${r.location}` : r.state ? ` · ${STATE_CODE_TO_NAME[r.state] ?? r.state}` : ""}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-4 text-sm font-semibold">
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("industry_days_notice_click", r.state ?? "")} className="text-blue-700 underline">
                          Read the notice and register
                        </a>
                      ) : null}
                      <a href={`/bid/${r.id}`} className="text-blue-700 underline">
                        Details on Contrax
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-500">
              The date shown is the one on the notice: usually the event itself, sometimes the deadline to register or send questions. Always confirm in the notice.
            </p>
          </>
        )}

        <BidAlertCapture
          stateCode={state || null}
          source="industry_days"
          heading="Get the bids that come out of these events"
          note="Free. One confirmation email, then only new bids. Unsubscribe anytime."
          tone="light"
        />

        <section className="rounded-2xl bg-[#0a1f44] p-6 text-center text-white">
          <p className="text-lg font-bold">Going to an industry day?</p>
          <p className="mt-1 text-sm text-blue-100">See what that agency is buying right now, and who won its last contracts.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <a href="/radar" className="rounded-xl bg-amber-500 px-5 py-2.5 font-bold text-slate-950">
              Search open bids free
            </a>
            <a href="/subcontracts" className="rounded-xl bg-white/10 px-5 py-2.5 font-bold text-white">
              Find primes hiring subs
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
