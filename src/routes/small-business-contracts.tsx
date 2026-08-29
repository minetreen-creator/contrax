import { createFileRoute } from "@tanstack/react-router";
import {
  CertHubView,
  getCertHubData,
  SeoLanding,
  seoHead,
} from "~/lib/seo-landing";

export const Route = createFileRoute("/small-business-contracts")({
  loader: () => getCertHubData({ data: { slug: "sb" } }),
  head: () =>
    seoHead({
      title: "Small Business Set-Aside Contracts Open Now | Contrax",
      description:
        "View every open federal small-business set-aside — 8(a), SDVOSB, WOSB, HUBZone and more — with real counts, titles, agencies, estimated values and close dates from federal procurement sources.",
      canonical: "https://www.contrax.company/small-business-contracts",
    }),
  component: SmallBusinessContractsPage,
});

function SmallBusinessContractsPage() {
  const data = Route.useLoaderData();
  return (
    <SeoLanding
      eyebrow="⚡ LIVE SET-ASIDE CONTRACTS FOR SMALL BUSINESSES"
      headline="Small business set-aside contracts open now"
      subhead="Every federal small-business set-aside — 8(a), SDVOSB, WOSB and HUBZone — in one place. A federal set-aside is by definition reserved for small business. These are the real solicitations open this week."
      radarHref="/radar?cert=sb"
      radarLabel="Or explore live set-aside bids free with Contract Radar"
      honesty={
        <>
          Real open counts and bid details from live federal procurement data, updated
          every 4 hours. “Small Business” counts every set-aside competition; restricted
          full-and-open rows are not included here. Estimated values shown as listed.
        </>
      }
    >
      <CertHubView data={data} />
    </SeoLanding>
  );
}
