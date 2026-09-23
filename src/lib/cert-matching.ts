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
 *      portals (PennBid, city open-data feeds) publish no federal set-aside
 *      metadata, and a small business may pursue them. ONLY genuine state/local
 *      sources qualify — a FEDERAL feed's NULL set-aside is never read as a
 *      state/local opportunity (PR-1, owner ruling f).
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
 * PR-1 RESTRUCTURE (owner-approved source-provenance policy, plan rev 315):
 * WHICH sources count as "state/local" for rule 3 is no longer a deny-list
 * maintained here — it is the class map in `source-class.ts`. The 51 state-name
 * keyword doors and the `cities` pass are FEDERAL (they query SAM.gov; the
 * state name is a search term), so their NULL set-asides now leave the
 * Small-Business pool exactly like `sam_gov`'s always did, and `md_dc` (a
 * retired federal label with 226 legacy rows) is INTERNAL rather than an
 * implicit state/local portal. Measured against production before the change:
 * 21,053 NULL-set-aside rows carried one of those 53 labels.
 *
 * PURE module: no ~/db import, no server fns, no node:*, no process.env at
 * import time. The sb SQL fragment is built by CALLERS via sbCertFragment
 * (mirrors trade-registry's caller-passes-sql-factory convention).
 */
import {
  FEDERAL_LABELS,
  FEDERAL_TRADE_LABELS,
  INTERNAL_SOURCE_LABELS,
  isStateLocalLabel,
} from "./source-class";

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
 * registering its label is a hard failure, not a silent regression of
 * rule 3 (which is what this module's doc always claimed, but only by comment).
 *
 * PR-1 RESTRUCTURE (owner-approved source-provenance policy, plan rev 315): the
 * literal list now lives in `source-class.ts` (`FEDERAL_TRADE_LABELS`), beside
 * every other source label's class, and is re-exported here BY IDENTITY so all
 * existing consumers keep the same import path and the same value.
 */
export const FEDERAL_TRADE_SOURCE_LABELS: readonly string[] = FEDERAL_TRADE_LABELS;

/**
 * Every FEDERAL ingest `source` label — 66 of them after the PR-1 restructure:
 * the national SAM.gov feed, the additive regional pass
 * (`sam_gov_regional`), the `cities` SAM.gov keyword pass, the
 * VA-place-of-performance federal pass (`va_evirginia`), the 11 structured
 * trade passes and the 51 state-name keyword doors. The doors and the two
 * keyword passes ARE federal: their state name / "City of" is a SAM.gov search
 * term, never a jurisdiction (approved policy rules R1–R3, conflict C1).
 * Consumers: the certification rule 3/5 decision below, the `sbCertFragment`
 * SQL window, and the Bid Alerts provenance badge (`sourceBadgeLabel`).
 */
export const FEDERAL_SOURCE_LABELS = new Set<string>([
  ...FEDERAL_TRADE_SOURCE_LABELS,
  ...FEDERAL_LABELS,
]);

/**
 * Source codes that are NOT codified state/local procurement portals: the 66
 * federal feeds above and every INTERNAL label (demo/seed/fixture feeds, the
 * retired `md_dc` federal-sync label, the dead `nyc_socrata` export). It is the
 * SQL window's deny-list — `sbCertFragment` below — so it must stay a SUPERSET
 * of the labels the JS rule (`isStateLocalSource`) keeps out of the
 * Small-Business pool; the JS rule is authoritative and simply drops anything
 * the window lets through.
 *
 * CONVENTION SUPERSEDED (PR-1): this list used to document that "adding a NEW
 * STATE SOURCE requires NO code change" — i.e. anything not on the deny-list
 * was ASSUMED state/local. The approved policy reverses that default (conflict
 * C7): an unclassified label is INTERNAL/unknown and is never treated as
 * state/local until it is validated and added to `source-class.ts`.
 */
export const NON_STATE_LOCAL_SOURCES = new Set<string>([
  ...FEDERAL_SOURCE_LABELS,
  ...INTERNAL_SOURCE_LABELS,
]);

/** Normalized-source form used by every predicate below (btrim + lowercase). */
function normalizeSource(source: string | null | undefined): string {
  return String(source ?? "").toLowerCase().trim();
}

/**
 * Rule 3: does this row belong to a STATE's own system or one CITY's own board —
 * i.e. a source whose NULL set-aside is a genuinely pursuable state/local
 * posting rather than a federal feed that simply published no set-aside?
 *
 * PR-1 RESTRUCTURE: class-driven (`source-class.ts`), not deny-list-driven. A
 * ROW IS INCLUDED when ANY of its persisted labels is state/local; an
 * UNCLASSIFIED label is INTERNAL/unknown and NOT state/local (conflict C7),
 * which is what makes the rule fail honest instead of pulling the 53
 * SAM-derived labels' NULL set-asides into the Small-Business pool (owner
 * ruling f: "a missing federal set-aside must never be interpreted as a
 * state/local small-business opportunity").
 */
export function isStateLocalSource(sources: string[]): boolean {
  return (sources ?? []).some((s) => isStateLocalLabel(s));
}

/**
 * Is this stored `source` a FEDERAL feed? The Bid Alerts badge used to test
 * `source === "sam_gov"` literally, so every other federal label
 * (sam_gov_regional, the 11 trade passes, the 51 doors, `cities`,
 * `va_evirginia`) rendered as "City" — a provenance-honesty miss on a
 * user-visible surface (QA N2) that the approved policy closes.
 * Strictly the REAL federal feeds (FEDERAL_SOURCE_LABELS): internal
 * demo/test feeds are NOT federal and render no badge at all.
 */
export function isFederalSource(source: string | null | undefined): boolean {
  return FEDERAL_SOURCE_LABELS.has(normalizeSource(source));
}

/**
 * The Bid Alerts provenance badge text — see `sourceBadgeLabel` in
 * `source-class.ts` (class-driven: "Federal" / "State (PA)" / the city name /
 * NO badge for an INTERNAL label). Re-exported here so the surface that has
 * always imported it from this module keeps one import path.
 */
export { NO_SOURCE_BADGE, sourceBadgeLabel, sourceBadgeTone } from "./source-class";
export type { SourceBadgeTone } from "./source-class";

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