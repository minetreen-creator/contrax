import { createFileRoute } from "@tanstack/react-router";
import { OpenToAllBids } from "~/components/OpenToAllBids";
import {
  getRegionTradeData,
  OtherTradeLinks,
  regionBreadcrumbLd,
  regionTradeIndexable,
  RegionTradeView,
  SeoLanding,
  seoHead,
} from "~/lib/seo-landing";
import { radarHrefFor, SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { FederalTradeFacts } from "~/components/FederalTradeFacts";
import { findSubsPath, tradeWords } from "~/lib/sub-finder";

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
    // Unknown combos, and pages with no open bids (in the state or nationwide) and no federal
    // facts, stay out of search results (src/lib/seo-landing.tsx regionTradeIndexable).
    if (!regionTradeIndexable(loaderData)) {
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
  // Owner 2026-11-03 ("do 2 and 3"): speak the trade's own words (a lawn crew
  // says mowing) and lead with what is open now and what comes next.
  const spoken = data.trade?.slug === "landscaping" ? "mowing & landscaping" : label.toLowerCase();
  return (
    <SeoLanding
      eyebrow={`Live government bids · ${name}`}
      headline={`${name} ${spoken} bids`}
      subhead={
        data.count === 0 && data.nationwideCount > 0
          ? `None posted in ${name} today, and ${data.nationwideCount.toLocaleString("en-US")} nationwide ${data.nationwideCount === 1 ? "one" : "ones"} open to ${name} businesses. New bids every weekday morning from cities, counties, school districts, the state and federal agencies.`
          : `${data.count > 0 ? `${data.count.toLocaleString("en-US")} open now` : "New bids post every week"} from cities, counties, school districts, the state and federal agencies in ${name}. New ones every weekday morning.`
      }
      radarHref={radarHref}
      signupState={data.code}
      radarLabel={`Search ${label.toLowerCase()} contracts in ${name} with Contract Radar`}
      honesty={
        <>
          Every listing is a live open solicitation matched with the same trade search Contract Radar
          uses. Location comes from the notice's place of performance, or the buying agency when none
          is listed. Nothing here is an award or guaranteed work.
        </>
      }
    >
      {data.name && data.trade && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(regionBreadcrumbLd(data.name, { slug: data.trade.slug, label: data.trade.label })) }} />
      )}
      <RegionTradeView data={data} radarHref={radarHref} />
      {data.code && data.trade && (
        // Loaded after the page renders, so the page itself stays fast (owner 2026-11-09).
        <OpenToAllBids trade={data.trade.radarTerm} state={data.code} where="state_page" tone="light" />
      )}
      {data.code && data.trade && (
        <FederalTradeFacts
          data={data.federal}
          tradeSlug={data.trade.slug}
          tradeLabel={data.trade.label}
          stateCode={data.code}
          stateName={name}
        />
      )}
      {data.code && data.trade && (
        // Owner 2026-11-09: primes bidding these jobs can find local subs here.
        <p className="mx-auto mt-6 max-w-3xl px-4 text-sm text-slate-700">
          Bidding one of these as the prime?{" "}
          <a href={findSubsPath(name, data.trade.slug)} className="font-semibold text-blue-700 hover:underline">
            Find {tradeWords(data.trade.label)} subcontractors in {name} →
          </a>
        </p>
      )}
      {data.code && (
        <OtherTradeLinks stateName={name} currentTrade={data.trade?.slug} />
      )}
    </SeoLanding>
  );
}
