/**
 * CERTIFICATION MATCHING SEMANTICS — PR-C.0 (owner 09-13).
 *
 * Owner verbatim: "Small Business" DESCRIBES THE USER'S BUSINESS — it is NOT a
 * requirement that every opportunity be formally reserved as an SBA set-aside.
 * A small business may pursue unrestricted opportunities or state/local
 * postings whose portal publishes no federal set-aside metadata.
 *
 * DECISION TABLE for the radar certification filter (`sb` branch):
 *   1. INCLUDE rows that explicitly name SBA / small-business set-asides
 *      (incl. the plain 'SBA' value on the Salem VA row).
 *   2. INCLUDE unrestricted / full-and-open rows.
 *   3. INCLUDE state/local rows whose set-aside is UNAVAILABLE (NULL): local
 *      portals (PennBid, city/state open-data feeds) publish no federal
 *      set-aside metadata, and a small business may pursue them.
 *   4. EXCLUDE rows whose set-aside text names ONLY certifications the user
 *      does NOT hold (e.g. an 8(a)-only set-aside never appears under a plain
 *      Small Business selection). Rows naming the user's cert — or carrying
 *      unrestricted/unknown markers — stay in.
 *   5. A NULL set-aside NEVER becomes a "Small Business" label: cards show
 *      SET_ASIDE_NOT_SPECIFIED_LABEL instead ("Set-aside not specified —
 *      verify solicitation"); the stored value is never written/fabricated
 *      (that label also directs verification — we never claim all state/local
 *      solicitations are automatically SMB-eligible).
 *
 * Return values: "include" (row belongs under the selected cert), "exclude"
 * (row is explicitly restricted to a certification the user lacks), or null
 * (NO OPINION — a NULL set-aside from a federal/unknown source; the radar
 * query keeps today's behavior and excludes it, so the 1,200+ federal
 * NULL-set-aside rows do not flood the Small Business pool).
 *
 * Non-`sb` certs (8a/sdvosb/wosb/hubzone/vosb) keep their current exact-match
 * behavior UNCHANGED (the same literal patterns as open-bids setAsidePred).
 *
 * PURE module: no ~/db import, no server fns, no node:*, no process.env at
 * import time. The sb SQL fragment is built by CALLERS via sbCertFragment
 * (mirrors trade-registry's caller-passes-sql-factory convention).
 */

/** Exact honest label for cards whose set-aside is unavailable (rule 5). */
export const SET_ASIDE_NOT_SPECIFIED_LABEL =
  "Set-aside not specified — verify solicitation";

export type CertMatch = "include" | "exclude" | null;

/**
 * The 11 structured-filter trade passes added by the janitorial + trucking
 * ingestion PR (owner PRIORITY 09-21) — one SAM.gov `source` label per pass.
 * They are FEDERAL feeds: every one of them asks SAM.gov for notices carrying a
 * federal NAICS/PSC code, so a NULL set-aside there means "the federal source
 * published no set-aside metadata", NOT "a state/local portal with no federal
 * set-aside field". QA re-verification (N2) found them missing from
 * NON_STATE_LOCAL_SOURCES, which pulled federal NULL-set-aside rows into the
 * Small-Business pool and made Bid Alerts render them as "City".
 *
 * SINGLE SOURCE OF TRUTH: `sam-gov-trades.ts` (`SAM_TRADE_FILTERS[].name`) is
 * VALIDATED AGAINST THIS LIST AT MODULE LOAD — adding a 12th trade pass without
 * registering its label here is a hard failure, not a silent regression of
 * rule 3 (which is what this module's doc always claimed, but only by comment).
 */
export const FEDERAL_TRADE_SOURCE_LABELS: readonly string[] = [
  "sam_naics_561720",
  "sam_psc_s201",
  "sam_naics_484110",
  "sam_naics_484121",
  "sam_naics_484122",
  "sam_naics_484210",
  "sam_naics_484220",
  "sam_naics_484230",
  "sam_naics_492110",
  "sam_psc_v112",
  "sam_psc_r602",
];

/**
 * Every FEDERAL (or internal test) ingest `source` label: the national SAM.gov
 * feed, the regional SAM.gov feed, and the 11 structured-filter trade passes.
 * Consumers: the certification rule 3/5 decision below, the `sbCertFragment`
 * SQL window, and the Bid Alerts Federal/City badge (`sourceBadgeLabel`).
 */
export const FEDERAL_SOURCE_LABELS = new Set<string>([
  "sam_gov",
  "sam_gov_regional",
  ...FEDERAL_TRADE_SOURCE_LABELS,
]);

/**
 * Source codes that are NOT codified state/local procurement portals: the
 * federal SAM.gov feeds (incl. the 11 trade passes) and internal/demo/test
 * feeds. Every OTHER source is treated as a state/local portal whose NULL
 * set-asides are pursuable by a small business (rule 3). Adding a NEW STATE
 * SOURCE requires NO code change; adding a NEW FEDERAL source must be listed
 * here — ENFORCED (see FEDERAL_TRADE_SOURCE_LABELS above), so the 50-state
 * matrix cannot silently regress rule 3.
 */
