import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteHeader } from "~/components/SiteHeader";
import { CASA, TAMPA_PATH, TAMPA_PLACES, isBuildWork, isTampaBay } from "~/lib/tampa";
import { radarHrefFor, SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { trackEvent } from "~/lib/track";

/**
 * /tampa-contractors — Tampa Contractor Support Network (owner 2026-11-09): find the work (open
 * Tampa Bay bids, live), build the team (Sub Finder), house the crew (Casa Blue Collar, housing
 * referral partner, 90-day trial). Contrax contacts no one; contractors who visit choose.
 */
interface TampaBid {
  id: number;
  title: string;
  agency: string;
  due: string | null;
}

let cache: { at: number; data: { open: number; build: number; bids: TampaBid[] } } | null = null;

const getTampa = createServerFn({ method: "GET" }).handler(async () => {
  if (cache && Date.now() - cache.at < 30 * 60 * 1000) return cache.data;
  try {
    const { sql } = await import("~/db");
    const { LOW_CONTENT_SQL } = await import("~/lib/low-content");
    const { AWARD_EXCLUSION_SQL } = await import("~/lib/source-class");
    const s = sql();
    const like = TAMPA_PLACES.map((p) => `%${p}%`);
    const rows = (await s`
      SELECT id, title, agency, location, due_date FROM bids
      WHERE due_date > NOW()
        AND ${s.unsafe(LOW_CONTENT_SQL)}
        AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
        AND (LOWER(COALESCE(location,'')) LIKE ANY(${like}) OR LOWER(COALESCE(agency,'')) LIKE ANY(${like}))
      ORDER BY due_date ASC
      LIMIT 2000
    `) as { id: number; title: string; agency: string | null; location: string | null; due_date: string | Date | null }[];
    const here = rows.filter((r) => isTampaBay(r.location, r.agency));
    const build = here.filter((r) => isBuildWork(r.title));
    const data = {
      open: here.length,
      build: build.length,
      bids: build.slice(0, 10).map((r) => ({
        id: Number(r.id),
        title: r.title,
        agency: r.agency ?? "",
        due: r.due_date ? new Date(r.due_date).toISOString().slice(0, 10) : null,
      })),
    };
    cache = { at: Date.now(), data };
    return data;
  } catch (e) {
    console.error("[tampa-contractors] load failed:", e);
    return { open: 0, build: 0, bids: [] as TampaBid[] };
  }
});

export const Route = createFileRoute("/tampa-contractors")({
  loader: () => getTampa(),
  head: () => ({
    meta: [
      { title: "Tampa Contractor Support Network: Bids, Subcontractors and Crew Housing | Contrax" },
      {
        name: "description",
        content: "For contractors working Tampa Bay government jobs: open bids in Hillsborough, Pinellas, Pasco and Hernando, certified subcontractors, and housing for traveling crews.",
      },
    ],
    links: [{ rel: "canonical", href: `https://www.contrax.company${TAMPA_PATH}` }],
  }),
  component: TampaPage,
});

const fmtDue = (d: string | null) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;

function TampaPage() {
  const d = Route.useLoaderData();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Tampa Contractor Support Network</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900 sm:text-4xl">Find the work. Build the team. House the crew.</h1>
        <p className="mt-2 max-w-3xl text-slate-700">
          For contractors working government jobs in Tampa Bay (Hillsborough, Pinellas, Pasco and Hernando): open bids, certified subcontractors, and housing for traveling crews.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <a href="#work" className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-blue-400">
            <p className="text-2xl font-bold text-slate-900">{d.build > 0 ? d.build : "Live"}</p>
            <p className="text-sm text-slate-700">{d.build > 0 ? "open construction and facility bids in Tampa Bay" : "Tampa Bay government bids"}</p>
          </a>
          <a href="#team" className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-blue-400">
            <p className="text-2xl font-bold text-slate-900">Sub Finder</p>
            <p className="text-sm text-slate-700">Find certified local subs and collect their quotes</p>
          </a>
          <a href="#housing" className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-blue-400">
            <p className="text-2xl font-bold text-slate-900">Crew housing</p>
            <p className="text-sm text-slate-700">Housing for traveling project teams, through our referral partner</p>
          </a>
        </div>

        <section id="work" className="mt-8 scroll-mt-20">
          <h2 className="text-xl font-bold text-slate-900">1. Find the work</h2>
          <p className="mt-1 text-sm text-slate-600">
            {d.open > 0 ? `${d.open} open government bids in Tampa Bay right now; the soonest construction and facility jobs are below.` : "Open government bids in Tampa Bay, updated every weekday."}
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
          <a href={radarHrefFor(SEO_TRADE_BY_SLUG.construction, "FL")} className="mt-3 inline-block font-semibold text-blue-700">Search Florida construction bids with Contract Radar →</a>
        </section>

        <section id="team" className="mt-8 scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-xl font-bold text-slate-900">2. Build the team</h2>
          <p className="mt-1 text-sm text-slate-700">
            Bidding as the prime? Sub Finder shows local subs who listed their business for primes, by trade and certification. Send a Trade Package with your scope and deadline and
            their quotes come to your inbox.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
            <a href="/sub-finder?state=FL" className="rounded-lg bg-slate-900 px-4 py-2 text-white">Open Sub Finder</a>
            <a href="/find-subcontractors/florida/hvac" className="rounded-lg border border-slate-300 px-4 py-2 text-slate-800">HVAC and plumbing subs</a>
            <a href="/find-subcontractors/florida/electrical" className="rounded-lg border border-slate-300 px-4 py-2 text-slate-800">Electrical subs</a>
            <a href="/find-subcontractors/florida/construction" className="rounded-lg border border-slate-300 px-4 py-2 text-slate-800">Construction subs</a>
          </div>
          <p className="mt-3 text-sm text-slate-700">
            A Tampa sub? <a href="/sub-finder#listing" className="font-semibold text-blue-700">List your business for primes →</a>
          </p>
        </section>

        <section id="housing" className="mt-8 scroll-mt-20 rounded-2xl border-2 border-slate-900 bg-white p-5">
          <h2 className="text-xl font-bold text-slate-900">3. House the crew</h2>
          <p className="mt-1 text-sm text-slate-700">
            Bringing a crew into Tampa for a project? Our housing referral partner, {CASA.name}, provides housing for traveling work crews. Ask them about availability, rates and
            locations near your job site, and book with them directly.
          </p>
          <a
            href={CASA.url}
            target="_blank"
            rel="sponsored noopener"
            onClick={() => trackEvent("tampa_housing_referral_click", "casa_blue_collar")}
            className="mt-3 inline-block rounded-lg bg-slate-900 px-4 py-2.5 font-semibold text-white"
          >
            Ask {CASA.name} about crew housing →
          </a>
          <p className="mt-2 text-xs text-slate-500">{CASA.name} is an independent company and Contrax's housing referral partner. Bookings and rates are between you and them.</p>
        </section>

        <p className="mt-8 text-xs text-slate-500">Powered by Contrax LLC · Housing referral partner: {CASA.name}</p>
      </main>
    </>
  );
}
