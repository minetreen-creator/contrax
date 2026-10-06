import { createFileRoute } from "@tanstack/react-router";
import {
  getRegionTradeData,
  OtherTradeLinks,
  RegionTradeView,
  SeoLanding,
  seoHead,
} from "~/lib/seo-landing";
import { radarHrefFor, SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";

// /contracts-in/{state}/{trade} — e.g. /contracts-in/virginia/janitorial.
// The trailing underscore on $state_ keeps this route un-nested, so it renders
// on its own rather than inside the /contracts-in/{state} page.
export const Route = createFileRoute("/contracts-in/$state_/$trade")({
  loader: ({ params }) =>
    getRegionTradeData({ data: { state: params.state, trade: params.trade } }),
  head: ({ loaderData }) => {
    const name = loaderData?.name;
    const label = loaderData?.trade?.label;
    const head = seoHead({
      title:
        name && label
          ? `${label} Government Contracts in ${name} | Contrax`
          : "Government Contracts by State and Trade | Contrax",
      description:
        name && label
          ? `Open ${label.toLowerCase()} government contracts in ${name}, from federal, state and local sources. Real deadlines and links to each official notice, updated every 4 hours on weekdays.`
          : "Open government contracts by state and trade, from federal, state and local sources.",
      canonical: `https://www.contrax.company/contracts-in/${(loaderData?.name ?? loaderData?.stateSlug ?? "").toLowerCase().replace(/\s+/g, "-")}/${loaderData?.trade?.slug ?? ""}`,
    });
    // Unknown combos and pages with no open bids stay out of search results.
    if (!loaderData?.trade || !loaderData?.code || loaderData.count === 0) {
      head.meta = head.meta.map((m) =>
        "name" in m && m.name === "robots" ? { name: "robots", content: "noindex, follow" } : m,
      );
    }
    return head;
  },
  component: ContractsInStateTrade,
});

function ContractsInStateTrade() {
  const data = Route.useLoaderData();
  const trade = data.trade ? SEO_TRADE_BY_SLUG[data.trade.slug] : undefined;
  const name = data.name ?? "your state";
  const label = data.trade?.label ?? "Government";
  const radarHref = trade ? radarHrefFor(trade, data.code) : "/radar";
  return (
    <SeoLanding
      eyebrow={`Live government contracts · ${name}`}
      headline={`${label} contracts in ${name}`}
      subhead={`Open ${label.toLowerCase()} solicitations performed in ${name}, from federal, state and local sources. Real deadlines, each linked to its official notice, updated every 4 hours on weekdays.`}
      radarHref={radarHref}
      radarLabel={`Search ${label.toLowerCase()} contracts in ${name} with Contract Radar`}
      honesty={
        <>
          Every listing is a live open solicitation matched with the same trade search Contract Radar
          uses. Location comes from the notice's place of performance, or the buying agency when none
          is listed. Nothing here is an award or guaranteed work.
        </>
      }
    >
      <RegionTradeView data={data} radarHref={radarHref} />
      {data.code && (
        <OtherTradeLinks stateName={name} currentTrade={data.trade?.slug} />
      )}
    </SeoLanding>
  );
}
