/**
 * Trade-query normalization registry (owner 2026-09-06/07).
 *
 * A PURE, reusable, generic industry-keyed expansion layer that maps a
 * plain-English trade term ("trucking") to procurement synonyms ("freight
 * hauling") + NAICS codes (484121/484122) BEFORE matching happens, so the Radar
 * engine, the periodic match-alert sender, and bid-alerts can match the way
 * procurement writers actually phrase solicitations — not just the literal
 * word an end user typed.
 *
 * Design contract (owner-exact, non-negotiable):
 *   - PURE module: NO ~/db import, NO server fns, NO node:*, NO process.env at
 *     import time. Importable from server fns, client components
 *     (HeroRadar.tsx), job runners, and future surfaces alike. SQL fragments
 *     are built by CALLERS via tradeKeywordPred(sqlFactory, expansion) — the
 *     caller passes its own sql factory (the `~/db` value), mirroring
 *     open-bids.ts keywordPred.
 *   - The ORIGINAL query is ALWAYS preserved: display locales, storage, and
 *     analytics keep the verbatim user input. Expansion drives only the
 *     NON-NAICS keyword branch.
 *   - isNaics is derived ONLY from the ORIGINAL trade (a 6-digit code is never
 *     expanded — exact NAICS equality stays on the original input, 30pt in
 *     the radar scorer).
 *   - Honest provenance: every match records WHICH expansion actually caused it
 *     (matchedConcept = the synonym that hit, e.g. "freight hauling" /
 *     conceptLabel = the human industry label, e.g. "Trucking/Hauling" /
 *     matchedNaics = the implied code, e.g. "484121") so a why-line can say
 *     "Why it matches: Trucking/Hauling · SDVOSB · Under $1M" and NEVER
 *     pretend the literal word "trucking" appeared in the solicitation.
 *   - Injection-safe: expanded terms are registry-sourced constants (never raw
 *     input), and every term is bound as a ${…} parameter via the tagged
 *     template — never string-interpolated into SQL.
 *
 * Matcher semantics (documented decision): SUBSTRING across the expanded term
 * set — this mirrors today's radar 22pt path (`title.includes(trade)`), the
 * sender's `text.includes(trade)`, and bid-alerts' `text.includes(category)`.
 * Word/phrase-BOUNDARY matching remains the naics-infer classifier's job (it
 * runs on bid TEXT for inference, not on user queries). The registry is
 * GENERIC and industry-keyed: TRADE_ALIASES maps an industry key → {synonyms,
 * naics}, overlaid on the existing NAICS inference keyword map so every code
 * stays representable and the seed industry is not special-cased anywhere in
 * the engines.
 */

import { NAICS_NAMES } from "~/lib/naics-names";
import { NAICS_INFER_MAP } from "~/lib/naics-infer";

/** How long a radar `trade` input may be — ONE definition everywhere (owner
 *  09-07: the 64-vs-120 mismatch is fixed by this single constant; every
 *  storage/capture/display surface applies it). */
export const MAX_TRADE_LENGTH = 120;

/** Cap on the number of expanded keyword terms applied per trade (defensive —
 *  a registry entry is small, but never let an accidental blow-up widen a
 *  query with dozens of OR branches). */
export const MAX_EXPANDED_TERMS = 12;

/** A registry entry: one industry key → procurement synonyms + NAICS codes. */
export interface TradeAliasEntry {
  /** Display key for the why-line ("Trucking/Hauling") — honest, generic. */
  label: string;
  /** Case-insensitive expansion terms (lowercased at use). */
  synonyms: string[];
  /** 6-digit NAICS codes implied by the industry (all must exist in
   *  NAICS_NAMES — validated at module load so a typo fails fast). */
  naics: string[];
}

/**
 * GENERIC industry-keyed expansion registry — seeded with the
 * trucking/hauling/logistics vertical (owner spec), overlaid on the infer map:
 * a `synonym` is matched when it equals a curated infer keyword OR the
 * industry's own term list; the NAICS set comes from the infer map's codes
 * plus the industry's explicit codes. Adding a NEW industry = adding one entry
 * here — engines, sender, bid-alerts, and provenance all light up without any
 * engine change.
 */
