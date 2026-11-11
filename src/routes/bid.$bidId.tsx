import { createFileRoute } from "@tanstack/react-router";
import { UnlockBidSheet } from "~/components/UnlockBidSheet";
import { rememberCheckoutBid } from "~/lib/checkout-resume";
import { createServerFn } from "@tanstack/react-start";
import { WinnerPriceLine } from "~/components/WinnerPriceLine";
import { IntelTeaserCard } from "~/components/IntelTeaserCard";
import { RedFlagScanner } from "~/components/RedFlagScanner";
import { intelTeaser, recompeteLine, type IntelTeaser } from "~/lib/intel-teaser";
import { AreaAwardsBox } from "~/components/AreaAwardsBox";
import { AppInstallBanner } from "~/components/AppInstallBanner";
import type { AreaAwards } from "~/lib/area-awards";
import { deriveWinnerPrice } from "~/lib/winner-price";
import type { FPDSIntel } from "~/lib/fpds";
import { STARTER_FIRST_MONTH_PRICE, STARTER_FULL_PRICE } from "~/lib/starter-offer";
import { useCallback, useEffect, useState } from "react";
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
import { agencyDisplay, bidStarterHref, daysLeftLabel, jobSummary, valueLabel } from "~/lib/bid-job-summary";
import { watermarkText } from "~/lib/bid-watermark";
import { trackEvent } from "~/lib/track";
import { redirectToCheckout } from "~/lib/checkout";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { SIMILAR_BIDS_LIMIT, similarNaicsPrefixes, similarRadarHref } from "~/lib/similar-bids";
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
  /** The viewer has an account (Basic after its trial), so the lock offers a plan, not a trial. */
  signed_in: boolean;
  /** The agency's own bid number, shown in the $5 confirm step (owner 2026-11-08). */
  solicitation_number?: string | null;
  /** Which Starter checkout this viewer gets: "pass" ($5 once) or a $19/month subscription. */
  starter_kind?: "pass" | "subscription" | "subscription_full_price";
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
interface PublicBid extends Omit<BidDetail, "learned" | "contact" | "signed_in"> {
  state_name: string | null;
  /** For the "Get bids like this by email" box. */
  state_code: string | null;
  naics_code: string | null;
  /** True when a point of contact is on file — the details themselves are paid-only. */
  has_contact: boolean;
  /** True when the bid has an official notice link — the link itself is members-only. */
  has_link: boolean;
  /** Open bids like this one in the same state (src/lib/similar-bids.ts). */
  similar: SimilarBids;
  /** Invisible per-render watermark token (src/lib/bid-watermark.ts); null when not recorded. */
  wm: string | null;
}

interface SimilarBid {
  id: number;
  title: string;
  agency: string | null;
  due_date: string | null;
}

interface SimilarBids {
  /** "naics": same NAICS code or industry group; "state": other open bids in the state. */
  scope: "naics" | "state" | null;
  total: number;
  bids: SimilarBid[];
}

const NO_SIMILAR: SimilarBids = { scope: null, total: 0, bids: [] };

/** Up to three real open bids in the same state, closest NAICS match first. */
async function loadSimilar(id: number, state: string | null, naics: string | null): Promise<SimilarBids> {
  if (!state) return NO_SIMILAR;
  const s = sql();
  const open = s`due_date > NOW() + INTERVAL '2 days' AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}`;
  const pick = (rows: any[]): SimilarBid[] => {
    const seen = new Set<string>();
    const out: SimilarBid[] = [];
    for (const r of rows) {
      const title = String(r.title ?? "").trim();
      const key = title.toLowerCase();
      if (!title || seen.has(key)) continue;
      seen.add(key);
      out.push({ id: Number(r.id), title, agency: r.agency ? String(r.agency) : null, due_date: r.due_date ? new Date(r.due_date).toISOString() : null });
      if (out.length === SIMILAR_BIDS_LIMIT) break;
    }
    return out;
  };
  try {
    for (const prefix of similarNaicsPrefixes(naics)) {
      const like = `${prefix}%`;
      const [rows, count] = await Promise.all([
        s`SELECT id, title, agency, due_date FROM bids
          WHERE normalized_state = ${state} AND naics_code LIKE ${like} AND id <> ${id} AND ${open}
          ORDER BY due_date ASC LIMIT 12`,
        s`SELECT COUNT(*)::int AS n FROM bids
          WHERE normalized_state = ${state} AND naics_code LIKE ${like} AND id <> ${id} AND ${open}`,
      ]);
      const bids = pick(rows as any[]);
      if (bids.length) return { scope: "naics", total: Number((count as any[])[0]?.n ?? bids.length), bids };
    }
    const [rows, count] = await Promise.all([
      s`SELECT id, title, agency, due_date FROM bids
        WHERE normalized_state = ${state} AND id <> ${id} AND ${open}
          AND title !~ '^[0-9]{2}--' AND length(title) >= 15
        ORDER BY created_at DESC LIMIT 12`,
      s`SELECT COUNT(*)::int AS n FROM bids WHERE normalized_state = ${state} AND id <> ${id} AND ${open}`,
    ]);
    const bids = pick(rows as any[]);
    return bids.length ? { scope: "state", total: Number((count as any[])[0]?.n ?? bids.length), bids } : NO_SIMILAR;
  } catch (e) {
    console.error("[bid/$id] similar bids failed:", e);
    return NO_SIMILAR;
  }
}

