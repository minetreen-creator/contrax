import { createFileRoute } from "@tanstack/react-router";
import { bidFitReviewHref } from "~/lib/bid-fit-review-link";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { sql } from "~/db";
import { RfpSummaryCard } from "~/components/RfpSummaryCard";
import { resolveBidState, STATE_CODE_TO_NAME } from "~/lib/location-state";
import {
  bidCanonicalUrl,
  bidSeoDescription,
  bidSeoTitle,
  isBidIndexable,
  stateLandingPath,
} from "~/lib/bid-seo";
import { getCurrentUser } from "~/lib/auth";
import {
  effectiveAutopsyTier,
  LEARNING_TIERS,
  findPriorLossForBid,
  type PriorLossBadge,
} from "~/lib/award-autopsy";

/**
 * /bid/$id — minimal per-bid detail surface that hosts the AI RFP Executive
 * Summary (RfpSummaryCard). This is the app's dedicated bid-detail page and is
 * reachable from the Contract Radar match cards ("AI Executive Brief" link) and
 * via direct URL /bid/<id>. It loads the live `bids` row by id and renders the
 * notice header + the executive-brief card.
 */

interface BidDetail {
  id: number;
  title: string;
  agency: string | null;
  description: string | null;
  location: string | null;
  set_aside: string | null;
  due_date: string | null;
  estimated_value: string | null;
  source_url: string | null;
  /** Contrax Learning ⚡ memory (PAID-ONLY, Professional+ — never Basic/Starter). */
  learned: PriorLossBadge | null;
}

/** The public bid fields the page (and Google) sees. No user data. */
interface PublicBid extends Omit<BidDetail, "learned"> {
  state_name: string | null;
}

/**
 * Server-rendered page data (route loader). Public fields only: the paid
 * "learned from your loss" banner is per-user, so it is still fetched in the
 * browser by getBid below and never rendered into the HTML a crawler sees.
 */
const getPublicBid = createServerFn({ method: "GET" })
  .validator((d: unknown) => {
    const id = Number((d as any)?.id);
    return Number.isInteger(id) && id > 0 ? id : -1;
  })
  .handler(async ({ data: id }): Promise<PublicBid | null> => {
    if (id <= 0) return null;
    try {
      const rows = (await sql()`
        SELECT id, title, agency, description, location, set_aside,
               due_date, estimated_value, source_url
        FROM bids
        WHERE id = ${id}
        LIMIT 1
      `) as any[];
      if (!rows.length) return null;
      const r = rows[0];
      const location = r.location ? String(r.location) : null;
      const agency = r.agency ? String(r.agency) : null;
      const code = resolveBidState(location, agency);
      return {
        id: Number(r.id),
        title: String(r.title ?? ""),
        agency,
        description: r.description ? String(r.description) : null,
        location,
        set_aside: r.set_aside ? String(r.set_aside) : null,
        due_date: r.due_date ? new Date(r.due_date).toISOString() : null,
        estimated_value: r.estimated_value ? String(r.estimated_value) : null,
        source_url: r.source_url ? String(r.source_url) : null,
        state_name: code ? (STATE_CODE_TO_NAME[code] ?? null) : null,
      };
    } catch (e) {
      console.error("[bid/$id] public load failed:", e);
      return null;
    }
  });

const getBid = createServerFn({ method: "GET" })
  .validator((d: unknown) => {
    const id = Number((d as any)?.id);
    return Number.isInteger(id) && id > 0 ? id : -1;
  })
  .handler(async ({ data: id }): Promise<BidDetail | null> => {
    if (id <= 0) return null;
    try {
      const rows = (await sql()`
        SELECT id, title, agency, description, location, set_aside,
               due_date, estimated_value, source_url, naics_code
        FROM bids
        WHERE id = ${id}
        LIMIT 1
      `) as any[];
      if (!rows.length) return null;
      const r = rows[0];
      // Contrax Learning ⚡ memory (PAID-ONLY, Professional+): only the SAME user's
      // autopsied losses ever surface, and only on a paid tier. Anonymous
      // visitors and Basic users get no banner. Failure → no banner.
      let learned: PriorLossBadge | null = null;
      try {
        const user = await getCurrentUser();
        if (user) {
          const tier = await effectiveAutopsyTier(user.id, user);
          if (LEARNING_TIERS.has(tier)) {
            learned = await findPriorLossForBid(user.email, r.agency ? String(r.agency) : null, r.naics_code ? String(r.naics_code) : null);
          }
        }
      } catch (e) {
        console.error("[bid/$id] learning banner failed (no banner):", e);
        learned = null;
      }
      return {
        id: Number(r.id),
        title: String(r.title ?? ""),
        agency: r.agency ? String(r.agency) : null,
        description: r.description ? String(r.description) : null,
        location: r.location ? String(r.location) : null,
        set_aside: r.set_aside ? String(r.set_aside) : null,
        due_date: r.due_date ? String(r.due_date) : null,
        estimated_value: r.estimated_value ? String(r.estimated_value) : null,
        source_url: r.source_url ? String(r.source_url) : null,
        learned,
      };
    } catch (e) {
      console.error("[bid/$id] load failed:", e);
      return null;
    }
  });

