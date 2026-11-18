import { publicAgency, publicTitle } from "~/lib/public-bid";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteHeader } from "~/components/SiteHeader";
import { displayTitle } from "~/lib/bid-title";
import { agencyDisplay } from "~/lib/bid-job-summary";
import { dueDayText } from "~/lib/deadline-label";
import { OPEN_BIDS_PAGE_SIZE, OPEN_BIDS_STATES, NATIONWIDE_SLUG, openBidsHref, openBidsPage, openBidsPageCount, openBidsPageLinks, openBidsPlace } from "~/lib/open-bids-list";
import { seoHead } from "~/lib/seo-landing";

interface ListBid { id: number; title: string; agency: string | null; due_date: string | null }

/**
 * /open-bids/<state>?page=N — every open bid in one state as plain links, 100 to a page
 * (src/lib/open-bids-list.ts). Same filters as the bid sitemap: open, not low-content, not an award
 * row, one page per notice. The list is for finding a bid and for search engines to follow.
 */
const getOpenBids = createServerFn({ method: "GET" })
  .validator((d: unknown) => ({ slug: String((d as { slug?: unknown })?.slug ?? ""), page: openBidsPage((d as { page?: unknown })?.page) }))
  .handler(async ({ data }): Promise<{ place: ReturnType<typeof openBidsPlace>; total: number; page: number; bids: ListBid[] }> => {
    const place = openBidsPlace(data.slug);
    if (!place) return { place: null, total: 0, page: 1, bids: [] };
    try {
      const { sql } = await import("~/db");
      const { LOW_CONTENT_SQL } = await import("~/lib/low-content");
      const { AWARD_EXCLUSION_SQL } = await import("~/lib/source-class");
      const { noticeKeySql } = await import("~/lib/notice-dedupe");
      const s = sql();
      const where = place.code ? s`normalized_state = ${place.code}` : s`normalized_state IS NULL`;
      const rows = (await s`
        WITH open AS (
          SELECT DISTINCT ON (${s.unsafe(noticeKeySql("bids"))}) id, title, agency, due_date
          FROM bids
          WHERE ${where} AND due_date > NOW()
            AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
          ORDER BY ${s.unsafe(noticeKeySql("bids"))}, created_at DESC NULLS LAST
        )
        SELECT id, title, agency, due_date, COUNT(*) OVER ()::int AS total
        FROM open ORDER BY due_date ASC, id ASC
        LIMIT ${OPEN_BIDS_PAGE_SIZE} OFFSET ${(data.page - 1) * OPEN_BIDS_PAGE_SIZE}`) as { id: number; title: string | null; agency: string | null; due_date: string | Date | null; total: number }[];
      return {
        place,
        total: rows[0]?.total ?? 0,
        page: data.page,
        // Owner 2026-11-18 ("no more freebies"): the buyer is described, not named (src/lib/public-bid.ts).
        bids: rows.map((r) => ({ id: Number(r.id), title: publicTitle(String(r.title ?? ""), r.agency ? String(r.agency) : null), agency: publicAgency(r.agency ? String(r.agency) : null, place.code ? place.name : null), due_date: r.due_date ? new Date(r.due_date).toISOString() : null })),
      };
    } catch (e) {
      console.error("[open-bids] list failed:", (e as Error).message);
      return { place, total: 0, page: data.page, bids: [] };
    }
  });

export const Route = createFileRoute("/open-bids/$state")({
  validateSearch: (s: Record<string, unknown>): { page?: number } => (openBidsPage(s.page) > 1 ? { page: openBidsPage(s.page) } : {}),
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  loader: ({ params, deps }) => getOpenBids({ data: { slug: params.state, page: deps.page } }),
  head: ({ loaderData }) => {
    const p = loaderData?.place;
    const where = !p ? "by state" : p.slug === NATIONWIDE_SLUG ? "with no single state" : `in ${p.name}`;
    const pageNote = loaderData && loaderData.page > 1 ? `, page ${loaderData.page}` : "";
    const head = seoHead({
      title: `All open government bids ${where}${pageNote} | Contrax`,
      description: `Every open government bid ${where}: ${loaderData?.total ?? 0} solicitations from federal, state, city, county and school district buyers, each with its buyer and due date.`,
      canonical: `https://www.contrax.company${openBidsHref(p?.slug ?? "", loaderData?.page ?? 1)}`,
    });
    // An unknown state or an empty page has nothing to index.
    if (!p || !loaderData?.bids.length) head.meta = head.meta.map((m) => ("name" in m && m.name === "robots" ? { name: "robots", content: "noindex, follow" } : m));
    return head;
  },
  component: OpenBids,
});

function OpenBids() {
  const { place, total, page, bids } = Route.useLoaderData();
  const pages = openBidsPageCount(total);
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-10">
        {!place ? (
          <h1 className="text-2xl font-bold text-slate-900">Open government bids by state</h1>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
              {place.slug === NATIONWIDE_SLUG ? "Open government bids with no single state" : `All open government bids in ${place.name}`}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {total.toLocaleString("en-US")} open right now, soonest deadline first. Page {page} of {pages}.{" "}
              <a href={place.code ? `/radar?state=${place.code}` : "/radar"} className="font-semibold text-blue-700 underline">Search by trade instead →</a>
            </p>
            <ul className="mt-6 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
              {bids.map((b) => (
                <li key={b.id} className="px-4 py-3">
                  <a href={`/bid/${b.id}`} className="font-semibold text-blue-800 hover:underline">{displayTitle(b.title) || `Bid ${b.id}`}</a>
                  <span className="mt-0.5 block text-xs text-slate-600">
                    {[agencyDisplay(b.agency), b.due_date ? `Due ${dueDayText(b.due_date)}` : null].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
            {bids.length === 0 ? <p className="mt-6 text-sm text-slate-600">No open bids on this page.</p> : null}
            {pages > 1 ? (
              <nav aria-label="Pages" className="mt-6 flex flex-wrap gap-2 text-sm">
                {openBidsPageLinks(page, pages).map((n) => (
                  <a
                    key={n}
                    href={openBidsHref(place.slug, n)}
                    aria-current={n === page ? "page" : undefined}
                    className={`rounded-lg border px-3 py-1.5 font-semibold ${n === page ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-blue-800 hover:border-blue-500"}`}
                  >
                    {n}
                  </a>
                ))}
              </nav>
            ) : null}
          </>
        )}
        <h2 className="mt-10 text-lg font-bold text-slate-900">Open bids by state</h2>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
          {OPEN_BIDS_STATES.map((s) => (
            <li key={s.slug}><a href={openBidsHref(s.slug)} className="text-blue-800 hover:underline">{s.name}</a></li>
          ))}
          <li><a href={openBidsHref(NATIONWIDE_SLUG)} className="text-blue-800 hover:underline">No single state</a></li>
        </ul>
      </main>
    </>
  );
}
