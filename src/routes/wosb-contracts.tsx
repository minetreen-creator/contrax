import { createFileRoute } from "@tanstack/react-router";
import {
  CertHubView,
  getCertHubData,
  SeoLanding,
  seoHead,
} from "~/lib/seo-landing";

export const Route = createFileRoute("/wosb-contracts")({
  loader: () => getCertHubData({ data: { slug: "wosb" } }),
  head: () =>
    seoHead({
      title: "WOSB & EDWOSB Contracts Open Now | Contrax",
      description:
        "View live WOSB and EDWOSB (women-owned and economically disadvantaged women-owned small business) set-aside solicitations open now — real counts and bid details from federal procurement sources.",
      canonical: "https://www.contrax.company/wosb-contracts",
    }),
  component: WosbContractsPage,
});

function WosbContractsPage() {
  const data = Route.useLoaderData();
  return (
    <SeoLanding
      eyebrow="⚡ LIVE WOSB SET-ASIDE CONTRACTS"
      headline="WOSB & EDWOSB government contracts open now"
      subhead="Women-owned (WOSB) and economically disadvantaged women-owned (EDWOSB) small businesses can compete for set-aside contracts. These are the real WOSB solicitations open this week."
      radarHref="/radar?cert=wosb"
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
