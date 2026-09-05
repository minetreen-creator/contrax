import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { sql } from "~/db";
import { RfpSummaryCard } from "~/components/RfpSummaryCard";
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
  /** Contrax Learning ⚡ memory (PAID-ONLY, Starter+ — never Basic). */
  learned: PriorLossBadge | null;
}

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
      // Contrax Learning ⚡ memory (PAID-ONLY, Starter+): only the SAME user's
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
  const { bidId: bidIdParam } = Route.useParams();
  const bidId = Number(bidIdParam);
  const [bid, setBid] = useState<BidDetail | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    getBid({ data: { id: bidId } }).then((b) => {
      if (active) setBid(b);
    });
    return () => {
      active = false;
    };
  }, [bidId]);

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

        {bid === undefined && (
          <p className="mt-8 text-sm text-slate-400">Loading solicitation…</p>
        )}

        {bid === null && (
          <div className="mt-8 rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-5 py-10 text-center text-sm text-slate-300">
            This solicitation could not be found or is no longer available.
          </div>
        )}

        {bid && (
          <>
            {bid.learned && (
              <div className="mt-6 rounded-2xl border border-amber-500/50 bg-amber-500/10 px-5 py-4">
                <p className="text-sm font-bold text-amber-300">⚡ Contrax learned from your previous loss</p>
                <p className="mt-1 text-sm leading-relaxed text-amber-100">
                  This opportunity resembles the contract you lost in {bid.learned.month}. Your previous bid was{" "}
                  {bid.learned.priceDiffPct.toFixed(1)}% {bid.learned.direction} the winning price. Suggested action:{" "}
                  {bid.learned.direction === "above"
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
                </div>
              )}
            </article>

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
  component: BidDetailPage,
});
