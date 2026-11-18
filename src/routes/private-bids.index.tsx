import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { STATE_NAMES } from "~/lib/contract-map";
import { PRIVATE_BIDS_DISCLAIMER, publishedPrivateBids } from "~/lib/private-bids";

/** /private-bids — private businesses taking bids, listed with their permission (see ~/lib/private-bids). */
const PROD_URL = "https://www.contrax.company";
const TITLE = "Private Bid Requests: Businesses Taking Bids From Contractors | Contrax";
const DESC = "Private businesses taking bids for work on their own property, listed with the owner's permission. Free to list, free to answer.";

export const Route = createFileRoute("/private-bids/")({
  loader: () => publishedPrivateBids(),
  head: ({ loaderData }) => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      // Nothing to index until a request is published.
      { name: "robots", content: loaderData && loaderData.length > 0 ? "index, follow" : "noindex, follow" },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/private-bids` }],
  }),
  component: PrivateBidsPage,
});

function PrivateBidsPage() {
  const requests = Route.useLoaderData();
  return (
    <>
      <SiteHeader />
      <main className="bg-white px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-extrabold text-slate-900">Private bid requests</h1>
          <p className="mt-2 text-slate-600">Businesses taking bids for work on their own property, listed with the owner's permission.</p>
          {requests.length === 0 ? (
            <p className="mt-8 rounded-xl border border-slate-200 p-5 text-sm text-slate-700">No requests are open right now.</p>
          ) : (
            <ul className="mt-8 space-y-3">
              {requests.map((r) => (
                <li key={r.slug} className="rounded-xl border border-slate-200 p-5">
                  <a href={`/private-bids/${r.slug}`} className="text-lg font-bold text-slate-900 underline-offset-4 hover:underline">{r.title}</a>
                  <p className="mt-1 text-sm text-slate-600">
                    {r.buyer} · {r.trade} · {r.states.map((s) => STATE_NAMES[s] ?? s).join(" and ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-8 text-sm text-slate-700">
            Taking bids for work at your business?{" "}
            <a href="mailto:contrax.companyllc@gmail.com?subject=List%20my%20bid%20request" className="font-semibold text-blue-700 underline underline-offset-4">Email us and we will list it for free</a>.
          </p>
          <p className="mt-4 text-xs text-slate-500">{PRIVATE_BIDS_DISCLAIMER.replace("this request", "these requests")}</p>
        </div>
      </main>
    </>
  );
}
