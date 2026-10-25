import { createFileRoute } from "@tanstack/react-router";
import { bidFitReviewHref } from "~/lib/bid-fit-review-link";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { sql } from "~/db";
import { RfpSummaryCard } from "~/components/RfpSummaryCard";
import { resolveBidState, STATE_CODE_TO_NAME } from "~/lib/location-state";
import { BidAlertCapture } from "~/components/BidAlertCapture";
import { MaxAssistant } from "~/components/MaxAssistant";
import {
  bidCanonicalUrl,
  bidSeoDescription,
  bidSeoTitle,
  isBidIndexable,
  stateLandingPath,
} from "~/lib/bid-seo";
import { getCurrentUser } from "~/lib/auth";
import { applyHeadStart } from "~/lib/head-start";
import { hasPaidBidAccess } from "~/lib/head-start.server";
import { HeadStartLock } from "~/components/HeadStartLock";
import { trackEvent } from "~/lib/track";
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
  /** Set while the bid is in its paid head start and this viewer is not paid (src/lib/head-start.ts). */
  head_start_until: string | null;
  /** Contrax Learning ⚡ memory (PAID-ONLY, Professional+ — never Basic/Starter). */
  learned: PriorLossBadge | null;
  /** Point of contact (owner 2026-10-19: paid plans only — never sent to anyone else). */
  contact: BidContact | null;
}

