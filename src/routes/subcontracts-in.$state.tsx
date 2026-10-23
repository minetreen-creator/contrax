import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { BidAlertCapture } from "~/components/BidAlertCapture";
import { getStateSubcontracts, type StateSubcontractsData } from "~/lib/subcontracts/state-data";
import { moneyText, titleCase, WINNER_DAYS, WINNERS_SHOWN } from "~/lib/subcontracts/state-page";
import { trackEvent } from "~/lib/track";

/**
 * /subcontracts-in/:state — one state's subcontracting work: open SBA SUBNet
 * notices there, primes based there that hold federal subcontracting plans, and
 * the biggest recent federal winners there (who to ask about sub work). Owner
 * 2026-10-23: "we need subcontracts for LV".
 */
export const Route = createFileRoute("/subcontracts-in/$state")({
  loader: ({ params }) => getStateSubcontracts({ data: params.state }),
  head: ({ loaderData }) => {
    const d = loaderData as StateSubcontractsData | undefined;
    const name = d?.state?.name;
    const title = name ? `Subcontracting opportunities in ${name}` : "Subcontracting opportunities";
    const desc = name
      ? `Open subcontract notices in ${name}, prime contractors there with federal subcontracting plans, and who just won federal contracts in ${name}. Free on Contrax.`
      : "Subcontracting opportunities by state.";
    return {
      meta: [
        { title: `${title} | Contrax` },
        { name: "description", content: desc },
        ...(d?.state ? [] : [{ name: "robots", content: "noindex" }]),
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
      ],
      links: d?.state ? [{ rel: "canonical", href: `https://www.contrax.company/subcontracts-in/${d.state.slug}` }] : [],
    };
  },
  component: StateSubcontractsPage,
});

