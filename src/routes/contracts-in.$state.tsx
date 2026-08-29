import { createFileRoute } from "@tanstack/react-router";
import {
  AllRegionLinks,
  getRegionData,
  RegionView,
  SeoLanding,
  seoHead,
} from "~/lib/seo-landing";

export const Route = createFileRoute("/contracts-in/$state")({
  loader: ({ params }) => getRegionData({ data: { slug: params.state } }),
  head: ({ loaderData }) =>
    seoHead({
      title: loaderData?.name
        ? `Government Contracts in ${loaderData.name} | Contrax`
        : "Government Contracts by State | Contrax",
      description: loaderData?.name
        ? `View real open federal and state contracts in ${loaderData.name} — total open bids, set-asides, closing-soon deadlines and top agencies, straight from live procurement data.`
        : "Browse real open federal and state contracts by state with Contrax — live counts from federal procurement sources.",
      canonical: `https://www.contrax.company/contracts-in/${(loaderData?.slug ?? "").replace(/\s+/g, "-")}`,
    }),
  component: ContractsInState,
});

function ContractsInState() {
  const data = Route.useLoaderData();
  const name = data.name ?? "this state";
  return (
    <SeoLanding
      eyebrow={`⚡ LIVE GOVCON DATA — ${name.toUpperCase()}`}
      headline={`Government contracts in ${name}`}
      subhead={`Real open federal and state solicitations in ${name}, counted straight from live procurement data and updated every 4 hours. See the totals, set-asides and closing-soon deadlines.`}
      radarHref={data.code ? `/radar?state=${data.code}` : "/radar"}
      radarLabel="Or explore live set-aside bids free with Contract Radar"
      honesty={
        <>
          Every number is a live query of open solicitations, updated every 4 hours.
          Stated values are summed only where a dollar figure is actually listed (the
          “across N of M” denominator makes the limitation transparent). Most set-asides
          are nationwide — region pages show the honest set-aside sub-count and point to
          the map to confirm.
        </>
      }
    >
      <RegionView data={data} />
      <AllRegionLinks />
    </SeoLanding>
  );
}