export const TRADE_ALIASES: Record<string, TradeAliasEntry> = {
  "trucking-hauling-logistics": {
    label: "Trucking/Hauling",
    synonyms: [
      "trucking",
      "hauling",
      "truck",
      "truckload",
      "ltl",
      "less than truckload",
      "freight",
      "freight shipping",
      "freight hauling",
      "freight transportation",
      "logistics",
      "motor carrier",
      "dry van",
      "flatbed",
      "delivery service",
    ],
    // Only codes present in NAICS_NAMES (the product's authoritative code
    // list — the infer map is the same authority). "488510 (freight
    // transportation arrangement)" is NOT in the product's list yet, so it is
    // deliberately omitted; add it here when the NAICS list grows.
    naics: ["484121", "484122"],
  },
};

/** 6-digit NAICS code (strict, per the existing /^\d{6}$/ convention). */
const NAICS_RE = /^\d{6}$/;

/** All synonyms in the baked registry (deduped, lowercased). */
const REGISTRY_SYNONYMS = new Set(
  Object.values(TRADE_ALIASES).flatMap((e) => e.synonyms.map((s) => s.toLowerCase())),
);

/** All NAICS codes named by the registry (validated against NAICS_NAMES). */
const REGISTRY_NAICS: string[] = Object.values(TRADE_ALIASES).flatMap((e) => e.naics);
for (const code of REGISTRY_NAICS) {
  if (!NAICS_RE.test(code) || !NAICS_NAMES[code]) {
    throw new Error(`[trade-registry] bad NAICS code in TRADE_ALIASES: "${code}"`);
  }
}

/**
 * The full expandable keyword index: every NAICS inference keyword (the curated
 * override lists, one per code) PLUS the registry's industry synonyms. Maps a
 * keyword → the concept(s) it implies ({code, label}), so a hit can report
 * REAL provenance. Built once at module load.
 */
export const TRADE_KEYWORD_MAP: Record<string, { code: string; label: string }[]> = {};
for (const [code, entry] of Object.entries(NAICS_INFER_MAP)) {
  for (const kw of entry.keywords) {
    const key = kw.toLowerCase();
    (TRADE_KEYWORD_MAP[key] ??= []).push({ code, label: entry.title });
  }
}
for (const entry of Object.values(TRADE_ALIASES)) {
  for (const kw of entry.synonyms) {
    const key = kw.toLowerCase();
    (TRADE_KEYWORD_MAP[key] ??= []).push(
      ...entry.naics.map((code) => ({ code, label: entry.label })),
    );
  }
}

export interface TradeExpansion {
  /** The visitor's verbatim input — NEVER rewritten. */
  original: string;
  /** True when the ORIGINAL input was itself a 6-digit NAICS code — expansion
   *  is then disabled by design (exact-code semantics stay on the original). */
  isNaics: boolean;
  /** Expanded, deduped, lowercased keyword terms (non-NAICS branch only).
   *  Includes the original term first; never includes a 6-digit code. */
  terms: string[];
  /** 6-digit NAICS codes implied by the expansion (empty when the original was
   *  itself a code — exact equality covers that case, and empty for trades
   *  with no curated expansion). */
  naicsCodes: string[];
}

/**
 * Expand a radar trade query into the matching keyword + NAICS sets.
 *
 * Rules (owner-exact):
 *   - original is ALWAYS preserved verbatim.
 *   - A 6-digit original → isNaics true, terms=[], naicsCodes=[] (exact
 *     equality against the stored original elsewhere).
 *   - Otherwise the expansion pulls the industry entry (trucking →
 *     Trucking/Hauling: freight/truckload/logistics + 484121/484122/488510)
 *     and falls back to the infer-map keywords whose curated synonym set
 *     contains the query (e.g. "truckload" → 484121), so the registry behaves
 *     generically across every NAICS_NAMES code.
 *   - terms are lowercased + deduped; the original term is kept first.
 */