function day(d: string | null): string {
  if (!d) return "";
  return new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function StateSubcontractsPage() {
  const d: StateSubcontractsData = Route.useLoaderData();
  if (!d.state) {
    return (
      <div className="min-h-screen bg-slate-50">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h1 className="text-3xl font-extrabold text-slate-900">We don&apos;t know that state</h1>
          <a href="/subcontracts" className="mt-4 inline-block font-semibold text-blue-700 underline">
            See all subcontracting opportunities
          </a>
        </main>
      </div>
    );
  }
  const { name, slug, code } = d.state;
  const notices = d.notices ?? [];
  const winners = d.winners ?? [];
  const primes = d.primes ?? [];
  const isNevada = code === "NV";

  return (
    <div className="min-h-screen bg-slate-50">
      <SiteHeader />
      <section className="bg-gradient-to-b from-[#0a1f44] to-[#123a72] px-4 py-14 text-center text-white">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-amber-400">Subcontracting in {name}</p>
        <h1 className="mx-auto mt-3 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">
          Get hired by the companies winning government work{isNevada ? " in Las Vegas and across Nevada" : ` in ${name}`}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-blue-100">
          Big prime contractors have to hire small businesses as subcontractors. Here&apos;s who is hiring, who just won, and who to call.
        </p>
        <div className="mx-auto mt-6 flex max-w-2xl flex-wrap justify-center gap-2 text-sm font-semibold">
          <a href="#notices" className="rounded-full bg-white/10 px-4 py-2">📣 {notices.length} open subcontract notice{notices.length === 1 ? "" : "s"}</a>
          <a href="#winners" className="rounded-full bg-white/10 px-4 py-2">🏆 {d.winnersTotal} recent winner{d.winnersTotal === 1 ? "" : "s"}</a>
          <a href="#primes" className="rounded-full bg-white/10 px-4 py-2">🏢 {d.primesTotal} prime{d.primesTotal === 1 ? "" : "s"} with sub plans</a>
        </div>
      </section>

      <main className="mx-auto max-w-4xl space-y-10 px-4 py-10">
        <section id="notices">
          <h2 className="text-2xl font-extrabold text-slate-900">📣 Primes asking for subcontractors now</h2>
          <p className="mt-1 text-sm text-slate-600">Open notices on the SBA&apos;s SUBNet board where the work is in {name}.</p>
          {d.notices === null ? (
            <p className="mt-4 rounded-xl bg-white p-4 text-sm text-slate-600">The notice board couldn&apos;t be read just now. <a href="/subcontracts" className="font-semibold text-blue-700 underline">See all notices</a>.</p>
          ) : notices.length === 0 ? (
            <p className="mt-4 rounded-xl bg-white p-4 text-sm text-slate-600">
              None open in {name} right now. New ones post every week; the winners below are the companies to contact in the meantime.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {notices.map((n) => (
                <li key={n.externalId} className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="text-lg font-bold text-slate-900">{n.title}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {n.prime}
                    {n.placeOfPerformance ? ` · ${n.placeOfPerformance}` : ""}
                    {n.closingDateText ? ` · responses due ${n.closingDateText}` : ""}
                  </p>
                  {n.naicsTitle ? <p className="mt-1 text-sm text-slate-500">{n.naicsTitle}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
                    <a href={n.detailUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("subcontracts_state_notice_click", code)} className="text-blue-700 underline">
                      Read the notice
                    </a>
                    {n.contactEmail ? (
                      <a href={`mailto:${n.contactEmail}`} className="text-blue-700 underline">
                        Email {n.contactName ?? "the prime"}
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="winners">
          <h2 className="text-2xl font-extrabold text-slate-900">🏆 Who just won federal work in {name}</h2>
          <p className="mt-1 text-sm text-slate-600">
            The biggest federal contracts in the last {WINNER_DAYS} days performed in {name} or won by a company based there. A company that just won a big contract often needs subcontractors: ask for their small business liaison.
          </p>
          {d.winners === null ? (
            <p className="mt-4 rounded-xl bg-white p-4 text-sm text-slate-600">Recent awards couldn&apos;t be read just now.</p>
          ) : winners.length === 0 ? (
            <p className="mt-4 rounded-xl bg-white p-4 text-sm text-slate-600">No large federal awards in {name} in the last {WINNER_DAYS} days.</p>
          ) : (
            <>
              <ul className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {winners.map((w) => (
                  <li key={w.award_key} className="p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-bold text-slate-900">{titleCase(w.recipient_name)}</p>
                      <p className="text-lg font-extrabold text-emerald-700">{moneyText(w.amount)}</p>
                    </div>
                    <p className="mt-0.5 text-sm text-slate-600">
                      {[w.sub_agency || w.agency, w.recipient_city ? titleCase(w.recipient_city) : null, w.awarded_on ? `awarded ${day(w.awarded_on)}` : null].filter(Boolean).join(" · ")}
                    </p>
                    {w.description ? <p className="mt-1 line-clamp-2 text-sm text-slate-500">{w.description}</p> : null}
                  </li>
                ))}
              </ul>
              {d.winnersTotal > WINNERS_SHOWN ? (
                <p className="mt-3 text-sm text-slate-600">
                  Showing the {WINNERS_SHOWN} biggest of {d.winnersTotal}.{" "}
                  <a href="/leads" onClick={() => trackEvent("subcontracts_state_leads_click", code)} className="font-semibold text-blue-700 underline">
                    Get every new winner, daily, with Award Leads
                  </a>
                </p>
              ) : null}
            </>
          )}
        </section>

        <section id="primes">
          <h2 className="text-2xl font-extrabold text-slate-900">🏢 Primes based in {name} with subcontracting plans</h2>
          <p className="mt-1 text-sm text-slate-600">
            From the SBA&apos;s FY24 directory of federal prime contractors required to keep a small business subcontracting plan.
          </p>
          {d.primes === null ? (
            <p className="mt-4 rounded-xl bg-white p-4 text-sm text-slate-600">The directory couldn&apos;t be read just now.</p>
          ) : primes.length === 0 ? (
            <p className="mt-4 rounded-xl bg-white p-4 text-sm text-slate-600">No primes in the directory are based in {name}.</p>
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {primes.map((p) => (
                <li key={p.uei} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="font-bold text-slate-900">{titleCase(p.legalName)}</p>
                  {p.naicsLabels[0] ? <p className="mt-0.5 text-sm text-slate-600">{p.naicsLabels[0]}</p> : null}
                  {p.agencies.length ? <p className="mt-0.5 text-xs text-slate-500">Works for: {p.agencies.slice(0, 3).map(titleCase).join(", ")}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <BidAlertCapture
          stateCode={code}
          source="subcontracts_state"
          heading={`Get new ${name} government bids in your inbox`}
          note="Free. One confirmation email, then only new bids. Unsubscribe anytime."
          tone="light"
        />

        <section className="rounded-2xl bg-[#0a1f44] p-6 text-center text-white">
          <p className="text-lg font-bold">Rather bid directly?</p>
          <p className="mt-1 text-sm text-blue-100">See the government contracts open in {name} right now.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <a href={`/contracts-in/${slug}`} className="rounded-xl bg-amber-500 px-5 py-2.5 font-bold text-slate-950">
              Open bids in {name}
            </a>
            {isNevada ? (
              <a href="/town/89101" className="rounded-xl bg-white/10 px-5 py-2.5 font-bold text-white">
                What Las Vegas is buying
              </a>
            ) : null}
            <a href="/subcontracts" className="rounded-xl bg-white/10 px-5 py-2.5 font-bold text-white">
              All subcontract notices
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
