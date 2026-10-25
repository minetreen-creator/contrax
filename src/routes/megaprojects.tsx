import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { BidAlertCapture } from "~/components/BidAlertCapture";
import { LOCAL_WORK, MEGA_SECTORS, MEGAPROJECTS, megaMoney, megaStateCounts, megaTotals, sortMegaprojects, type Megaproject } from "~/lib/megaprojects";
import { STATE_CODE_TO_NAME } from "~/lib/location-state";
import { trackEvent } from "~/lib/track";

/**
 * /megaprojects — the big private plants going up near you (src/lib/megaprojects.ts).
 * Owner 2026-10-25: chip fabs, factories and pharma campuses hire hundreds of
 * local small businesses; show where they are and how to get on the sub list.
 */
export const Route = createFileRoute("/megaprojects")({
  head: () => {
    const title = "Megaprojects hiring local subcontractors";
    const desc =
      "The biggest new U.S. plants and factories (chip fabs, manufacturing, pharma, defense), where they are, who's building them, and how local small businesses get on the subcontractor list. Free on Contrax.";
    return {
      meta: [
        { title: `${title} | Contrax` },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
      ],
      links: [{ rel: "canonical", href: "https://www.contrax.company/megaprojects" }],
    };
  },
  component: MegaprojectsPage,
});

