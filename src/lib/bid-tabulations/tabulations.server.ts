/**
 * BID TABULATIONS — server-side reader + the Starter-$19 entitlement (owner rule ④).
 *
 * TWO INVIOLABLE PROPERTIES:
 *
 *  1. FAIL-OPEN ON THE SCHEMA, FAIL-CLOSED ON MONEY. The tables arrive with
 *     migration 059 and a PR preview (or any environment that has not run it yet)
 *     simply has no `bid_tabulations` table. Every read here is wrapped: a missing
 *     table returns null and the bid-detail page renders exactly as it did before
 *     this feature existed. The ENTITLEMENT read is the opposite — an unreadable
 *     entitlement is treated as NOT entitled (the same fail-closed stance as
 *     plan-gates.server.ts), because handing prices to a free user during a blip is
 *     worse than the rare opposite.
 *
 *  2. THE PRICES NEVER REACH A FREE CLIENT. `includePrices` is decided HERE, by the
 *     entitlement predicate, and both the price columns and the (separate, larger)
 *     bidder-row read are gated on it. A teaser is therefore a teaser in the payload
 *     itself — there is no "hide it in the UI" step that a client could undo.
 *
 * The entitlement is the SAME boundary the rest of the product uses for Starter
 * (`hasUnlimitedSaves` in src/lib/trial.ts: at or above the `starter` rung of
 * TIER_ORDER, an active full-access grant, the internal demo tier, or an admin) —
 * this module mirrors that predicate rather than inventing a second notion of
 * "paid", and it never starts the lazy trial on a read (the plan-gates rule).
 *
 * SERVER-ONLY (imports ~/db).
 */
import { sql } from "~/db";
import { TIER_ORDER, type TrialStatus } from "~/lib/trial";
import type { MatchKind } from "./join";
import type { TabulationBidderView, TabulationView } from "./copy";

export interface TabulationViewer {
  id: number;
  is_admin?: boolean | null;
}

/**
 * True when the viewer is entitled to the PUBLISHED PRICES: at or above Starter and
 * not expired, an active full-access grant, the internal demo tier, or an admin.
 * `expired` is honoured so a time-boxed grant stops unlocking prices when it lapses.
 */
export function hasTabulationPriceAccess(
  trial: Pick<TrialStatus, "fullAccess" | "planTier" | "expired"> | null | undefined,
  user?: { is_admin?: boolean | null } | null,
): boolean {
  if (user?.is_admin) return true;
  if (!trial) return false;
  if (trial.fullAccess) return true;
  if (trial.planTier === "demo" && !trial.expired) return true;
  return !!trial.planTier && !trial.expired && (TIER_ORDER[trial.planTier] ?? 0) >= TIER_ORDER.starter;
}

export interface BidTabulationResult {
  /** True when an ALDOT tabulation is attached to this bid at all. */
  present: boolean;
  /** True when prices were included in this payload. */
  pricesUnlocked: boolean;
  tabulation: TabulationView | null;
  bidders: TabulationBidderView[];
}

const EMPTY: BidTabulationResult = {
  present: false,
  pricesUnlocked: false,
  tabulation: null,
  bidders: [],
};

interface LinkRow {
  id: number;
  source: string;
  reference_number: string | null;
  project_number: string | null;
  agency: string | null;
  title: string | null;
  bid_opened_on: string | null;
  tabulation_type: string | null;
  bidders_count: number | null;
  low_amount: string | null;
  high_amount: string | null;
  source_url: string;
  source_published: string | null;
  scanned: boolean | null;
  extraction_note: string | null;
  match_kind: string;
  match_value: string;
}

/**
 * The tabulation attached to one bid, if any. The newest prior letting wins when a
 * bid has several links (a project let several times). Prices and bidder rows are
 * read ONLY when `includePrices` is true.
 */
export async function loadBidTabulation(
  bidId: number,
  includePrices: boolean,
): Promise<BidTabulationResult> {
  if (!Number.isInteger(bidId) || bidId <= 0) return EMPTY;
  let link: LinkRow | undefined;
  try {
    const rows = (await sql()`
      SELECT bt.id, bt.source, bt.reference_number, bt.project_number, bt.agency, bt.title,
             bt.bid_opened_on::text AS bid_opened_on, bt.tabulation_type, bt.bidders_count,
             bt.low_amount::text AS low_amount, bt.high_amount::text AS high_amount,
             bt.source_url, bt.source_published::text AS source_published, bt.scanned,
             bt.extraction_note, btl.match_kind, btl.match_value
      FROM bid_tabulation_links btl
      JOIN bid_tabulations bt ON bt.id = btl.tabulation_id
      WHERE btl.bid_id = ${bidId}
      ORDER BY bt.bid_opened_on DESC NULLS LAST, bt.id DESC
      LIMIT 1
    `) as LinkRow[];
    link = rows[0];
  } catch (err) {
    // No 059 tables in this environment (or any other read failure): no panel.
    console.error("[bid-tabulations] link read failed (rendering nothing):", (err as Error).message);
    return EMPTY;
  }
  if (!link) return EMPTY;
  const tabulation: TabulationView = {
    id: Number(link.id),
    source: String(link.source),
    reference_number: link.reference_number,
    project_number: link.project_number,
    agency: link.agency,
    title: link.title,
    bid_opened_on: link.bid_opened_on,
    tabulation_type: link.tabulation_type,
    bidders_count: link.bidders_count === null ? null : Number(link.bidders_count),
    low_amount: includePrices ? link.low_amount : null,
    high_amount: includePrices ? link.high_amount : null,
    source_url: String(link.source_url),
    source_published: link.source_published,
    scanned: link.scanned === true,
    extraction_note: link.extraction_note,
    match_kind: link.match_kind as MatchKind,
    match_value: String(link.match_value),
  };
  if (!includePrices) return { present: true, pricesUnlocked: false, tabulation, bidders: [] };
  let bidders: TabulationBidderView[] = [];
  try {
    const rows = (await sql()`
      SELECT bidder_name, bid_amount::text AS bid_amount
      FROM bid_tabulation_bidders
      WHERE tabulation_id = ${tabulation.id}
      ORDER BY id ASC
    `) as { bidder_name: string; bid_amount: string | null }[];
    bidders = rows.map((r) => ({ bidder_name: String(r.bidder_name), bid_amount: r.bid_amount }));
  } catch (err) {
    console.error("[bid-tabulations] bidder read failed (no bidder rows):", (err as Error).message);
  }
  return { present: true, pricesUnlocked: true, tabulation, bidders };
}

/**
 * The PUBLIC (anonymous/SSR) read: does this bid have a tabulation at all? It never
 * carries a price, a count or a bidder name — that is the whole point of the teaser.
 */
export async function hasBidTabulation(bidId: number): Promise<boolean> {
  const result = await loadBidTabulation(bidId, false);
  return result.present;
}