/**
 * Server-rendered page data (route loader). Public fields only: the paid
 * "learned from your loss" banner is per-user, so it is still fetched in the
 * browser by getBid below and never rendered into the HTML a crawler sees.
 * The public render is always the FREE view, so it never carries the official
 * notice link (owner 2026-10-29: "no more living off the free tier" — free
 * accounts and visitors see what the job is, members get the link to act on
 * it). getBid unlocks it for paying members and active trials.
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
               due_date, estimated_value, source_url, naics_code, created_at, solicitation_number
        FROM bids
        WHERE id = ${id}
        LIMIT 1
      `) as any[];
      if (!rows.length) return null;
      const r = rows[0];
      const location = r.location ? String(r.location) : null;
      const agency = r.agency ? String(r.agency) : null;
      const code = resolveBidState(location, agency);
      const { head_start_until } = applyHeadStart(
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
        source_url: null,
        has_link: !!r.source_url,
        head_start_until,
        state_name: code ? (STATE_CODE_TO_NAME[code] ?? null) : null,
        state_code: code ?? null,
        naics_code: r.naics_code ? String(r.naics_code) : null,
        has_contact: (await loadContact(id)) !== null,
        similar: await loadSimilar(Number(r.id), code ?? null, r.naics_code ? String(r.naics_code) : null),
        // Owner 2026-11-05 ("Do all"): traces copied listings back to the visit (src/lib/bid-watermark.ts).
        wm: await (await import("~/lib/bid-watermark.server")).recordBidWatermark(Number(r.id)),
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
               due_date, estimated_value, source_url, naics_code, created_at, solicitation_number
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
      let signedIn = false;
      // Which Starter checkout this viewer gets (owner 2026-11-08): only a first-time buyer gets the
      // one-time $5 pass; someone who already used it is offered $19/month. The lock says which.
      let starterKind: "pass" | "subscription" | "subscription_full_price" = "pass";
      try {
        const user = await getCurrentUser();
        signedIn = !!user;
        if (user) {
          try {
            const { starterKindForUser } = await import("~/lib/starter-pass.server");
            starterKind = await starterKindForUser(user.id);
          } catch {
            starterKind = "pass";
          }
        }
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
        // Members only (paid plans and active trials); see getPublicBid.
        source_url: paid ? source_url : null,
        head_start_until,
        learned,
        contact: paid ? await loadContact(id) : null,
        signed_in: signedIn,
        solicitation_number: r.solicitation_number ? String(r.solicitation_number).slice(0, 80) : null,
        starter_kind: starterKind,
      };
    } catch (e) {
      console.error("[bid/$id] load failed:", e);
      return null;
    }
  });

/**
 * "What's this job worth?" (owner 2026-10-29): who won this work last time and
 * for how much, from public FPDS / USAspending records (the same lookup Radar
 * cards use, cached in fpds_lookups). Members get the line; everyone else
 * learns only that a record exists, so the response never carries the winner
 * or amount for a free viewer. Rate-limited per IP because the first lookup
 * for a bid calls USAspending.
 */