function BidDetailPage() {
  const bid = Route.useLoaderData();
  const bidId = bid?.id ?? 0;
  // The per-user "learned from your loss" banner loads in the browser only.
  const [learned, setLearned] = useState<PriorLossBadge | null>(null);

  useEffect(() => {
    let active = true;
    setLearned(null);
    if (bidId > 0) {
      getBid({ data: { id: bidId } }).then((b) => {
        if (active) setLearned(b?.learned ?? null);
      });
    }
    return () => {
      active = false;
    };
  }, [bidId]);
  const stateHref = stateLandingPath(bid?.state_name);

  const due = bid?.due_date
    ? new Date(bid.due_date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto w-full max-w-2xl px-5 py-8">
        <a
          href="/"
          className="self-start text-sm font-bold tracking-tight text-amber-400 hover:text-amber-300"
        >
          ⬢ CONTRAX
        </a>

        {!bid && (
          <div className="mt-8 rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-5 py-10 text-center text-sm text-slate-300">
            This solicitation could not be found or is no longer available.
          </div>
        )}

        {bid && (
          <>
            {learned && (
              <div className="mt-6 rounded-2xl border border-amber-500/50 bg-amber-500/10 px-5 py-4">
                <p className="text-sm font-bold text-amber-300">⚡ Contrax learned from your previous loss</p>
                <p className="mt-1 text-sm leading-relaxed text-amber-100">
                  This opportunity resembles the contract you lost in {learned.month}. Your previous bid was{" "}
                  {learned.priceDiffPct.toFixed(1)}% {learned.direction} the winning price. Suggested action:{" "}
                  {learned.direction === "above"
                    ? "Review pricing before pursuing."
                    : "Price was competitive — review scope and past performance."}
                </p>
              </div>
            )}
            <article className="mt-6 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
              <div className="border-b border-slate-800 px-5 py-4">
                <h1 className="text-lg font-extrabold leading-snug text-white">
                  {bid.title || "Solicitation"}
                </h1>
                {bid.agency && (
                  <p className="mt-1 text-sm text-slate-400">{bid.agency}</p>
                )}
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-300">
                  <span>{bid.set_aside || "Open to small business"}</span>
                  {bid.location && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{bid.location}</span>
                    </>
                  )}
                  {bid.estimated_value && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{bid.estimated_value} estimated</span>
                    </>
                  )}
                  {due && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Due {due}</span>
                    </>
                  )}
                </p>
              </div>
              {bid.source_url && (
                <div className="px-5 py-3">
                  <a
                    href={bid.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-amber-400 hover:text-amber-300"
                  >
                    Open original notice ↗
                  </a>
                  {bidFitReviewHref(bid) && (
                    <a
                      href={bidFitReviewHref(bid)!}
                      className="ml-4 text-sm font-semibold text-slate-200 hover:text-white"
                    >
                      Not sure it fits? Get a $99 Bid Fit Review →
                    </a>
                  )}
                </div>
              )}
            </article>

            {stateHref && bid.state_name && (
              <p className="mt-4 text-sm">
                <a href={stateHref} className="font-semibold text-amber-400 hover:text-amber-300">
                  More open government contracts in {bid.state_name} →
                </a>
              </p>
            )}

            <div className="mt-5">
              <RfpSummaryCard
                bidId={bid.id}
                description={bid.description}
                title={bid.title}
                value={bid.estimated_value}
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export const Route = createFileRoute("/bid/$bidId")({
  loader: ({ params }) => getPublicBid({ data: { id: Number(params.bidId) } }),
  head: ({ loaderData }) => {
    const bid = loaderData ?? null;
    if (!bid) {
      return { meta: [{ title: "Solicitation not found | Contrax" }, { name: "robots", content: "noindex, follow" }] };
    }
    const title = bidSeoTitle(bid);
    const description = bidSeoDescription(bid);
    const url = bidCanonicalUrl(bid.id);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { name: "robots", content: isBidIndexable(bid) ? "index, follow" : "noindex, follow" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: url },
        { property: "og:type", content: "website" },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: BidDetailPage,
});
