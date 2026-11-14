import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { MarketPage } from "~/components/MarketPage";
import { TAMPA_MARKET } from "~/lib/markets";
import { TAMPA_PATH } from "~/lib/tampa";

/**
 * /tampa-contractors — Tampa Contractor Support Network (owner 2026-11-09), the first market on the
 * shared template (owner 2026-11-10, src/lib/markets.ts + src/components/MarketPage.tsx): open Tampa
 * Bay bids (live) and registered subs (registeredSubsInCities, live). The address stays the one in posts
 * and emails.
 */
const getTampa = createServerFn({ method: "GET" }).handler(async () => {
  const { loadMarketData } = await import("~/lib/markets.server");
  return loadMarketData(TAMPA_MARKET);
});

export const Route = createFileRoute("/tampa-contractors")({
  loader: () => getTampa(),
  head: () => ({
    meta: [
      { title: "Tampa Contractor Support Network: Bids and Subcontractors | Contrax" },
      {
        name: "description",
        content: "For contractors working Tampa Bay government jobs: open bids in Hillsborough, Pinellas, Pasco and Hernando, and certified subcontractors.",
      },
    ],
    links: [{ rel: "canonical", href: `https://www.contrax.company${TAMPA_PATH}` }],
  }),
  component: () => <MarketPage market={TAMPA_MARKET} data={Route.useLoaderData()} />,
});
