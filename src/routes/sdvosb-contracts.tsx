import { createFileRoute } from "@tanstack/react-router";
import {
  CertHubView,
  getCertHubData,
  SeoLanding,
  seoHead,
} from "~/lib/seo-landing";

export const Route = createFileRoute("/sdvosb-contracts")({
  loader: () => getCertHubData({ data: { slug: "sdvosb" } }),
  head: () =>
    seoHead({
      title: "SDVOSB Contracts & Set-Aside Solicitations Open Now | Contrax",
      description:
        "View live SDVOSB (service-disabled veteran-owned small business) set-aside solicitations open now — real counts, titles, agencies, estimated values and close dates from federal procurement sources.",
      canonical: "https://www.contrax.company/sdvosb-contracts",
    }),
  component: SdvosbContractsPage,
});

function SdvosbContractsPage() {
  const data = Route.useLoaderData();
  return (
    <SeoLanding
      eyebrow="⚡ LIVE SDVOSB SET-ASIDE CONTRACTS"
      headline="SDVOSB government contracts open now"
      subhead="Service-disabled veteran-owned small businesses (SDVOSB) can compete for contracts set aside under the VA verified program. These are the real SDVOSB solicitations open this week."
      radarHref="/radar?cert=sdvosb"
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
