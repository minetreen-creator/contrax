import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding, seoHead } from "~/lib/seo-landing";
import { LocalIndexView, getLocalIndex } from "~/lib/local-landing";

// /local-bids — every city and county whose own bid board we read.
export const Route = createFileRoute("/local-bids")({
  loader: () => getLocalIndex(),
  head: () =>
    seoHead({
      title: "City and County Government Bids | Contrax",
      description:
        "Open bids, RFPs and RFQs from city and county governments, school districts and local agencies, read straight from each buyer's own bid board.",
      canonical: "https://www.contrax.company/local-bids",
    }),
  component: LocalBids,
});

function LocalBids() {
  const places = Route.useLoaderData();
  return (
    <SeoLanding
      eyebrow="Live local bids"
      headline="City and county government bids"
      subhead="Open solicitations from local governments, school districts and agencies, read straight from their own bid boards and updated every 4 hours on weekdays."
      radarHref="/radar"
      radarLabel="Search every bid with Contract Radar"
      honesty={<>Counts are live queries of open solicitations from each buyer's own board.</>}
    >
      <LocalIndexView places={places} />
    </SeoLanding>
  );
}
