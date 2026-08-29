import { createFileRoute } from "@tanstack/react-router";
import {
  CertHubView,
  getCertHubData,
  SeoLanding,
  seoHead,
} from "~/lib/seo-landing";

export const Route = createFileRoute("/hubzone-contracts")({
  loader: () => getCertHubData({ data: { slug: "hubzone" } }),
  head: () =>
    seoHead({
      title: "HUBZone Contracts & Set-Aside Solicitations Open Now | Contrax",
      description:
        "View live HUBZone set-aside solicitations open now — real counts, titles, agencies, estimated values and close dates from federal procurement sources for businesses in historically underutilized zones.",
      canonical: "https://www.contrax.company/hubzone-contracts",
    }),
  component: HubzoneContractsPage,
});

function HubzoneContractsPage() {
  const data = Route.useLoaderData();
  return (
    <SeoLanding
      eyebrow="⚡ LIVE HUBZONE SET-ASIDE CONTRACTS"
      headline="HUBZone government contracts open now"
      subhead="The HUBZone program helps small businesses in historically underutilized business zones compete for federal contracts. These are the real HUBZone solicitations open this week."
      radarHref="/radar?cert=hubzone"
      radarLabel="Or explore live set-aside bids free with Contract Radar"
      honesty={
        <>
          Real open counts and bid details from live federal procurement data, updated
          every 4 hours. Estimated values are shown exactly as listed — some bids
          don&apos;t disclose one.
        </>
      }
    >
      <CertHubView data={data} />
    </SeoLanding>
  );
}
