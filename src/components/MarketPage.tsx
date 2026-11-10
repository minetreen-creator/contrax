import { SiteHeader } from "~/components/SiteHeader";
import { BRAND_MESSAGE } from "~/lib/brand-message";
import { marketPitchPath, networkName, type Market } from "~/lib/markets";
import type { MarketData } from "~/lib/markets.server";
import { radarHrefFor, SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { certNames } from "~/lib/sub-finder";
import { trackEvent } from "~/lib/track";

/**
 * One Contractor Support Network market page (owner 2026-11-10, src/lib/markets.ts): find the work
 * (open local bids, live), build the team (Sub Finder and registered subs, live), and the market's
 * partner when one has signed. Markets without a partner show no partner section, only an invitation
 * for local companies. Contrax contacts no one; contractors who visit choose.
 */
const fmtDue = (d: string | null) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;

export function MarketPage({ market: m, data: d }: { market: Market; data: MarketData }) {
  const p = m.partner;
  const f = m.facts;
  const st = m.stateCode;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 [color-scheme:light]">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          <a href="/markets" className="hover:underline">Contractor Support Network</a> · {m.name}
        </p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900 sm:text-4xl">{p ? "Find the work. Build the team. House the crew." : BRAND_MESSAGE}</h1>
        <p className="mt-2 max-w-3xl text-slate-700">
          For contractors working government jobs in {m.name} ({m.areaLabel}): open bids, certified subcontractors{p ? ", and housing for traveling crews" : ""}.
        </p>

        <p className="mt-4 rounded-xl bg-sky-50 p-3 text-sm text-slate-800">
          Federal construction in {f.scope}, {f.asOf}: <strong>{f.federalConstruction}</strong>, and {f.outOfStateShare} of it went to {f.outOfStateFirms} firms based outside{" "}
          {m.stateName}. At least {f.endingSoonCount} contracts worth {f.endingSoonValue} come up for rebid in the next 12 months. Biggest buyers: {f.topBuyers.join(", ")}.
          {f.registeredContractors ? ` ${f.registeredContractors} construction contractors in ${m.name} are registered for federal work.` : ""}{" "}
          <span className="text-xs text-slate-500">Source: {f.source}.</span>
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <a href="#work" className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-blue-400">
            <p className="text-2xl font-bold text-slate-900">{d.build > 0 ? d.build : "Live"}</p>
            <p className="text-sm text-slate-700">{d.build > 0 ? `open construction and facility bids in ${m.name}` : `${m.name} government bids`}</p>
          </a>
          <a href="#team" className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-blue-400">
            <p className="text-2xl font-bold text-slate-900">{d.subs.total > 0 ? d.subs.total.toLocaleString("en-US") : "Sub Finder"}</p>
            <p className="text-sm text-slate-700">{d.subs.total > 0 ? `registered construction, HVAC and electrical subs in ${m.name}` : "Find certified local subs and collect their quotes"}</p>
          </a>
          {p ? (
            <a href="#housing" className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-blue-400">
              <p className="text-2xl font-bold text-slate-900">Crew housing</p>
              <p className="text-sm text-slate-700">Housing for traveling project teams, through our referral partner</p>
            </a>
          ) : (
            <a href="#work" className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-blue-400">
              <p className="text-2xl font-bold text-slate-900">{f.outOfStateShare}</p>
              <p className="text-sm text-slate-700">of federal construction here went to firms from out of state</p>
            </a>
          )}
        </div>

        <section id="work" className="mt-8 scroll-mt-20">
          <h2 className="text-xl font-bold text-slate-900">1. Find the work</h2>
          <p className="mt-1 text-sm text-slate-600">
            {d.open > 0 ? `${d.open} open government bids in ${m.name} right now; the soonest construction and facility jobs are below.` : `Open government bids in ${m.name}, updated every weekday.`}
          </p>
          {d.bids.length ? (
            <ul className="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {d.bids.map((b) => (
                <li key={b.id} className="p-3">
                  <a href={`/bid/${b.id}`} className="font-semibold text-blue-700 hover:underline">{b.title}</a>
                  <p className="text-xs text-slate-600">{[b.agency, fmtDue(b.due) ? `Due ${fmtDue(b.due)}` : null].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
          ) : null}
          <a href={radarHrefFor(SEO_TRADE_BY_SLUG.construction, st)} className="mt-3 inline-block font-semibold text-blue-700">Search {m.stateName} construction bids with Contract Radar →</a>
        </section>

        <section id="team" className="mt-8 scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-xl font-bold text-slate-900">2. Build the team</h2>
          <p className="mt-1 text-sm text-slate-700">
            Bidding as the prime? Sub Finder shows local subs who listed their business for primes, by trade and certification. Send a Trade Package with your scope and deadline and
            their quotes come to your inbox.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
            <a href={`/sub-finder?state=${st}`} className="rounded-lg bg-slate-900 px-4 py-2 text-white">Open Sub Finder</a>
            <a href={`/sub-finder?trade=hvac&state=${st}`} className="rounded-lg border border-slate-300 px-4 py-2 text-slate-800">HVAC and plumbing subs</a>
            <a href={`/sub-finder?trade=electrical&state=${st}`} className="rounded-lg border border-slate-300 px-4 py-2 text-slate-800">Electrical subs</a>
            <a href={`/sub-finder?trade=construction&state=${st}`} className="rounded-lg border border-slate-300 px-4 py-2 text-slate-800">Construction subs</a>
          </div>
          {d.subs.total > 0 ? (
            <div className="mt-5">
              <h3 className="font-bold text-slate-900">
                {d.subs.total.toLocaleString("en-US")} construction, HVAC and electrical subs registered in {m.name}
              </h3>
              <p className="text-sm text-slate-600">
                {[d.subs.certs.vosb ? `${d.subs.certs.vosb} veteran-owned` : null, d.subs.certs.sdvosb ? `${d.subs.certs.sdvosb} SDVOSB` : null, d.subs.certs.wosb ? `${d.subs.certs.wosb} WOSB` : null]
                  .filter(Boolean)
                  .join(" · ")}
                {" · "}small businesses registered with the government (SAM.gov). Contrax doesn't contact them; reach out through their website.
              </p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {d.subs.rows.map((r) => (
                  <li key={r.uei} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                    <p className="font-semibold text-slate-900">{r.name}</p>
                    <p className="text-xs text-slate-600">{[r.city, r.trades.filter((t) => m.subTrades.includes(t)).map((t) => (t === "hvac" ? "HVAC/plumbing" : t)).join(", ")].filter(Boolean).join(" · ")}</p>
                    {r.certs.length ? <p className="text-xs text-emerald-700">{certNames(r.certs.filter((c) => c !== "vosb" || !r.certs.includes("sdvosb"))).join(", ")}</p> : null}
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="nofollow noopener noreferrer" className="text-xs font-semibold text-blue-700 hover:underline">Website →</a>
                    ) : null}
                    <a href={`/sub-finder/claim?uei=${r.uei}`} className="ml-3 text-xs text-slate-500 hover:underline">Your business? Claim it</a>
                  </li>
                ))}
              </ul>
              <a href={`/sub-finder?trade=construction&state=${st}`} className="mt-3 inline-block text-sm font-semibold text-blue-700">See more {m.stateName} subs in Sub Finder →</a>
            </div>
          ) : null}
          <p className="mt-3 text-sm text-slate-700">
            A {m.name} sub? <a href="/sub-finder/join" className="font-semibold text-blue-700">Get listed for primes →</a>
          </p>
        </section>

        {p ? (
          <section id="housing" className="mt-8 scroll-mt-20 rounded-2xl border-2 border-slate-900 bg-white p-5">
            <h2 className="text-xl font-bold text-slate-900">3. House the crew</h2>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-sky-700">Housing referral partner · {p.name}</p>
            <p className="mt-1 text-lg font-bold text-slate-900">{p.tagline}{p.saving ? `: ${p.saving}.*` : ""}</p>
            <p className="mt-1 text-sm text-slate-700">{p.pitch} {p.proof ?? ""}</p>
            <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
              {p.stats.map((s) => (
                <div key={s.label} className="rounded-xl bg-sky-50 p-3">
                  <dt className="sr-only">{s.label}</dt>
                  <dd className="text-2xl font-extrabold text-slate-900">{s.value}{s.value === "3x" ? "*" : ""}</dd>
                  <dd className="text-xs text-slate-600">{s.label}</dd>
                </div>
              ))}
            </dl>
            <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-700 sm:grid-cols-4">
              {p.amenities.map((a) => (
                <li key={a}>✓ {a}</li>
              ))}
            </ul>
            <p className="mt-4 text-sm font-semibold text-slate-900">{p.ask}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <a
                href={p.url}
                target="_blank"
                rel="sponsored noopener"
                onClick={() => trackEvent(p.clickEvent, "partner_site")}
                className="inline-block rounded-lg bg-slate-900 px-4 py-2.5 font-semibold text-white"
              >
                Get crew housing from {p.name} →
              </a>
              <a href={`tel:${p.tel}`} onClick={() => trackEvent(p.clickEvent, "partner_phone")} className="text-sm font-semibold text-blue-700">
                Or call {p.phone}
              </a>
              {p.spanish ? <span className="text-sm text-slate-600">{p.spanish}</span> : null}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              {p.priceNote ? `*${p.priceNote} ` : ""}Crew and year counts are also from {p.name}, an independent company and Contrax's housing referral partner. Bookings and rates are
              between you and them.
            </p>
          </section>
        ) : (
          <section className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm">
            <h2 className="font-bold text-slate-900">Housing, bonding or equipment company in {m.name}?</h2>
            <p className="mt-1 text-slate-700">
              Contractors coming here for federal work need crew housing, bonds and equipment. Become the {networkName(m)} partner for your service.
            </p>
            <a href={marketPitchPath(m)} className="mt-2 inline-block font-semibold text-blue-700">See what a partner gets →</a>
          </section>
        )}

        <p className="mt-8 text-xs text-slate-500">
          Powered by Contrax LLC{p ? ` · Housing referral partner: ${p.name}` : ""} · <a href="/markets" className="hover:underline">Other markets</a>
        </p>
      </main>
    </div>
  );
}
