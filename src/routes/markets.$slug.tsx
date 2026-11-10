import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { MarketPage } from "~/components/MarketPage";
import { SiteHeader } from "~/components/SiteHeader";
import { marketBySlug, networkName } from "~/lib/markets";

/** /markets/{slug} — a Contractor Support Network market on the shared template (owner 2026-11-10). Tampa keeps /tampa-contractors. */
const getMarket = createServerFn({ method: "GET" })
  .validator((d: unknown) => ({ slug: String((d as { slug?: unknown })?.slug ?? "").toLowerCase().slice(0, 40) }))
  .handler(async ({ data }) => {
    const m = marketBySlug(data.slug);
    if (!m) return null;
    const { loadMarketData } = await import("~/lib/markets.server");
    return { slug: m.slug, data: await loadMarketData(m) };
  });

export const Route = createFileRoute("/markets/$slug")({
  beforeLoad: ({ params }) => {
    const m = marketBySlug(params.slug);
    if (m && m.path !== `/markets/${m.slug}`) throw redirect({ href: m.path, statusCode: 301 });
  },
  loader: ({ params }) => getMarket({ data: { slug: params.slug } }),
  head: ({ params }) => {
    const m = marketBySlug(params.slug);
    if (!m) return { meta: [{ title: "Market not found | Contrax" }, { name: "robots", content: "noindex" }] };
    const title = `${networkName(m)}: Government Bids and Subcontractors | Contrax`;
    const desc = `For contractors working government jobs in ${m.name}: open bids, ${m.facts.federalConstruction} in federal construction last year, and certified local subcontractors.`;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
      ],
      links: [{ rel: "canonical", href: `https://www.contrax.company${m.path}` }],
    };
  },
  component: MarketRoute,
});

function MarketRoute() {
  const r = Route.useLoaderData();
  const m = r ? marketBySlug(r.slug) : undefined;
  if (!r || !m) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 [color-scheme:light]">
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-12">
          <h1 className="text-2xl font-bold">We don't have that market yet</h1>
          <a href="/markets" className="mt-3 inline-block font-semibold text-blue-700">See our markets →</a>
        </main>
      </div>
    );
  }
  return <MarketPage market={m} data={r.data} />;
}
