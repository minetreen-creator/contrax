import { createFileRoute, notFound } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { CHECKED, COMPARE_BY_SLUG, COMPARE_TOOLS, CONTRAX_SIDE, compareDescription, compareTitle } from "~/lib/compare-tools";
import { trackEvent } from "~/lib/track";

/** /compare/<tool> — one honest page per self-serve tool (src/lib/compare-tools.ts holds the facts and their sources). */
const PROD_URL = "https://www.contrax.company";

export const Route = createFileRoute("/compare/$tool")({
  loader: ({ params }) => {
    const tool = COMPARE_BY_SLUG[params.tool];
    if (!tool) throw notFound();
    return tool;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Compare | Contrax" }], links: [] };
    const url = `${PROD_URL}/compare/${loaderData.slug}`;
    return {
      meta: [
        { title: compareTitle(loaderData) },
        { name: "description", content: compareDescription(loaderData) },
        { name: "robots", content: "index, follow" },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { property: "og:title", content: compareTitle(loaderData) },
        { property: "og:description", content: compareDescription(loaderData) },
        { property: "og:image", content: `${PROD_URL}/og/general.png` },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: CompareToolPage,
});

const cell = "px-4 py-3 align-top";

function CompareToolPage() {
  const t = Route.useLoaderData();
  return (
    <>
      <SiteHeader />
      <main className="bg-white">
        <section className="bg-slate-950 px-4 py-14 text-white">
          <div className="mx-auto max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400">{t.name} and Contrax</p>
            <h1 className="mt-3 text-3xl font-extrabold leading-tight sm:text-4xl">{t.name} gives you the tool. Contrax hands you the report.</h1>
            <p className="mt-4 max-w-2xl text-slate-300">
              {t.what} You run it. Contrax can do the same digging for you and send one document: the government contracts ending in your
              trade and state, who holds them, and the open bids that fit.
            </p>
            {/* Owner 2026-11-14: the not-affiliated line sits under the headline, not only at the foot of the page. */}
            <p className="mt-3 text-xs text-slate-400">
              {t.name} is a trademark of its owner. Contrax is not affiliated with or endorsed by {t.name}.
            </p>
            <a
              href="/sample-report"
              onClick={() => trackEvent("compare_tool_click", `${t.slug}_sample`)}
              className="mt-6 inline-block rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400"
            >
              Read a real sample report →
            </a>
          </div>
        </section>

        <section className="mx-auto grid max-w-4xl gap-6 px-4 py-12 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 p-6">
            <h2 className="text-lg font-bold text-slate-900">{t.name}</h2>
            <table className="mt-3 w-full text-sm text-slate-700">
              <tbody>
                {t.facts.map((f) => (
                  <tr key={f.label} className="border-t border-slate-100">
                    <th scope="row" className={`${cell} w-2/5 pl-0 text-left font-semibold text-slate-900`}>{f.label}</th>
                    <td className={cell}>{f.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-slate-600">
              From{" "}
              <a href={t.source.url} target="_blank" rel="noopener noreferrer nofollow" className="text-blue-700 underline hover:text-blue-600">{t.source.label}</a>,
              checked {CHECKED}. Their prices and plans can change; theirs is the page to trust.
            </p>
          </div>
          <div className="rounded-2xl border-2 border-slate-900 p-6">
            <h2 className="text-lg font-bold text-slate-900">Contrax</h2>
            <table className="mt-3 w-full text-sm text-slate-700">
              <tbody>
                {CONTRAX_SIDE.map((f) => (
                  <tr key={f.label} className="border-t border-slate-100">
                    <th scope="row" className={`${cell} w-2/5 pl-0 text-left font-semibold text-slate-900`}>{f.label}</th>
                    <td className={cell}>{f.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-slate-50 px-4 py-12">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-xl font-bold text-slate-900">Which one should you choose?</h2>
            <p className="mt-3 text-sm text-slate-700"><strong>Choose {t.name}</strong> if {t.betterWhen}</p>
            <p className="mt-3 text-sm text-slate-700">
              <strong>Choose Contrax</strong> if nobody on your team has the hours to search, and you would rather read one report than learn another
              tool. You can also use both: their software for the people who dig, our report for the people who decide.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <a
                href="/teams#done-for-you"
                onClick={() => trackEvent("compare_tool_click", `${t.slug}_order`)}
                className="inline-block rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800"
              >
                See the done-for-you reports →
              </a>
              <a href="/compare" className="text-sm font-semibold text-blue-700 hover:text-blue-600">Compare more options</a>
            </div>
            <p className="mt-8 text-xs text-slate-600">
              Other comparisons:{" "}
              {COMPARE_TOOLS.filter((o) => o.slug !== t.slug).map((o, i) => (
                <span key={o.slug}>{i > 0 ? ", " : ""}<a href={`/compare/${o.slug}`} className="text-blue-700 underline hover:text-blue-600">{o.name}</a></span>
              ))}
              .
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