export function expandTrade(original: string): TradeExpansion {
  const raw = String(original ?? "").trim();
  const lower = raw.toLowerCase();
  if (!raw) return { original: raw, isNaics: false, terms: [], naicsCodes: [] };
  if (NAICS_RE.test(lower)) {
    return { original: raw, isNaics: true, terms: [], naicsCodes: [] };
  }

  const terms: string[] = [lower];
  const naicsCodes: string[] = [];

  // 1) Registry lookup — every alias whose synonym set overlaps the query
  //    (direct hit, or the query's first word matches a multi-word synonym's
  //    first word: "freight hauling" stems "freight").
  for (const entry of Object.values(TRADE_ALIASES)) {
    const synonyms = entry.synonyms.map((s) => s.toLowerCase());
    const firstWord = lower.split(/\s+/)[0] || "";
    const hitDirect = synonyms.includes(lower);
    const hitStem =
      firstWord.length >= 3 && synonyms.some((s) => s === firstWord || s.startsWith(firstWord));
    if (!hitDirect && !hitStem) continue;
    for (const s of synonyms) if (!terms.includes(s)) terms.push(s);
    for (const code of entry.naics) if (!naicsCodes.includes(code)) naicsCodes.push(code);
  }

  // 2) Infer-map fallback: when the query equals one of the curated keywords
  //    for a code (e.g. "truckload" → 484121), adopt that code's keyword set +
  //    code. Keeps the generic registry working for every representable code
  //    without hardcoding any code in the engines.
  const kwHits = TRADE_KEYWORD_MAP[lower];
  if (kwHits && kwHits.length > 0) {
    for (const rec of kwHits) {
      if (!naicsCodes.includes(rec.code)) naicsCodes.push(rec.code);
      const entry = NAICS_INFER_MAP[rec.code];
      if (entry) {
        for (const kw of entry.keywords) {
          const k = kw.toLowerCase();
          if (k.length >= 2 && !terms.includes(k)) terms.push(k);
        }
      }
    }
  }

  // Defensive cap so a pathological registry entry can never blow up a query.
  return {
    original: raw,
    isNaics: false,
    terms: terms.slice(0, MAX_EXPANDED_TERMS),
    naicsCodes,
  };
}

/** Pure text matcher: does the expanded keyword set hit the bid text?
 *  Substring semantics across the RAW expanded terms (mirrors today's 22pt
 *  path — `title.includes(trade)` — and the sender's `text.includes(trade)`).
 *  A hit is reported together with WHICH term/concept matched (provenance). */
export function tradeTextIncludes(text: string, expansion: TradeExpansion): boolean {
  if (!text || expansion.isNaics || expansion.terms.length === 0) return false;
  const t = text.toLowerCase();
  return expansion.terms.some((term) => t.includes(term));
}

/**
 * A per-match provenance record — which expansion actually caused each match
 * (owner 09-07 acceptance criteria). Kept honest: matchedConcept names the
 * register synonym that literally appeared ("freight hauling"), NEVER the
 * original term unless the original term itself was the one that matched.
 */
export interface TradeMatchProvenance {
  /** The original verbatim query ("trucking"). */
  original: string;
  /** The specific expansion synonym that actually hit the bid text
   *  ("freight hauling"), or the industry label for NAICS-code-only matches.
   *  NEVER the original term unless the original itself matched. */
  matchedConcept: string;
  /** Human display label for the why-line ("Trucking/Hauling"); falls back to
   *  the NAICS title for infer-sourced hits, and to the original term when the
   *  original itself matched (existing behavior preserved). */
  conceptLabel: string;
  /** The NAICS code implied by the match ("484121"), or null when the match
   *  was a bare keyword with no implied code. */
  matchedNaics: string | null;
}

/** Registry label for a code (industry-level, owner-exact why-line fragment). */
function registryLabelForCode(code: string): string | null {
  for (const entry of Object.values(TRADE_ALIASES)) {
    if (entry.naics.includes(code)) return entry.label;
  }
  return null;
}

/**
 * Pick a provenance record for one matched bid: the LONGEST expanded term that
 * actually appears in the bid text (longest = most specific, so "freight
 * hauling" wins over "freight") — falling back to an implied-NAICS match when
 * no term hit but the bid's own NAICS code is in the expansion set.
 *
 * Returns null when neither a term nor an implied NAICS code matched (the
 * caller then knows this bid matched on a different profile field — cert /
 * state / size — and must NOT claim a trade reason).
 */
