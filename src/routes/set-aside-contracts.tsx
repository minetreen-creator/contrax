import { createFileRoute } from "@tanstack/react-router";
import {
  AllRegionLinks,
  BidCard,
  getCertHubData,
  getSetAsideIndex,
  SeoLanding,
  seoHead,
  SetAsideIndexView,
} from "~/lib/seo-landing";

export const Route = createFileRoute("/set-aside-contracts")({
  loader: async () => {
    const [index, sb] = await Promise.all([
      getSetAsideIndex(),
      getCertHubData({ data: { slug: "sb" } }),
    ]);
    return { index, sb };
  },
  head: () =>
    seoHead({
      title: "Set-Aside Contracts: 8(a), SDVOSB, WOSB, HUBZone | Contrax",
      description:
        "Browse every open federal set-aside contract by certification — 8(a), SDVOSB, WOSB, HUBZone and small business — with real live open counts from federal procurement sources.",
      canonical: "https://www.contrax.company/set-aside-contracts",
    }),
  component: SetAsideContractsIndex,
});

function SetAsideContractsIndex() {
  const d = Route.useLoaderData();
  return (
    <SeoLanding
      eyebrow="⚡ FEDERAL SET-ASIDE CONTRACTS"
      headline="Set-aside contracts, by certification"
      subhead="Government set-asides reserve contracts for 8(a), SDVOSB, WOSB, HUBZone and other small-business firms. Pick your certification to see the real open solicitations."
      radarHref="/radar?cert=sb"
      radarLabel="Or explore live set-aside bids free with Contract Radar"
      honesty={
        <>
          Every count below is a live query of open (due in the future) set-aside
          solicitations, deduplicated and excluding low-content listings — updated every
          4 hours. Nothing here is fabricated.
        </>
      }
    >
      <SetAsideIndexView counts={d.index.counts} />
      <AllRegionLinks />
      {/* Representative real set-aside rows so the index carries genuine content */}
      {d.sb.bids.length > 0 && (
        <>
          <h3 className="mt-12 text-2xl font-bold text-slate-900">
            Set-aside solicitations open now
          </h3>
          <p className="mt-2 text-slate-600">
            A sample of the {d.sb.count.toLocaleString("en-US")} open set-aside rows —
            all real, sourced from live procurement data.
          </p>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {d.sb.bids.map((b) => (
              <BidCard key={b.id} b={b} />
            ))}
          </ul>
        </>
      )}
    </SeoLanding>
  );
}