const getBidPriceIntel = createServerFn({ method: "GET" })
  .validator((d: unknown) => {
    const id = Number((d as any)?.id);
    return Number.isInteger(id) && id > 0 ? id : -1;
  })
  .handler(async ({ data: id }): Promise<{ intel: FPDSIntel | null; hasRecord: boolean; teaser: IntelTeaser | null }> => {
    const none = { intel: null, hasRecord: false, teaser: null };
    if (id <= 0) return none;
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const { checkIpLimit } = await import("~/lib/rate-limit");
      const limit = await checkIpLimit(getRequest(), "bid-price-intel", 60, 3600);
      if (!limit.allowed) return none;
      const rows = (await sql()`
        SELECT title, agency, naics_code, source, external_id FROM bids WHERE id = ${id} LIMIT 1
      `) as { title: string | null; agency: string | null; naics_code: string | null; source: string | null; external_id: string | null }[];
      const r = rows[0];
      if (!r?.naics_code) return none;
      const { lookupFPDSIntel, FPDS_RADAR_LOOKUP_TIMEOUT_MS } = await import("~/lib/fpds");
      const res = await lookupFPDSIntel(r.naics_code, r.agency ?? "", r.title ?? "", {
        totalTimeoutMs: FPDS_RADAR_LOOKUP_TIMEOUT_MS,
        key: { source: r.source, opportunityId: r.external_id },
      });
      const intel = res.status === "ok" ? res.intel : null;
      const hasRecord = !!deriveWinnerPrice(intel, null);
      if (!hasRecord) return none;
      const paid = await hasPaidBidAccess(await getCurrentUser());
      // Free viewers get only the teaser facts (end year, re-bid soon, years of history): never the winner or a dollar amount.
      return { intel: paid ? intel : null, hasRecord: true, teaser: intelTeaser(intel) };
    } catch (e) {
      console.error("[bid/$id] price intel failed (nothing shown):", e);
      return none;
    }
  });

/**
 * Federal winning prices near this bid (owner 2026-11-07): recent federal
 * contracts for the same kind of work in the same state, from award_leads.
 * Winners and amounts only for paid plans; everyone else gets the count.
 */
