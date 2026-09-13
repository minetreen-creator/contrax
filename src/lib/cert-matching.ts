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
 * Source codes that are NOT codified state/local procurement portals: the
 * federal SAM.gov feeds and internal/demo/test feeds. Every OTHER source is
 * treated as a state/local portal whose NULL set-asides are pursuable by a
 * small business (rule 3). Adding a NEW STATE SOURCE requires NO code change;
 * adding a NEW FEDERAL source must be listed here — documented so the 50-state
 * matrix cannot silently regress rule 3.
 */
export const NON_STATE_LOCAL_SOURCES = new Set<string>([
  "sam_gov",
  "sam_gov_regional",
  "contrax-demo",
  "seed",
  "fixture_test",
]);

export function isStateLocalSource(sources: string[]): boolean {
  return (sources ?? []).some(
    (s) => !NON_STATE_LOCAL_SOURCES.has(String(s ?? "").toLowerCase().trim()),
  );
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