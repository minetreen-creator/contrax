import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { BidAlertCapture } from "~/components/BidAlertCapture";
import { MegaprojectCard } from "~/components/MegaprojectCard";
import { LOCAL_WORK, megaMoney, megaStateHref, megaprojectDescription, megaprojectHref, megaprojectTitle } from "~/lib/megaprojects";
import { getMegaprojectPage } from "~/lib/megaprojects-pages";
import { STATE_CODE_TO_NAME } from "~/lib/location-state";
import { stateLandingPath } from "~/lib/bid-seo";
import { seoHead } from "~/lib/seo-landing";

/**
 * /megaprojects/{slug} — one private megaproject, server-rendered and indexable (owner
 * 2026-11-08: "Subcontracting Opportunities: [Project Name] in [State]"). Only the sourced
 * facts from public/data/megaprojects.json; nothing is estimated.
 */
export const Route = createFileRoute("/megaprojects_/$slug")({
  loader: ({ params }) => getMegaprojectPage({ data: { slug: params.slug } }),
  head: ({ loaderData }) => {
    const p = loaderData?.project;
    if (!p) {
      const head = seoHead({ title: "Megaproject not found | Contrax", description: "We don't track that project. See every megaproject hiring local subcontractors.", canonical: "https://www.contrax.company/megaprojects" });
      head.meta = head.meta.map((m) => ("name" in m && m.name === "robots" ? { name: "robots", content: "noindex, follow" } : m));
      return head;
    }
    const stateName = STATE_CODE_TO_NAME[p.state] ?? p.state;
    return seoHead({
      title: `${megaprojectTitle(p)} | Contrax`,
      description: megaprojectDescription(p, stateName),
      canonical: `https://www.contrax.company${megaprojectHref(p)}`,
    });
  },
  component: MegaprojectPage,
});

function MegaprojectPage() {
  const { project: p, sameState } = Route.useLoaderData();
  if (!p) {
    return (
      <div className="min-h-screen bg-slate-50">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h1 className="text-3xl font-extrabold text-slate-900">Project not found</h1>
          <p className="mt-3 text-slate-600">We don&apos;t track that project.</p>
          <a href="/megaprojects" className="mt-6 inline-block rounded-xl bg-amber-500 px-5 py-2.5 font-bold text-slate-950">
            See every megaproject →
          </a>
        </main>
      </div>
    );
  }
  const stateName = STATE_CODE_TO_NAME[p.state] ?? p.state;
  const stateHref = megaStateHref(p.state, STATE_CODE_TO_NAME);
  const bidsHref = stateLandingPath(stateName);
  const money = megaMoney(p.amount);
  return (
    <div className="min-h-screen bg-slate-50">
      <SiteHeader />
      <section className="bg-gradient-to-b from-[#0a1f44] to-[#123a72] px-4 py-12 text-white">
        <div className="mx-auto max-w-4xl">
          <nav className="text-sm text-blue-200">
            <a href="/megaprojects" className="underline">Megaprojects</a>
            {stateHref ? (
              <>
                {" › "}
                <a href={stateHref} className="underline">{stateName}</a>
              </>
            ) : null}
          </nav>
          <p className="mt-4 text-sm font-bold uppercase tracking-[0.2em] text-amber-400">Subcontracting opportunities</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
            {p.company} {p.project} in {p.city}, {stateName}
          </h1>
          <p className="mt-4 max-w-2xl text-blue-100">{p.summary}</p>
          <div className="mt-6 flex flex-wrap gap-6">
            {money ? <Stat big={money} label="announced investment" /> : null}
            {p.jobs ? <Stat big={p.jobs.toLocaleString("en-US")} label="promised jobs" /> : null}
            <Stat big={p.generalContractor?.name ?? "Not announced"} label="general contractor" />
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-4xl space-y-8 px-4 py-10">
        <ul>
          <MegaprojectCard p={p} linkTitle={false} />
        </ul>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-xl font-extrabold text-slate-900">
            How to get on the {p.company} {p.city} sub list
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-slate-700">
            <li>
              {p.generalContractor ? (
                <>
                  <b>Contact {p.generalContractor.name}.</b> On a build this size the general contractor hires the subs. Register on their subcontractor or supplier portal.
                </>
              ) : (
                <>
                  <b>Find the general contractor.</b> It hasn&apos;t been announced publicly. Watch local news and {p.city}&apos;s county building permits.
                </>
              )}
            </li>
            {p.supplierUrl ? (
              <li>
                <b>Register as a supplier:</b>{" "}
                <a href={p.supplierUrl.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline">
                  {p.supplierUrl.label}
                </a>
                .
              </li>
            ) : null}
            <li>
              <b>Get prequalified.</b> Have your insurance, safety record (EMR), licenses and references ready.
            </li>
            <li>
              <b>Call the local economic development office.</b> {stateName} and its counties often run supplier fairs and keep vendor lists for projects like this.
            </li>
            <li>
              <b>Have a one-page capability statement.</b>{" "}
              <a href="/launchpad" className="font-semibold text-blue-700 underline">
                Build yours in Launchpad
              </a>
              .
            </li>
          </ol>
          <p className="mt-4 text-sm font-semibold text-slate-800">Work sites like this typically buy locally:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {LOCAL_WORK.map((w) => (
              <span key={w} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
                {w}
              </span>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-[#0a1f44] p-6 text-center text-white">
          <p className="text-lg font-bold">Win government work in {stateName} while this one gets going</p>
          <p className="mt-1 text-sm text-blue-100">Cities, counties and state agencies in {stateName} post new bids every week.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <a href={`/radar?state=${p.state}`} className="rounded-xl bg-amber-500 px-5 py-2.5 font-bold text-slate-950">
              Search open bids in {stateName}
            </a>
            {bidsHref ? (
              <a href={bidsHref} className="rounded-xl bg-white/10 px-5 py-2.5 font-bold text-white">
                Government contracts in {stateName}
              </a>
            ) : null}
          </div>
        </section>

        <BidAlertCapture
          stateCode={p.state}
          source="megaproject_page"
          heading={`Get new ${stateName} bids by email`}
          note="One confirmation email, then only new bids. Unsubscribe anytime."
          tone="light"
        />

        {sameState.length ? (
          <section>
            <h2 className="text-xl font-extrabold text-slate-900">More megaprojects in {stateName}</h2>
            <ul className="mt-3 space-y-2">
              {sameState.slice(0, 8).map((o) => (
                <li key={o.slug}>
                  <a href={megaprojectHref(o)} className="font-semibold text-blue-800 underline">
                    {o.company}: {o.project}
                  </a>
                  <span className="text-sm text-slate-500">
                    {" "}
                    · {o.city}
                    {megaMoney(o.amount) ? ` · ${megaMoney(o.amount)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            {stateHref && sameState.length > 8 ? (
              <a href={stateHref} className="mt-2 inline-block text-sm font-semibold text-blue-800 underline">
                All {sameState.length + 1} in {stateName} →
              </a>
            ) : null}
          </section>
        ) : null}

        <p className="text-xs text-slate-500">
          Investment and job figures are the company&apos;s own announced numbers, from the linked source. Plans change; check the source for the latest. Contrax isn&apos;t affiliated with {p.company}.
        </p>
      </main>
    </div>
  );
}

function Stat({ big, label }: { big: string; label: string }) {
  return (
    <div>
      <p className="text-2xl font-extrabold text-amber-300">{big}</p>
      <p className="text-sm text-blue-100">{label}</p>
    </div>
  );
}