const getBidAreaAwards = createServerFn({ method: "GET" })
  .validator((d: unknown) => {
    const id = Number((d as any)?.id);
    return Number.isInteger(id) && id > 0 ? id : -1;
  })
  .handler(async ({ data: id }): Promise<AreaAwards | null> => {
    if (id <= 0) return null;
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const { checkIpLimit } = await import("~/lib/rate-limit");
      const limit = await checkIpLimit(getRequest(), "bid-area-awards", 120, 3600);
      if (!limit.allowed) return null;
      const rows = (await sql()`
        SELECT location, agency, naics_code, category FROM bids WHERE id = ${id} LIMIT 1
      `) as { location: string | null; agency: string | null; naics_code: string | null; category: string | null }[];
      const r = rows[0];
      if (!r) return null;
      const state = resolveBidState(r.location, r.agency) ?? null;
      const { loadAreaAwards } = await import("~/lib/area-awards.server");
      const paid = await hasPaidBidAccess(await getCurrentUser());
      return await loadAreaAwards(state, r.naics_code, r.category, paid);
    } catch (e) {
      console.error("[bid/$id] area awards failed (nothing shown):", e);
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
  // False until this viewer's own check returns, so a member never sees the
  // locked panel flash first.
  const [checked, setChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [price, setPrice] = useState<{ intel: FPDSIntel | null; hasRecord: boolean; teaser: IntelTeaser | null } | null>(null);
  const [areaAwards, setAreaAwards] = useState<AreaAwards | null>(null);
  // The point of contact, for paid plans only (fetched per user, never in the HTML).
  // undefined until this viewer's own check returns, so a paying member never
  // sees the locked teaser flash first.
  const [contact, setContact] = useState<BidContact | null | undefined>(undefined);
  // One $5 confirm step for the whole page (owner 2026-11-09): the top line, the lock and the
  // contact panel all open it. Only a first-time buyer gets the one-time $5 pass; a used pass
  // means Starter at $19/month and goes straight to checkout.
  const [confirming, setConfirming] = useState(false);
  // The app banner waits until the visitor has seen the $5 offer (scrolled past it or closed it).
  const [offerSeen, setOfferSeen] = useState(false);
  const pass = (bid?.starter_kind ?? "pass") === "pass";

  useEffect(() => {
    let active = true;
    setLearned(null);
    setUnlockedUrl(null);
    setChecked(false);
    setContact(undefined);
    setPrice(null);
    setAreaAwards(null);
    if (bidId > 0) {
      getBidAreaAwards({ data: { id: bidId } })
        .then((a) => {
          if (!active || !a) return;
          setAreaAwards(a);
          trackEvent("bid_area_awards_shown", a.detail ? "full" : "teaser");
        })
        .catch(() => {});
      getBidPriceIntel({ data: { id: bidId } })
        .then((p) => {
          if (!active) return;
          setPrice(p);
          if (p.hasRecord) trackEvent("bid_price_intel_shown", p.intel ? "full" : "teaser");
        })
        .catch(() => {});
      getBid({ data: { id: bidId } }).then((b) => {
        if (!active) return;
        setLearned(b?.learned ?? null);
        setUnlockedUrl(b?.source_url ?? null);
        setChecked(true);
        setSignedIn(!!b?.signed_in);
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
  const membersOnly = !!bid?.has_link && !locked && !sourceUrl && checked;
  const lockShown = locked || membersOnly;
  const unlock = () => {
    if (pass) {
      setConfirming(true);
    } else {
      rememberCheckoutBid(bidId);
      void redirectToCheckout("starter");
    }
  };
  const closeSheet = useCallback(() => {
    setConfirming(false);
    setOfferSeen(true);
    trackEvent("bid_lock_sheet_close", locked ? "new" : "members");
  }, [locked]);
  useEffect(() => {
    if (!lockShown || offerSeen) return;
    const onScroll = () => {
      if (window.scrollY > 700) setOfferSeen(true);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [lockShown, offerSeen]);

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
                {agencyDisplay(bid.agency) && (
                  <p className="mt-1 text-sm text-slate-400">{agencyDisplay(bid.agency)}</p>
                )}
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-slate-300">
                  {due && (
                    <span className="font-semibold text-white">
                      Due {due}
                      {daysLeftLabel(bid.due_date) && <span className="font-normal text-amber-300"> · {daysLeftLabel(bid.due_date)}</span>}
                    </span>
                  )}
                  {bid.location && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{bid.location}</span>
                    </>
                  )}
                  {valueLabel(bid.estimated_value) && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{valueLabel(bid.estimated_value)} estimated</span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>{bid.set_aside || "Open to small business"}</span>
                </p>
                {/* Owner 2026-11-09: 110 real people opened a bid page in a week and 4 tapped $5;
                    on a phone the lock's button sat below the first screen. */}
                {lockShown && (
                  <a
                    href={bidStarterHref(bid.id, signedIn)}
                    onClick={(e) => {
                      e.preventDefault();
                      trackEvent("bid_top_starter_click", locked ? "new" : "members");
                      unlock();
                    }}
                    className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2.5 text-sm hover:border-amber-400"
                  >
                    <span className="text-amber-100">
                      🔒 {bid.has_contact ? "Notice, documents and contact" : "Notice and documents"}:{" "}
                      <span className="font-bold text-white">
                        {pass ? `$${STARTER_FIRST_MONTH_PRICE} for 30 days, one time` : `Starter, $${STARTER_FULL_PRICE}/month`}
                      </span>
                    </span>
                    <span className="shrink-0 font-bold text-amber-300">Unlock →</span>
                  </a>
                )}
              </div>
              {/* Owner 2026-11-02 (design critique): the job is free to read; only
                  the official notice and its documents are for members. */}
              <section aria-label="What the job is" className="border-b border-slate-800 px-5 py-4">
                <h2 className="text-sm font-semibold text-slate-200">What the job is</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-300">
                  {watermarkText(
                    jobSummary(bid.description, bid.title) ??
                      `${bid.title || "This bid"}${bid.agency ? `, for ${agencyDisplay(bid.agency)}` : ""}. The agency's official notice has the full scope of work, the documents and how to submit.`,
                    bid.wm,
                  )}
                </p>
              </section>
              {(locked || membersOnly) && (
                <div className="px-5 py-4">
                  <NoticeLock bidId={bid.id} signedIn={signedIn} isNew={locked} pass={pass} onUnlock={unlock} />
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
                </div>
              )}
              {bid.has_contact && contact !== undefined && <BidContactPanel contact={contact} bidId={bid.id} pass={pass} onUnlock={unlock} />}
              {price?.hasRecord && (
                <div className="px-5 pb-4">
                  {price.intel ? (
                    <>
                      <WinnerPriceLine intel={price.intel} paidAccess revealed />
                      {recompeteLine(price.intel.pop_end_date) ? (
                        <p className="mt-2 text-sm text-slate-300">🔁 {recompeteLine(price.intel.pop_end_date)}</p>
                      ) : null}
                    </>
                  ) : (
                    <IntelTeaserCard teaser={price.teaser} bidId={bid.id} />
                  )}
                </div>
              )}
            </article>

            {/* Owner 2026-11-11: this sat at the very bottom of the page (the third screen on a phone);
                152 visitors were counted as shown an email ask in a week and 4 gave one. It is now the
                first thing under the bid, for visitors without an account. */}
            <BidAlertCapture
              naicsCode={bid.naics_code}
              stateCode={bid.state_code}
              heading="Not ready to bid this one? Get the next ones by email"
            />

            {/* Red-flag scanner (owner 2026-11-08). */}
            <RedFlagScanner noticeText={bid.description} bidId={bid.id} />

            {areaAwards && <AreaAwardsBox data={areaAwards} stateName={bid.state_name} />}

            <SimilarBidsBox
              similar={bid.similar}
              stateName={bid.state_name}
              radarHref={similarRadarHref(bid.naics_code, bid.state_code)}
              stateHref={stateHref}
            />

            {stateHref && bid.state_name && (
              <p className="mt-4 text-sm">
                <a href={stateHref} className="font-semibold text-amber-400 hover:text-amber-300">
                  More open government contracts in {bid.state_name} →
                </a>
              </p>
            )}

            {/* Sub Finder (owner 2026-11-09): a prime going after this bid finds subs and sends a Trade Package. */}
            <a
              href={`/sub-finder?bid=${bid.id}${bid.state_code ? `&state=${bid.state_code}` : ""}`}
              onClick={() => trackEvent("bid_sub_finder_click", String(bid.id))}
              className="mt-4 block rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm hover:border-amber-400"
            >
              <span className="font-semibold text-white">Bidding as the prime? Find subs for this bid →</span>
              <span className="mt-0.5 block text-xs text-slate-400">Sub Finder: listed subs by trade and certification, plus a Trade Package link to collect quotes.</span>
            </a>

            <MaxAssistant bid={{ id: bid.id, title: bid.title }} />

            <a
              href="/app?source=bid"
              onClick={() => trackEvent("bid_app_click", String(bid.id))}
              className="mt-4 flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm hover:border-amber-400"
            >
              <img src="/app-icon-192.png" alt="" width={36} height={36} className="h-9 w-9 rounded-lg" />
              <span>
                <span className="block font-semibold text-white">📱 Get bids like this on your phone</span>
                <span className="block text-xs text-slate-400">The Contrax app buzzes you when a new one posts.</span>
              </span>
            </a>

            {/* The AI brief is a member feature; a visitor deciding on $5 does not
                get a $79/mo pitch (owner 2026-11-02, design critique). */}
            {checked && signedIn && (
              <div className="mt-5">
                <RfpSummaryCard
                  bidId={bid.id}
                  description={bid.description}
                  title={bid.title}
                  value={bid.estimated_value}
                />
              </div>
            )}
          </>
        )}
      </div>
      {/* The Contrax app install prompt for phone visitors (owner 2026-11-07), held until the
          visitor has seen the $5 offer so it never covers the first screen (owner 2026-11-09). */}
      {bid && <AppInstallBanner where="bid" hold={!checked || (lockShown && !offerSeen)} />}
      {bid && confirming ? <UnlockBidSheet bidId={bid.id} bid={bid} onClose={closeSheet} /> : null}
    </main>
  );
}

/**
 * "Similar open bids" (owner 2026-10-26): Radar visitors who opened a bid from
 * the "Open now" box left from this page. Real open bids only; hidden when none.
 */
function SimilarBidsBox({
  similar,
  stateName,
  radarHref,
  stateHref,
}: {
  similar: SimilarBids;
  stateName: string | null;
  radarHref: string | null;
  stateHref: string | null;
}) {
  if (!similar?.bids.length) return null;
  const where = stateName ? ` in ${stateName}` : "";
  const heading = similar.scope === "naics" ? `Similar open bids${where}` : `More open bids${where}`;
  const allHref = similar.scope === "naics" && radarHref ? radarHref : stateHref;
  const due = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null;
  return (
    <section aria-label={heading} className="mt-6 rounded-2xl border border-amber-500/40 bg-slate-900 px-5 py-4">
      <h2 className="text-sm font-bold uppercase tracking-wide text-amber-300">{heading}</h2>
      <ul className="mt-3 divide-y divide-slate-800">
        {similar.bids.map((b) => (
          <li key={b.id} className="py-2.5">
            <a
              href={`/bid/${b.id}`}
              onClick={() => trackEvent("bid_similar_click", String(b.id))}
              className="block text-sm font-semibold leading-snug text-white hover:text-amber-300"
            >
              {b.title}
            </a>
            <span className="text-xs text-slate-400">
              {agencyDisplay(b.agency) || "Government buyer"}
              {due(b.due_date) ? ` · due ${due(b.due_date)}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {allHref && similar.total > similar.bids.length && (
        <a
          href={allHref}
          onClick={() => trackEvent("bid_similar_all", similar.scope ?? "")}
          className="mt-2 inline-block text-sm font-bold text-amber-400 hover:text-amber-300"
        >
          See all {similar.total.toLocaleString("en-US")} →
        </a>
      )}
    </section>
  );
}

/**
 * Who to contact (owner 2026-10-19). Paid plans see the name, email and phone;
 * everyone else sees that a contact is on file and how to unlock it.
 */
function BidContactPanel({ contact, bidId, pass, onUnlock }: { contact: BidContact | null; bidId: number; pass: boolean; onUnlock: () => void }) {
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
        🔒 The contracting officer&apos;s name, email and phone are on file for this bid.{" "}
        {pass ? `They're included in the $${STARTER_FIRST_MONTH_PRICE} pass.` : "Starter members see them."}
      </p>
      <a
        href={`/upgrade?utm_source=bid&utm_campaign=contact&bid=${bidId}`}
        onClick={(e) => {
          e.preventDefault();
          trackEvent("bid_contact_upgrade_click", String(bidId));
          onUnlock();
        }}
        className="mt-2 inline-block text-sm font-semibold text-amber-400 hover:text-amber-300"
      >
        {pass ? `See who to contact: included in the $${STARTER_FIRST_MONTH_PRICE} pass →` : `See who to contact: Starter, $${STARTER_FULL_PRICE}/month →`}
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
      links: [{ rel: "canonical", href: url }, { rel: "manifest", href: "/app.webmanifest" }],
    };
  },
  component: BidDetailPage,
});

/**
 * The official notice link is for members (owner 2026-10-29: "no more living
 * off the free tier"). Free accounts and visitors see what the job is; the $5
 * Starter pass is the one button to act on it (owner 2026-11-01).
 */
function NoticeLock({ bidId, signedIn, isNew = false, pass, onUnlock }: { bidId: number; signedIn: boolean; isNew?: boolean; pass: boolean; onUnlock: () => void }) {
  // Owner 2026-11-02 (design critique): one lock for every locked bid, the $5
  // as the one clear button, and the bid carried through signup to the plan.
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-4">
      <p className="text-sm font-semibold text-amber-200">
        {isNew && <span className="mr-2 rounded bg-amber-400 px-1.5 py-0.5 text-xs font-bold text-slate-950">New this week</span>}
        The official notice and bid documents are for Starter members
      </p>
      <ul className="mt-2 space-y-1 text-sm text-slate-200">
        <li>✓ Open this notice and its documents today</li>
        <li>✓ Every new bid in your trade, emailed at 6 AM</li>
        <li>{pass ? `✓ 30 days for $${STARTER_FIRST_MONTH_PRICE}, one time. No automatic renewal.` : `✓ Starter is $${STARTER_FULL_PRICE}/month. Cancel anytime.`}</li>
      </ul>
      <a
        href={bidStarterHref(bidId, signedIn)}
        onClick={(e) => {
          // Pay first, account after (CEO 2026-10-22). Owner 2026-11-08: 4 of 6 checkouts that
          // day came from this button and none paid, so it opens a short confirm step (this bid,
          // what $5 gets, no auto-renew) before Stripe. The href is the no-JS fallback.
          e.preventDefault();
          trackEvent("bid_lock_starter_click", isNew ? "new" : "members");
          onUnlock();
        }}
        className="mt-3 block w-full rounded-lg bg-amber-400 px-4 py-3 text-center text-base font-bold text-slate-950 hover:bg-amber-300 sm:inline-block sm:w-auto"
      >
        {pass ? `Open this bid + every new one for 30 days: $${STARTER_FIRST_MONTH_PRICE}` : `Open this bid with Starter: $${STARTER_FULL_PRICE}/month`}
      </a>
    </div>
  );
}

