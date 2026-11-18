import { createFileRoute, notFound } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { STATE_NAMES } from "~/lib/contract-map";
import { trackEvent } from "~/lib/track";
import { PRIVATE_BIDS_DISCLAIMER, privateBidBySlug, privateBidPublished } from "~/lib/private-bids";

/** /private-bids/<slug> — one private bid request (see ~/lib/private-bids). Indexed only once the owner confirms how to bid. */
const PROD_URL = "https://www.contrax.company";

export const Route = createFileRoute("/private-bids/$slug")({
  loader: ({ params }) => {
    const request = privateBidBySlug(params.slug);
    if (!request) throw notFound();
    return request;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ name: "robots", content: "noindex, follow" }] };
    const title = `${loaderData.title}: ${loaderData.buyer} is taking bids | Contrax`;
    const desc = `${loaderData.buyer} is taking bids for ${loaderData.trade.toLowerCase()} at ${loaderData.locations.length} locations in ${loaderData.states.map((s) => STATE_NAMES[s] ?? s).join(" and ")}.`;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { name: "robots", content: privateBidPublished(loaderData) ? "index, follow" : "noindex, follow" },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:url", content: `${PROD_URL}/private-bids/${loaderData.slug}` },
      ],
      links: [{ rel: "canonical", href: `${PROD_URL}/private-bids/${loaderData.slug}` }],
    };
  },
  component: PrivateBidPage,
});

function PrivateBidPage() {
  const r = Route.useLoaderData();
  const states = r.states.map((s) => STATE_NAMES[s] ?? s).join(" and ");
  return (
    <>
      <SiteHeader />
      <main className="bg-white">
        <section className="bg-slate-950 px-4 py-12 text-white sm:py-16">
          <div className="mx-auto max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400">Private bid request · {states}</p>
            <h1 className="mt-3 text-3xl font-extrabold leading-tight sm:text-4xl">{r.title}</h1>
            <p className="mt-3 text-lg text-slate-200">{r.buyer} is taking bids.</p>
            <dl className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                ["Trade", r.trade],
                ["Locations", `${r.locations.length} in ${states}`],
                ["Bids due", r.deadline ? new Date(r.deadline).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "No date given"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <dt className="text-xs text-slate-400">{k}</dt>
                  <dd className="mt-1 font-bold">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
        <section className="px-4 py-10">
          <div className="mx-auto grid max-w-3xl gap-8 sm:grid-cols-2">
            <div>
              <h2 className="text-lg font-bold text-slate-900">What they need</h2>
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {r.scope.map((line) => (
                  <li key={line}>✓ {line}</li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Locations</h2>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-700">
                {r.locations.map((place) => (
                  <li key={place}>📍 {place}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mx-auto mt-8 max-w-3xl rounded-2xl border-2 border-amber-500 bg-amber-50 p-6">
            <h2 className="text-lg font-bold text-slate-900">How to send a bid</h2>
            {r.contact ? (
              <>
                <p className="mt-2 text-sm text-slate-700">
                  Email your bid and company information to{" "}
                  <a href={`mailto:${r.contact.email}?subject=${encodeURIComponent(`Bid: ${r.title}`)}`} onClick={() => trackEvent("private_bid_contact_click", r.slug)} className="font-bold text-blue-700 underline underline-offset-4">
                    {r.contact.email}
                  </a>
                  .
                </p>
                {r.contact.note && <p className="mt-2 text-sm text-slate-700">{r.contact.note}</p>}
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-700">We are confirming with the owner where bids should go. Check back shortly.</p>
            )}
          </div>
          <p className="mx-auto mt-6 max-w-3xl text-xs text-slate-500">
            {r.permission} {PRIVATE_BIDS_DISCLAIMER}
          </p>
        </section>
      </main>
    </>
  );
}
