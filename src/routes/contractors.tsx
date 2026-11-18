import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { getEverydaySample } from "~/lib/sample-bids";
import { ContractorSections, Footer, getLandingData } from "~/routes/index";

/**
 * /contractors — everything the homepage showed contractors before 2026-11-18 (owner: "do all"),
 * unchanged and in the same order: the two lanes, the search, a real bid preview, Bid Prep, the
 * three steps, the AI assistant's example, the $9 pass and the state map. The homepage now leads
 * with the supplier report and keeps only the search for contractors.
 */
const PROD_URL = "https://www.contrax.company";
const TITLE = "Government Bids for Contractors | Contrax";
const DESC =
  "Win government work two ways: search open bids in your trade and state yourself, or have the bid paperwork prepared for you. Federal, state, city, county and school bids in all 50 states.";

export const Route = createFileRoute("/contractors")({
  loader: async () => {
    const [landing, sample] = await Promise.all([getLandingData(), getEverydaySample()]);
    return { ...landing, sample };
  },
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/contractors` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/contractors` }],
  }),
  component: ContractorsPage,
});

function ContractorsPage() {
  const { sample, contractMap, maxProofCurrent } = Route.useLoaderData();
  return (
    <div className="min-h-screen bg-[#f5f7fa] text-[#0f1f38] dark:bg-[#0b1424] dark:text-[#e7edf7]">
      <SiteHeader />
      <ContractorSections sample={sample} contractMap={contractMap} maxProofCurrent={maxProofCurrent} />
      <Footer />
    </div>
  );
}