export const NON_STATE_LOCAL_SOURCES = new Set<string>([
  ...FEDERAL_SOURCE_LABELS,
  "contrax-demo",
  "seed",
  "fixture_test",
]);

/** Normalized-source form used by every predicate below (btrim + lowercase). */
function normalizeSource(source: string | null | undefined): string {
  return String(source ?? "").toLowerCase().trim();
}

export function isStateLocalSource(sources: string[]): boolean {
  return (sources ?? []).some((s) => !NON_STATE_LOCAL_SOURCES.has(normalizeSource(s)));
}

/**
 * Is this stored `source` a FEDERAL feed? The Bid Alerts badge used to test
 * `source === "sam_gov"` literally, so every other federal label
 * (sam_gov_regional, and the 11 trade passes) rendered as "City" — a
 * provenance-honesty miss on a user-visible surface (QA N2).
 * Strictly the REAL federal feeds (FEDERAL_SOURCE_LABELS): the internal
 * demo/test feeds stay in the pre-existing branch below rather than being
 * relabelled "Federal".
 */
export function isFederalSource(source: string | null | undefined): boolean {
  return FEDERAL_SOURCE_LABELS.has(normalizeSource(source));
}

/**
 * The Bid Alerts provenance badge text. "Federal" for a real federal feed (see
 * isFederalSource); "City" for everything else — the pre-existing state/local
 * branch, kept byte-identical for the sources it already covered (pennbid,
 * va_evirginia, oh, cities, internal test feeds) so this fix adds no new claim.
 */
export function sourceBadgeLabel(source: string | null | undefined): "Federal" | "City" {
  return isFederalSource(source) ? "Federal" : "City";
}

/** Explicit SBA / small-business markers (rule 1). */
const SB_NAMED_RE = /sba|small business/;
/** Unrestricted / full-and-open markers (rule 2). */
const UNRESTRICTED_RE = /unrestricted|full\s*&\s*open|full and open|full&open/;
/** Certification codes a plain Small Business selection does NOT hold (rule 4)
 *  — the same literal families as open-bids setAsidePred (8(a)/8AN, SDVOSB,
 *  WOSB/EDWOSB, HUBZone, VOSB). */
const EXCLUSIVE_CERT_RE = /8\(a\)|8an|sdvosb|edwosb|wosb|hubzone|vosb/;

/** Certification-predicate decision. Pure; shared by the radar query builder
 *  (post-query filter) and the card-label logic. */
export function certMatches(
  setAside: string | null,
  sources: string[],
  selectedCert: string,
): CertMatch {
  const s = String(setAside ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  // Non-sb certs: exact-match behavior UNCHANGED (open-bids patterns).
  if (selectedCert !== "sb") {
    const pats: Record<string, string[]> = {
      "8a": ["8(a)", "8an"],
      sdvosb: ["sdvosb"],
      wosb: ["wosb", "edwosb"],
      hubzone: ["hubzone"],
      vosb: ["vosb"],
    };
    return (pats[selectedCert] ?? []).some((p) => s.includes(p))
      ? "include"
      : "exclude";
  }
  // Rules 3 + 5: NULL set-aside → state/local source → include; federal /
  // unknown source → no opinion (the radar query keeps today's exclusion; the
  // card label never fabricates a certification value).
  if (s.length === 0) return isStateLocalSource(sources) ? "include" : null;
  // Rule 1: explicitly names SBA / small-business set-aside.
  if (SB_NAMED_RE.test(s)) return "include";
  // Rule 2: unrestricted / full-and-open.
  if (UNRESTRICTED_RE.test(s)) return "include";
  // Rule 4: names ONLY certifications the user lacks → exclude.
  if (EXCLUSIVE_CERT_RE.test(s)) return "exclude";
  // Rule 4 tail: no exclusive restriction (unknown/other markers) → include.
  return "include";
}

/**
 * SQL fragment for the `sb` branch of the radar query builder. It ONLY bounds
 * the candidate window — any row with set-aside text (the text-level include/
 * exclude rules run in JS via certMatches, which stays authoritative) plus
 * NULL set-asides from non-federal sources. Federal NULL-set-aside rows stay
 * excluded exactly as today (`set_aside IS NOT NULL` pre-PR-C.0).
 * Sources are hardcoded constants (never user input) → injection-safe.
 */
export function sbCertFragment(sql: any): any {
  const vals = Array.from(NON_STATE_LOCAL_SOURCES)
    .map((s) => `'${s}'`)
    .join(", ");
  return sql()`AND (${sql().unsafe(
    `set_aside IS NOT NULL OR LOWER(COALESCE(source,'')) NOT IN (${vals})`,
  )})`;
}

/**
 * HONEST card label for a row's set-aside status (rule 5): never convert a
 * NULL set-aside into a certification claim. NULL → the exact
 * SET_ASIDE_NOT_SPECIFIED_LABEL ("Set-aside not specified — verify
 * solicitation"); otherwise the real set-aside text exactly as stored.
 */
export function setAsideCardLabel(setAside: string | null): string {
  const t = String(setAside ?? "").trim();
  return t.length > 0 ? t : SET_ASIDE_NOT_SPECIFIED_LABEL;
}