function checkedLabel(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function MegaprojectsPage() {
  const all = useMemo(() => sortMegaprojects(MEGAPROJECTS), []);
  const [state, setState] = useState("");
  // /megaprojects?state=TX (links from the state pages) opens on that state.
  useEffect(() => {
    const st = new URLSearchParams(window.location.search).get("state")?.toUpperCase() ?? "";
    if (st && all.some((p) => p.state === st)) setState(st);
  }, [all]);
  const states = useMemo(() => megaStateCounts(all), [all]);
  const shown = state ? all.filter((p) => p.state === state) : all;
  const totals = megaTotals(shown);
  const stateName = state ? STATE_CODE_TO_NAME[state] ?? state : "";

  return (
    <div className="min-h-screen bg-slate-50">
      <SiteHeader />
      <section className="bg-gradient-to-b from-[#0a1f44] to-[#123a72] px-4 py-14 text-center text-white">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-amber-400">Megaprojects near you</p>
        <h1 className="mx-auto mt-3 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">Billions in new plants. All of them need local subs.</h1>
        <p className="mx-auto mt-4 max-w-2xl text-blue-100">
          Chip fabs, factories and pharma campuses are going up across the country. They aren&apos;t government bids, but every one hires local small businesses for construction, services and supplies. Here&apos;s where they are, who&apos;s building them, and how to get on the list.
        </p>
        <div className="mx-auto mt-8 flex max-w-xl flex-wrap justify-center gap-6 text-left">
          <Stat big={String(totals.projects)} label={`project${totals.projects === 1 ? "" : "s"}${stateName ? ` in ${stateName}` : ""}`} />
          {totals.amount ? <Stat big={megaMoney(totals.amount) ?? ""} label="announced investment" /> : null}
          {totals.jobs ? <Stat big={totals.jobs.toLocaleString("en-US")} label="promised jobs" /> : null}
        </div>
      </section>

      <main className="mx-auto max-w-4xl space-y-8 px-4 py-10">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="mega-state" className="text-sm font-semibold text-slate-700">
            State
          </label>
          <select
            id="mega-state"
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              trackEvent("megaprojects_state", e.target.value || "all");
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
          <p className="rounded-xl bg-white p-4 text-sm text-slate-600">No megaprojects listed here yet. We add them as they&apos;re announced.</p>
        ) : (
          <ul className="space-y-4">
            {shown.map((p) => (
              <ProjectCard key={p.slug} p={p} />
            ))}
          </ul>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-xl font-extrabold text-slate-900">How to get on a megaproject&apos;s sub list</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-slate-700">
            <li>
              <b>Find the general contractor.</b> Big plants hire one or a few general contractors, and <i>they</i> hire the subs. Where we know who it is, it&apos;s on the card. Otherwise check local news and the county building permits.
            </li>
            <li>
              <b>Get prequalified.</b> Most large contractors have an online subcontractor or supplier registration. Have your insurance, safety record (EMR), licenses and references ready.
            </li>
            <li>
              <b>Call the local economic development office.</b> States and counties often run supplier fairs and keep lists of local vendors for these projects.
            </li>
            <li>
              <b>Have a capability statement.</b> One page on what you do and who you&apos;ve done it for.{" "}
              <a href="/launchpad" className="font-semibold text-blue-700 underline">
                Build yours free in Launchpad
              </a>
              , or ask Max on the homepage to help write it.
            </li>
          </ol>
          <p className="mt-4 text-sm font-semibold text-slate-800">Work sites like these typically buy locally:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {LOCAL_WORK.map((w) => (
              <span key={w} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
                {w}
              </span>
            ))}
          </div>
        </section>

        <BidAlertCapture
          stateCode={state || null}
          source="megaprojects"
          heading={`Get government bids${stateName ? ` in ${stateName}` : " near you"} too`}
          note="Free. One confirmation email, then only new bids. Unsubscribe anytime."
          tone="light"
        />

        <section className="rounded-2xl bg-[#0a1f44] p-6 text-center text-white">
          <p className="text-lg font-bold">Private projects are half the picture</p>
          <p className="mt-1 text-sm text-blue-100">Government buyers post new contracts every day, and big federal primes have to hire small business subs.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <a href={`/radar${state ? `?state=${state}` : ""}`} className="rounded-xl bg-amber-500 px-5 py-2.5 font-bold text-slate-950">
              Search open bids free
            </a>
            <a href="/subcontracts" className="rounded-xl bg-white/10 px-5 py-2.5 font-bold text-white">
              Find federal primes hiring subs
            </a>
          </div>
        </section>
        <p className="text-xs text-slate-500">
          Investment and job figures are the companies&apos; own announced numbers, from the source on each card. Plans change; check the source for the latest. Contrax isn&apos;t affiliated with these companies.
        </p>
      </main>
    </div>
  );
}

function Stat({ big, label }: { big: string; label: string }) {
  return (
    <div>
      <p className="text-3xl font-extrabold text-amber-300">{big}</p>
      <p className="text-sm text-blue-100">{label}</p>
    </div>
  );
}

function ProjectCard({ p }: { p: Megaproject }) {
  const sector = MEGA_SECTORS[p.sector];
  const money = megaMoney(p.amount);
  return (
    <li id={p.slug} className="scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
        {sector.icon} {sector.label} · {p.city}, {STATE_CODE_TO_NAME[p.state] ?? p.state}
      </p>
      <p className="mt-1 text-xl font-extrabold text-slate-900">
        {p.company}: {p.project}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {money ? (
          <span className="font-bold text-emerald-700">
            💰 {money}
            {p.amountNote ? <span className="font-normal text-slate-500"> ({p.amountNote})</span> : null}
          </span>
        ) : null}
        {p.jobs ? (
          <span className="font-bold text-blue-800">
            👷 {p.jobs.toLocaleString("en-US")} jobs
            {p.jobsNote ? <span className="font-normal text-slate-500"> ({p.jobsNote})</span> : null}
          </span>
        ) : null}
        <span className="text-slate-600">🏗️ {p.status}</span>
      </div>
      <p className="mt-3 text-slate-700">{p.summary}</p>
      <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-slate-800">
        <p className="font-bold">How to get on the sub list</p>
        <p className="mt-1">
          {p.generalContractor ? (
            <>
              Built by{" "}
              {p.generalContractor.url ? (
                <a href={p.generalContractor.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline">
                  {p.generalContractor.name}
                </a>
              ) : (
                <b>{p.generalContractor.name}</b>
              )}
              . Register with them as a subcontractor.{" "}
            </>
          ) : (
            <>The general contractor hasn&apos;t been announced publicly; watch local news and county permits. </>
          )}
          {p.supplierUrl ? (
            <a href={p.supplierUrl.url} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("megaprojects_supplier_click", p.slug)} className="font-semibold text-blue-700 underline">
              {p.supplierUrl.label} →
            </a>
          ) : null}
        </p>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Source:{" "}
        <a href={p.source.url} target="_blank" rel="noopener noreferrer" className="underline">
          {p.source.name}
        </a>{" "}
        · checked {checkedLabel(p.checked)}
      </p>
    </li>
  );
}
