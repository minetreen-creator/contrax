import { createFileRoute } from "@tanstack/react-router";
import {
  CertHubView,
  getCertHubData,
  SeoLanding,
  seoHead,
} from "~/lib/seo-landing";

export const Route = createFileRoute("/8a-contracts")({
  loader: () => getCertHubData({ data: { slug: "8a" } }),
  head: () =>
    seoHead({
      title: "8(a) Contracts & Set-Aside Solicitations Open Now | Contrax",
      description:
        "View live 8(a) Business Development set-aside solicitations open now — real counts, titles, agencies, estimated values and close dates straight from federal procurement sources.",
      canonical: "https://www.contrax.company/8a-contracts",
    }),
  component: EightAContractsPage,
});

function EightAContractsPage() {
  const data = Route.useLoaderData();
  return (
    <SeoLanding
      eyebrow="⚡ LIVE 8(a) SET-ASIDE CONTRACTS"
      headline="8(a) government contracts open now"
      subhead="The SBA 8(a) Business Development program reserves federal contracts for certified 8(a) firms. These are the real 8(a) set-aside solicitations open this week."
      radarHref="/radar?cert=8a"
      radarLabel="Or explore live set-aside bids free with Contract Radar"
      honesty={
        <>
          Real open counts and bid details from live federal procurement data, updated
          every 4 hours. Estimated values are shown exactly as listed — some bids don&apos;t
          disclose one.
        </>
      }
    >
      <CertHubView data={data} />
    </SeoLanding>
  );
}
