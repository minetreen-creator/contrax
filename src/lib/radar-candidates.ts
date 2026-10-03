/**
 * The Radar's DEFAULT-match pipeline, shared by the scan (runRadarScan in
 * routes/radar.tsx) and the share-card page (routes/r.$trade.$state.tsx), so a
 * shared link's "N open contracts" always equals what the visitor then sees
 * (owner 2026-10-03). Extracted verbatim from runRadarScan; behavior unchanged.
 *
 *   1. fetchStrictRadarRows: strict keyword/NAICS query (+ state pass) and the
 *      R5 notice dedupe;
 *   2. radarRowPasses: cert decision, contradictory-location exclusion and
 *      state relevance (the JS geography authority);
 *   3. isStrongTradeMatch (trade-registry): only title/NAICS-corroborated rows
 *      are default matches.
 */
import { setAsidePred } from "~/lib/open-bids";
import { certMatches, sbCertFragment } from "~/lib/cert-matching";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { geoRelevant, locationConflict, resolveBidState } from "~/lib/location-state";
import { collapseScanRows, loadNoticeDedupeKeys, runKeywordScanQuery } from "~/lib/radar-scan-query";
import { expandTrade, isStrongTradeMatch, tradeKeywordPred, type TradeExpansion } from "~/lib/trade-registry";

export interface StrictRadarRows {
  rows: any[];
  isNaics: boolean;
  expansion: TradeExpansion;
}

/** Strict scan rows for (trade, state, cert), de-duplicated. Throws RadarScanError on query failure. */
export async function fetchStrictRadarRows(
  sql: any,
  o: { trade: string; state: string; certId: string },
): Promise<StrictRadarRows> {
  const { trade, state, certId } = o;
  const isNaics = /^\d{6}$/.test(trade);
  const expansion = expandTrade(trade);
  // Set-aside predicate fragment (PR-C.0, owner 09-13: Small Business
  // DESCRIBES the user's business — the sb branch admits explicit SBA/
  // small-business markers, unrestricted rows, and state/local rows whose
  // portal publishes no set-aside metadata. The text-level include/exclude
  // decision runs in JS via the same certMatches predicate. Non-sb certs keep
  // their literal set_aside patterns UNCHANGED (mirrors /trades).
  const certFrag = certId === "sb" ? sbCertFragment(sql) : setAsidePred(certId, sql);
  // Trade/NAICS predicate: exact NAICS equality when a 6-digit code is given,
  // otherwise the EXPANDED keyword set (trade-registry). Every term is a bound
  // parameter (injection-safe by construction).
  const tradeFrag = isNaics
    ? sql()`AND LOWER(COALESCE(naics_code,'')) = ${trade.toLowerCase()}`
    : trade
      ? tradeKeywordPred(sql, expansion)
      : sql()``;
  const raw = await runKeywordScanQuery(sql, { certFrag, tradeFrag }, LOW_CONTENT_SQL, state || null);
  // R5 DEDUPE (QA F2): collapse the SAME notice re-ingested under several
  // source labels BEFORE scoring/ranking, so duplicates cannot fill the cap.
  // Fail-soft key read — see ~/lib/notice-dedupe.
  const collapsed = await collapseScanRows(raw, (ids) => loadNoticeDedupeKeys(sql, ids));
  if (collapsed.collapsed > 0) {
    console.log(
      `[radar] dedupe: ${raw.length} rows → ${collapsed.rows.length} distinct notices (${collapsed.collapsed} collapsed; keyed by ${collapsed.noticeKeyColumns ? "solicitation_number + notice_type else (title,agency,notice_type)" : "(title,agency,notice_type) — notice-key columns unavailable"})`,
    );
  }
  return { rows: collapsed.rows, isNaics, expansion };
}

/**
 * Cert decision FIRST (D16 read-path order), then the contradictory-location
 * exclusion (owner 09-13) and state relevance — computed from existing fields.
 */
export function radarRowPasses(r: any, certId: string, state: string): boolean {
  if (certMatches(r.set_aside, [r.source], certId as any) !== "include") return false;
  const resolved = resolveBidState(r.location, r.agency);
  if (locationConflict(r.title, r.description, resolved)) return false;
  return geoRelevant(r.location, r.agency, state);
}

/** The default (strong) matches, in due-date order. Used for counts; the scan ranks by score itself. */
export async function defaultRadarMatches(
  sql: any,
  o: { trade: string; state: string; certId?: string },
): Promise<any[]> {
  const certId = o.certId ?? "sb";
  const { rows, expansion } = await fetchStrictRadarRows(sql, { trade: o.trade, state: o.state, certId });
  // Same field coercion and the same isStrongTradeMatch call as runRadarScan.
  return rows
    .filter((r) => radarRowPasses(r, certId, o.state))
    .filter((r) =>
      isStrongTradeMatch(
        String(r.title ?? ""),
        r.category ? String(r.category) : null,
        r.description ? String(r.description) : null,
        r.naics_code ? String(r.naics_code) : null,
        expansion,
      ),
    );
}
