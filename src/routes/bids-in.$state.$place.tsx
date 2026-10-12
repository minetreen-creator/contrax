import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding, seoHead } from "~/lib/seo-landing";
import { PlaceView, getPlaceData } from "~/lib/local-landing";

// /bids-in/{state}/{place} — e.g. /bids-in/texas/dallas. Open bids from the
// local buyers we read directly in that city or county (src/lib/local-agencies.ts).
export const Route = createFileRoute("/bids-in/$state/$place")({
  loader: ({ params }) => getPlaceData({ data: { state: params.state, place: params.place } }),
  head: ({ loaderData }) => {
    const p = loaderData?.place;
    const head = seoHead({
      title: p ? `${p.name}, ${p.stateCode} Government Bids and RFPs | Contrax` : "Local Government Bids | Contrax",
      description: p
        ? `Open bids, RFPs and RFQs from ${loaderData!.agencies.map((a) => a.name).join(", ")}. Real deadlines, each linked to the official notice, updated every 4 hours on weekdays.`
        : "Open city and county government bids, straight from each buyer's own bid board.",
      canonical: p ? `https://www.contrax.company/bids-in/${p.stateSlug}/${p.slug}` : "https://www.contrax.company/local-bids",
    });
    if (!p || loaderData!.count === 0) {
      head.meta = head.meta.map((m) => ("name" in m && m.name === "robots" ? { name: "robots", content: "noindex, follow" } : m));
    }
    return head;
  },
  component: BidsInPlace,
});

function BidsInPlace() {
  const data = Route.useLoaderData();
  const name = data.place ? `${data.place.name}, ${data.place.stateName}` : "this place";
  return (
    <SeoLanding
      eyebrow={`Live local bids · ${name}`}
      headline={`Government bids in ${name}`}
      subhead={`Open bids, RFPs and RFQs from ${data.place?.name ?? "local"} buyers, read straight from their own bid boards. Real deadlines, updated every 4 hours on weekdays.`}
      radarHref={data.place ? `/radar?state=${data.place.stateCode}` : "/radar"}
      radarLabel={`Search all bids in ${data.place?.stateName ?? "your state"} with Contract Radar`}
      honesty={
        <>
          Every listing comes from the buyer's own bid board, and the count is a live query of open
          solicitations. Nothing here is an award or guaranteed work. Always confirm details on the
          official notice.
        </>
      }
    >
      <PlaceView data={data} />
    </SeoLanding>
  );
}
