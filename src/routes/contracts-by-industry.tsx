import { createFileRoute } from "@tanstack/react-router";
import {
  getIndustryHubData,
  IndustryHubView,
  SeoLanding,
  seoHead,
} from "~/lib/seo-landing";
export const Route = createFileRoute("/contracts-by-industry")({
  loader: () => getIndustryHubData(),
  head: () =>
    seoHead({
      title: "Government Contracts by Industry (NAICS) | Contrax",
      description:
        "Browse open federal set-aside contracts by industry and NAICS code — real live counts for construction, HVAC, engineering, IT and more, straight from live procurement sources.",
      canonical: "https://www.contrax.company/contracts-by-industry",
    }),
  component: ContractsByIndustry,
});
function ContractsByIndustry() {
  const d = Route.useLoaderData();
  return (
    <SeoLanding
      eyebrow="⚡ SET-ASIDE CONTRACTS BY INDUSTRY"
      headline="Government contracts by industry (NAICS)"
      subhead="Open federal set-aside solicitations grouped by NAICS industry, counted straight from live procurement data and updated every 4 hours. See which industries have real set-aside bidding open right now."
      radarHref="/radar"
      radarLabel="Or explore live set-aside bids free with Contract Radar"
      honesty={
        <>
          Every count is a live query of open set-aside solicitations grouped by
          NAICS code, excluding low-content listings and updated every 4 hours. Only
          industries with real open bids appear — nothing is fabricated.
        </>
      }
    >
      <IndustryHubView data={d} />
    </SeoLanding>
  );
}