interface BidContact {
  name: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * The bid's stored point of contact, or null. Its own query so a database
 * without the contact columns yet (they arrive with the nightly SAM import)
 * still loads the page.
 */
async function loadContact(id: number): Promise<BidContact | null> {
  try {
    const rows = (await sql()`
      SELECT contact_name, contact_email, contact_phone FROM bids WHERE id = ${id} LIMIT 1
    `) as any[];
    const r = rows[0];
    if (!r || !(r.contact_name || r.contact_email || r.contact_phone)) return null;
    return {
      name: r.contact_name ? String(r.contact_name) : null,
      email: r.contact_email ? String(r.contact_email) : null,
      phone: r.contact_phone ? String(r.contact_phone) : null,
    };
  } catch {
    return null;
  }
}

/** The public bid fields the page (and Google) sees. No user data. */
interface PublicBid extends Omit<BidDetail, "learned" | "contact"> {
  state_name: string | null;
  /** For the "Get bids like this by email" box. */
  state_code: string | null;
  naics_code: string | null;
  /** True when a point of contact is on file — the details themselves are paid-only. */
  has_contact: boolean;
}

/**
 * Server-rendered page data (route loader). Public fields only: the paid
 * "learned from your loss" banner is per-user, so it is still fetched in the
 * browser by getBid below and never rendered into the HTML a crawler sees.
 * The public render is always the FREE view, so a bid in its paid head start
 * has no source link here; getBid unlocks it for paying members.
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
               due_date, estimated_value, source_url, naics_code, created_at
        FROM bids
        WHERE id = ${id}
        LIMIT 1
      `) as any[];
      if (!rows.length) return null;
      const r = rows[0];
      const location = r.location ? String(r.location) : null;
      const agency = r.agency ? String(r.agency) : null;
      const code = resolveBidState(location, agency);
      const { source_url, head_start_until } = applyHeadStart(
        { source_url: r.source_url ? String(r.source_url) : null, created_at: r.created_at ?? null },
        false,
      );
      return {
        id: Number(r.id),
        title: String(r.title ?? ""),
        agency,
        description: r.description ? String(r.description) : null,
        location,
        set_aside: r.set_aside ? String(r.set_aside) : null,
        due_date: r.due_date ? new Date(r.due_date).toISOString() : null,
        estimated_value: r.estimated_value ? String(r.estimated_value) : null,
        source_url,
        head_start_until,
        state_name: code ? (STATE_CODE_TO_NAME[code] ?? null) : null,
        state_code: code ?? null,
        naics_code: r.naics_code ? String(r.naics_code) : null,
        has_contact: (await loadContact(id)) !== null,
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
               due_date, estimated_value, source_url, naics_code, created_at
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
      let paid = false;
      try {
        const user = await getCurrentUser();
        paid = await hasPaidBidAccess(user);
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
      const { source_url, head_start_until } = applyHeadStart(
        { source_url: r.source_url ? String(r.source_url) : null, created_at: r.created_at ?? null },
        paid,
      );
      return {
        id: Number(r.id),
        title: String(r.title ?? ""),
        agency: r.agency ? String(r.agency) : null,
        description: r.description ? String(r.description) : null,
        location: r.location ? String(r.location) : null,
        set_aside: r.set_aside ? String(r.set_aside) : null,
        due_date: r.due_date ? String(r.due_date) : null,
        estimated_value: r.estimated_value ? String(r.estimated_value) : null,
        source_url,
        head_start_until,
        learned,
        contact: paid ? await loadContact(id) : null,
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
  // A paying member's own view of the bid unlocks a head-start link the
  // public render withheld.
  const [unlockedUrl, setUnlockedUrl] = useState<string | null>(null);
  // The point of contact, for paid plans only (fetched per user, never in the HTML).
  // undefined until this viewer's own check returns, so a paying member never
  // sees the locked teaser flash first.
  const [contact, setContact] = useState<BidContact | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setLearned(null);
    setUnlockedUrl(null);
    setContact(undefined);
    if (bidId > 0) {
      getBid({ data: { id: bidId } }).then((b) => {
        if (!active) return;
        setLearned(b?.learned ?? null);
        setUnlockedUrl(b?.source_url ?? null);
        setContact(b?.contact ?? null);
      });
    }
    return () => {
      active = false;
    };
  }, [bidId]);
  const stateHref = stateLandingPath(bid?.state_name);
  const sourceUrl = bid?.source_url ?? unlockedUrl;
  const locked = !!bid?.head_start_until && !sourceUrl;

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
              {locked && (
                <div className="px-5 py-3">
                  <HeadStartLock until={bid.head_start_until!} />
                </div>
              )}
              {sourceUrl && (
                <div className="px-5 py-3">
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-amber-400 hover:text-amber-300"
                  >
                    Open original notice ↗
                  </a>
                  {bidFitReviewHref({ ...bid, source_url: sourceUrl }) && (
                    <a
                      href={bidFitReviewHref({ ...bid, source_url: sourceUrl })!}
                      className="ml-4 text-sm font-semibold text-slate-200 hover:text-white"
                    >
                      Not sure it fits? Get a $49 Bid Fit Review →
                    </a>
                  )}
                </div>
              )}
              {bid.has_contact && contact !== undefined && <BidContactPanel contact={contact} bidId={bid.id} />}
            </article>

            {stateHref && bid.state_name && (
              <p className="mt-4 text-sm">
                <a href={stateHref} className="font-semibold text-amber-400 hover:text-amber-300">
                  More open government contracts in {bid.state_name} →
                </a>
              </p>
            )}

            <MaxAssistant bid={{ id: bid.id, title: bid.title }} />

            <BidAlertCapture naicsCode={bid.naics_code} stateCode={bid.state_code} />

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

/**
 * Who to contact (owner 2026-10-19). Paid plans see the name, email and phone;
 * everyone else sees that a contact is on file and how to unlock it.
 */
function BidContactPanel({ contact, bidId }: { contact: BidContact | null; bidId: number }) {
  if (contact) {
    return (
      <div className="border-t border-slate-800 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Who to contact</p>
        {contact.name && <p className="mt-1 text-sm font-semibold text-white">{contact.name}</p>}
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {contact.email && (
            <a href={`mailto:${contact.email}`} className="font-semibold text-amber-400 hover:text-amber-300">
              {contact.email}
            </a>
          )}
          {contact.phone && (
            <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="font-semibold text-amber-400 hover:text-amber-300">
              {contact.phone}
            </a>
          )}
        </p>
      </div>
    );
  }
  return (
    <div className="border-t border-slate-800 px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Who to contact</p>
      <p className="mt-1 text-sm text-slate-300">
        🔒 The contracting officer&apos;s name, email and phone are on file for this bid. Paid plans see them.
      </p>
      <a
        href={`/upgrade?utm_source=bid&utm_campaign=contact&bid=${bidId}`}
        onClick={() => trackEvent("bid_contact_upgrade_click", String(bidId))}
        className="mt-2 inline-block text-sm font-semibold text-amber-400 hover:text-amber-300"
      >
        See who to contact: Starter, $19/month →
      </a>
    </div>
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
