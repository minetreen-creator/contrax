import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding, seoHead } from "~/lib/seo-landing";
import { AgencyView, getAgencyData } from "~/lib/local-landing";

// /agency/{slug} — e.g. /agency/city-of-dallas. Open bids from one local buyer.
export const Route = createFileRoute("/agency/$agency")({
  loader: ({ params }) => getAgencyData({ data: { slug: params.agency } }),
  head: ({ loaderData }) => {
    const a = loaderData?.agency;
    const head = seoHead({
      title: a ? `${a.name} Bids and RFPs (${a.stateCode}) | Contrax` : "Agency Bids | Contrax",
      description: a
        ? `Open bids, RFPs and RFQs from ${a.name}, ${a.stateName}. Real deadlines, each linked to the official notice, updated every 4 hours on weekdays.`
        : "Open government bids by agency, straight from each buyer's own bid board.",
      canonical: a ? `https://www.contrax.company/agency/${a.slug}` : "https://www.contrax.company/local-bids",
    });
    if (!a || loaderData!.count === 0) {
      head.meta = head.meta.map((m) => ("name" in m && m.name === "robots" ? { name: "robots", content: "noindex, follow" } : m));
    }
    return head;
  },
  component: AgencyPage,
});

function AgencyPage() {
  const data = Route.useLoaderData();
  const a = data.agency;
  return (
    <SeoLanding
      eyebrow={a ? `Live bids · ${a.place}, ${a.stateName}` : "Live agency bids"}
      headline={a ? `${a.name} bids and RFPs` : "Agency bids"}
      subhead={`Open solicitations from ${a?.name ?? "this agency"}, read straight from its own bid board. Real deadlines, updated every 4 hours on weekdays.`}
      radarHref={a ? `/radar?state=${a.stateCode}` : "/radar"}
      radarLabel={`Search all bids in ${a?.stateName ?? "your state"} with Contract Radar`}
      honesty={
        <>
          Every listing comes from {a?.name ?? "the agency"}'s own bid board, and the count is a live
          query of open solicitations. Nothing here is an award or guaranteed work. Always confirm
          details on the official notice.
        </>
      }
    >
      <AgencyView data={data} />
    </SeoLanding>
  );
}
