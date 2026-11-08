import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { BidAlertCapture } from "~/components/BidAlertCapture";
import { MegaprojectCard } from "~/components/MegaprojectCard";
import { megaMoney, megaStateHref, megaTotals } from "~/lib/megaprojects";
import { getMegaprojectState } from "~/lib/megaprojects-pages";
import { STATE_CODE_TO_NAME } from "~/lib/location-state";
import { stateLandingPath } from "~/lib/bid-seo";
import { seoHead } from "~/lib/seo-landing";

/**
 * /megaprojects-in/{state} — every private megaproject in one state, server-rendered and
 * indexable (owner 2026-11-08). A state with none is noindex and points to the full list.
 */
export const Route = createFileRoute("/megaprojects-in/$state")({
  loader: ({ params }) => getMegaprojectState({ data: { state: params.state } }),
  head: ({ loaderData }) => {
    const code = loaderData?.stateCode ?? null;
    const name = code ? STATE_CODE_TO_NAME[code] ?? code : "this state";
    const n = loaderData?.projects.length ?? 0;
    const money = megaMoney(megaTotals(loaderData?.projects ?? []).amount);
    const head = seoHead({
      title: `Megaprojects hiring subcontractors in ${name} | Contrax`,
      description: n
        ? `${n} big private build${n === 1 ? "" : "s"} in ${name}${money ? ` (${money} announced)` : ""}: plants, fabs and campuses, who's building them, and how local subcontractors and suppliers get on the list.`
        : `Private megaprojects hiring local subcontractors across the U.S.`,
      canonical: code ? `https://www.contrax.company${megaStateHref(code, STATE_CODE_TO_NAME)}` : "https://www.contrax.company/megaprojects",
    });
    if (!n) head.meta = head.meta.map((m) => ("name" in m && m.name === "robots" ? { name: "robots", content: "noindex, follow" } : m));
    return head;
  },
  component: MegaprojectStatePage,
});

function MegaprojectStatePage() {
  const { stateCode, projects } = Route.useLoaderData();
  const name = stateCode ? STATE_CODE_TO_NAME[stateCode] ?? stateCode : null;
  const totals = megaTotals(projects);
  const money = megaMoney(totals.amount);
  const bidsHref = name ? stateLandingPath(name) : null;
  return (
    <div className="min-h-screen bg-slate-50">
      <SiteHeader />
      <section className="bg-gradient-to-b from-[#0a1f44] to-[#123a72] px-4 py-12 text-center text-white">
        <nav className="text-sm text-blue-200">
          <a href="/megaprojects" className="underline">All megaprojects</a>
        </nav>
        <h1 className="mx-auto mt-4 max-w-3xl text-3xl font-extrabold tracking-tight sm:text-4xl">
          {name ? `Megaprojects hiring subcontractors in ${name}` : "State not found"}
        </h1>
        {projects.length ? (
          <div className="mx-auto mt-6 flex max-w-xl flex-wrap justify-center gap-6 text-left">
            <Stat big={String(totals.projects)} label={`project${totals.projects === 1 ? "" : "s"}`} />
            {money ? <Stat big={money} label="announced investment" /> : null}
            {totals.jobs ? <Stat big={totals.jobs.toLocaleString("en-US")} label="promised jobs" /> : null}
          </div>
        ) : null}
      </section>

      <main className="mx-auto max-w-4xl space-y-8 px-4 py-10">
        {projects.length ? (
          <ul className="space-y-4">
            {projects.map((p) => (
              <MegaprojectCard key={p.slug} p={p} />
            ))}
          </ul>
        ) : (
          <p className="rounded-xl bg-white p-4 text-slate-600">
            No megaprojects listed {name ? `in ${name} ` : ""}yet. We add them as they&apos;re announced.{" "}
            <a href="/megaprojects" className="font-semibold text-blue-700 underline">
              See every state →
            </a>
          </p>
        )}

        {stateCode ? (
          <>
            <section className="rounded-2xl bg-[#0a1f44] p-6 text-center text-white">
              <p className="text-lg font-bold">Government bids in {name}, too</p>
              <p className="mt-1 text-sm text-blue-100">Cities, counties and state agencies post new work every week.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                <a href={`/radar?state=${stateCode}`} className="rounded-xl bg-amber-500 px-5 py-2.5 font-bold text-slate-950">
                  Search open bids in {name}
                </a>
                {bidsHref ? (
                  <a href={bidsHref} className="rounded-xl bg-white/10 px-5 py-2.5 font-bold text-white">
                    Government contracts in {name}
                  </a>
                ) : null}
              </div>
            </section>
            <BidAlertCapture
              stateCode={stateCode}
              source="megaprojects_state"
              heading={`Get new ${name} bids by email`}
              note="One confirmation email, then only new bids. Unsubscribe anytime."
              tone="light"
            />
          </>
        ) : null}

        <p className="text-xs text-slate-500">
          Investment and job figures are the companies&apos; own announced numbers, from the source on each card. Contrax isn&apos;t affiliated with these companies.
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