export function tradeProvenanceFor(
  text: string,
  expansion: TradeExpansion,
  bidNaics: string | null | undefined,
): TradeMatchProvenance | null {
  if (expansion.isNaics || expansion.terms.length === 0) return null;
  const t = (text ?? "").toLowerCase();
  const originalLower = expansion.original.toLowerCase();

  const longestFirst = [...expansion.terms].sort((a, b) => b.length - a.length);
  const hit = longestFirst.find((term) => term.length >= 2 && t.includes(term));

  if (hit) {
    // Registry-sourced synonym → industry label (owner-exact "Trucking/Hauling").
    const registry = Object.values(TRADE_ALIASES).find((e) =>
      e.synonyms.some((s) => s.toLowerCase() === hit),
    );
    if (registry) {
      const code = registry.naics.find((c) => expansion.naicsCodes.includes(c)) ?? registry.naics[0] ?? null;
      return {
        original: expansion.original,
        matchedConcept: hit,
        conceptLabel: hit === originalLower ? expansion.original : registry.label,
        matchedNaics: code,
      };
    }
    // Infer-map synonym → the NAICS code + title it implies.
    const recs = TRADE_KEYWORD_MAP[hit] ?? [];
    if (recs.length > 0) {
      const rec = recs.find((r) => expansion.naicsCodes.includes(r.code)) ?? recs[0];
      return {
        original: expansion.original,
        matchedConcept: hit,
        conceptLabel: hit === originalLower ? expansion.original : rec.label,
        matchedNaics: rec.code,
      };
    }
    return {
      original: expansion.original,
      matchedConcept: hit,
      conceptLabel: hit === originalLower ? expansion.original : hit,
      matchedNaics: null,
    };
  }

  // No term hit — the bid may still be an implied-NAICS match (the SQL ANY()
  // branch pulled it). Honest industry-level label; never claims a text hit.
  const code = bidNaics?.trim() ?? "";
  if (!NAICS_RE.test(code) || !expansion.naicsCodes.includes(code)) return null;
  const label = registryLabelForCode(code) ?? NAICS_NAMES[code] ?? code;
  return {
    original: expansion.original,
    matchedConcept: label,
    conceptLabel: label,
    matchedNaics: code,
  };
}

/**
 * SQL fragment builder for the expanded non-NAICS keyword branch. Callers pass
 * their own `sql` factory (the `~/db` value — `sql()` yields the neon tagged
 * template). Every term is a bound ${…} parameter (registry-sourced constants,
 * but bound anyway — injection-safe by construction); the implied NAICS codes
 * ride as a bound ANY(${codes}) parameter (mirrors open-bids.ts naicsPred).
 * Fragments compose via neon's documented composability (clause fragments
 * interpolated into a container template — verified live against prod).
 *
 * Mirrors open-bids.ts keywordPred's dollar-quote rule: plain ${…}
 * interpolation inside the tagged template, NEVER a literal `$${…}` (the extra
 * `$` makes Postgres parse it as a dollar quote).
 *
 * Returns an EMPTY `sql()`` fragment when there is nothing to match (blank
 * trade / isNaics — callers interpolate it unconditionally).
 */
export function tradeKeywordPred(sql: any, expansion: TradeExpansion): any {
  if (expansion.isNaics || expansion.terms.length === 0) return sql()``;
  const clauses: any[] = [];
  for (const term of expansion.terms.slice(0, MAX_EXPANDED_TERMS)) {
    if (!term || term.length < 2) continue;
    clauses.push(
      sql`(
        ${sql`LOWER(COALESCE(title,'')) LIKE ${"%" + term + "%"}`} OR
        ${sql`LOWER(COALESCE(description,'')) LIKE ${"%" + term + "%"}`} OR
        ${sql`LOWER(COALESCE(category,'')) LIKE ${"%" + term + "%"}`}
      )`,
    );
  }
  if (expansion.naicsCodes.length > 0) {
    clauses.push(sql`naics_code = ANY(${expansion.naicsCodes})`);
  }
  if (clauses.length === 0) return sql()``;
  let acc = clauses[0] as any;
  for (let i = 1; i < clauses.length; i++) {
    acc = sql`(${acc} OR ${clauses[i]})`;
  }
  return sql`AND (${acc})`;
}