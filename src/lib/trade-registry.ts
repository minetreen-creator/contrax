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

/**
 * OWNER PRECISION CONSTRAINT (09-07) — structurally enforced.
 *
 * Ultra-generic trade words that are NEVER sufficient alone as a match term.
 * Expansion must increase recall while REQUIRING meaningful category/NAICS
 * evidence; a bare generic word ("transport", "delivery") that could appear in
 * ANY solicitation must never carry a match by itself.
 *
 * Enforcement is single-point: expandTrade() filters these out of
 * expansion.terms, so tradeTextIncludes / tradeProvenanceFor /
 * tradeKeywordPred all inherit the rule for free — no downstream matcher can
 * ever match on a generic word alone, even if a FUTURE registry entry lists
 * one as a synonym. The evidence paths stay open: specific terms
 * (freight, truckload, hauling, ltl, ...) match on text, and the implied
 * NAICS codes match via the naics_code = ANY() branch.
 *
 * Deliberately NOT blocked: "freight" (specific trucking/NAICS-484121 word,
 * not generic to procurement) and specific multi-word phrases that merely
 * CONTAIN a generic word ("freight transportation", "delivery service",
 * "motor carrier" — phrase-substring hits are specific enough to keep).
 * The visitor's VERBATIM original term is also never filtered (terms[0]) —
 * a literal query keeps today's precision/behavior; only ADDED synonyms are
 * subject to the blocklist. When in doubt, this list errs toward precision.
 */
export const GENERIC_TRADE_TERMS: Set<string> = new Set([
  "transport",
  "transportation",
  "delivery",
  "deliveries",
  "deliver",
  "delivering",
  "shipping",
  "ship",
  "shipped",
  "moving",
  "move",
  "mover",
  "movers",
  "carrier",
  "carriers",
  "truck",
  "trucks",
  "logistics",
  "cleaning",
  "service",
  "services",
  "support",
  "supply",
  "supplies",
]);

/** A registry entry: one industry key → procurement synonyms + NAICS codes. */
export interface TradeAliasEntry {
  /** Display key for the why-line ("Trucking/Hauling") — honest, generic. */
  label: string;
  /** Case-insensitive expansion terms (lowercased at use). */
  synonyms: string[];
  /** 6-digit NAICS codes implied by the industry (all must exist in
   *  NAICS_NAMES — validated at module load so a typo fails fast). */
  naics: string[];
  /** OWNER 09-15 (arrangement-intent): when true, ONLY exact synonym hits
   *  resolve to this entry — the first-word prefix STEM never applies. Used by
   *  the Logistics trade: NAICS 488510 "Freight Transportation Arrangement" is
   *  for businesses that ARRANGE freight (brokers/forwarders/3PLs), so 488510
   *  must bind only for the exact arrangement phrases ("freight broker",
   *  "freight forwarder", "3PL", "third party logistics", …). A generic
   *  "freight <noun>" query must NOT inherit this entry via the stem — bare
   *  "freight" is a CARRIER business (trucking), not an arranger. */
  exactOnly?: boolean;
}
/**
 * RELATED-work concept terms (owner v6.1): adjacent work is NEVER a default
 * janitorial/trucking match — these terms drive ONLY the explicitly labeled
 * "Related opportunities" section. Remediation/specialty cleaning and
 * epoxy-floor installation are NOT substitutes for routine custodial services,
 * so they must never satisfy a "janitorial" search; they surface in the
 * related section when their row is open and located in the requested state.
 */
export const RELATED_TRADE_TERMS: Record<string, string[]> = {
  janitorial: [
    "remediation",
    "specialty cleaning",
    "epoxy",
    "floor coating",
    "floor installation",
    "abatement",
    "mold remediation",
  ],
  trucking: [
    "moving services",
    "warehousing",
    "storage and distribution",
    "equipment relocation",
  ],
};

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
  "trucking-hauling": {
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
      "motor carrier",
      "equipment transport",
      "dry van",
      "flatbed",
    ],
    // Owner 09-13 breadth expansion: full trucking-adjacent NAICS family. All
    // codes are present in NAICS_NAMES (module-load validation enforces it).
    // Owner 09-14 task: + 484220 Specialized Freight (except Used Goods)
    // Trucking, Local (real code) — "hauling" is registered as a searchable
    // Trucking term (it already resolves here via the synonym list) and now also
    // implies the LOCAL specialized-freight code 484220 alongside the kept
    // codes 484110/484121/484122/484230. 492110 stays (owner-ratified 09-13
    // breadth): 492110 is therefore deliberately implied by BOTH trucking and
    // the Delivery trade below — 492110-family rows on a TRUCKING scan keep
    // their documented "Related logistics — courier delivery" subtype, while on
    // a DELIVERY scan they are the intended default (see tradeExpresslyCourier).
    // Owner 09-15: the term "logistics" was REMOVED from this entry's synonyms
    // (it is its own trade now, implying 488510 only) and "delivery service" was
    // MOVED to the Delivery trade (so a bare "delivery" query can never stem
    // into the trucking code set) — the freight-trucking codes stay exactly as
    // they were. Key renamed trucking-hauling-logistics → trucking-hauling to
    // match what the entry now covers.
    naics: ["484110", "484121", "484122", "484220", "484230", "492110"],
  },
  // Owner 09-13 (radar zero-results): janitorial vertical. The term set is the
  // owner's exact curated procurement language — deliberately NO bare
  // "cleaning" (ultra-generic: "ROD,CLEANING,SMALL ARM" is munitions work, not
  // janitorial). The precision filter below (GENERIC_TRADE_TERMS) enforces the
  // same rule structurally for every registry entry.
  "janitorial-cleaning-services": {
    label: "Janitorial/Cleaning",
    synonyms: [
      "janitorial",
      "custodial",
      "commercial cleaning",
      "building cleaning",
      "housekeeping",
      "floor care",
      "carpet cleaning",
      "restroom sanitation",
      "window cleaning",
    ],
    naics: ["561720"],
  },
  /**
   * OWNER 09-15/09-16 — LANDSCAPING → NAICS 561730 Landscaping Services
   * (real Census code, owner's everyday-service set).
   *
   * Same curated procurement treatment janitorial already had: the language
   * procurement actually uses for this work ("lawn care", "lawn mowing",
   * "grounds maintenance", "snow removal", …) resolves HERE, to 561730, and to
   * no other code. The synonym set is deliberately a SUPERSET of the
   * pre-existing naics-infer keywords for 561730 (landscaping, landscape,
   * landscaper, lawn, grounds maintenance, grounds keeping, snow removal), so a
   * "landscaping" scan keeps every term it already matched on — recall can only
   * grow, never shrink — and the first-word stem additionally lets the real
   * query forms "landscaping services" / "snow plowing" / "lawn mowing" resolve.
   *
   * Precision note (same rule as janitorial, which keeps no bare "cleaning"):
   * the generic words are already structurally filtered by GENERIC_TRADE_TERMS
   * (whole-term match), and no synonym here is a word that could carry a match
   * on its own outside landscape work.
   */
  "landscaping-grounds": {
    label: "Landscaping/Grounds",
    synonyms: [
      "landscaping",
      "landscape",
      "landscaper",
      "lawn",
      "lawn care",
      "lawn maintenance",
      "lawn mowing",
      "grounds maintenance",
      "grounds keeping",
      "groundskeeping",
      "snow removal",
    ],
    naics: ["561730"],
  },
  /**
   * OWNER 09-15/09-16 — SECURITY GUARDS → NAICS 561612 Security Guards and
   * Patrol Services (real Census code, owner's everyday-service set).
   *
   * `exactOnly` (the same mechanism the owner's 09-15 arrangement-intent ruling
   * put on Logistics/488510). "security" on its own is GENERIC: it is a
   * category stamp on everything from market research to food delivery — those
   * are exactly the rows #387 had to demote — and the prefix stem on "guard"
   * would also drag in guardrail/guard-station procurement, which is
   * construction work, not protective services. So this trade binds ONLY for
   * the exact guard-intent phrases below; a bare "security" (or "guards",
   * "patrol") query keeps EXACTLY today's behavior (verbatim-text matching plus
   * the pre-existing 561612 infer keywords), and nothing can inherit this entry
   * through the stem.
   *
   * SEPARATION — 561612 vs 561621 (owner 09-15):
   *   561612 Security Guards and Patrol Services = PEOPLE who guard
   *     (guards / officers / patrols / armed / unarmed / badge guards);
   *   561621 Security Systems Services = SYSTEMS
   *     (security systems, access control, CCTV, surveillance, alarm systems).
   * Not one synonym here mentions a system, an alarm, access control, CCTV or
   * surveillance, and no 561621 phrase is an exact synonym of this entry — so
   * the two payloads are disjoint in BOTH directions (proven at payload level
   * in the regression suite).
   *
   * The list is deliberately held at 8 phrases: expansion terms are capped at
   * MAX_EXPANDED_TERMS (12) and the two guard phrases that are ALSO infer
   * keywords ("security guard", "armed guard") additionally inherit the infer
   * keyword set — keeping the curated list at 8 means no previously-matched term
   * is ever pushed out of the cap. Plural/query variants of a multi-word phrase
   * ("security officers", "armed guards") are covered by substring matching of
   * the singular term; the plural QUERY forms users actually type are listed.
   */
  "security-guards-patrol": {
    label: "Security Guards/Patrol",
    exactOnly: true,
    synonyms: [
      "security guard",
      "security guards",
      "security officer",
      "guard services",
      "armed guard",
      "armed guards",
      "unarmed guard",
      "badge guard",
    ],
    naics: ["561612"],
  },
  /**
   * OWNER 09-16 — FACILITIES SUPPORT → NAICS 561210 Facilities Support Services
   * (real Census code; the 4th of the owner's five everyday-service codes named
   * 09-15 — the set the old 120-code datalist window cut off).
   *
   * Same curated procurement treatment janitorial/landscaping/security already
   * had: the language procurement actually uses for base/facility OPERATIONS
   * MANAGEMENT ("facilities support", "facilities management", "integrated
   * facilities", "base operations support", …) resolves HERE, to 561210, and to
   * no other code. The first-word stem additionally lets the real query forms
   * ("facilities support services", "facility operations services", "base
   * operations support services") resolve, exactly as landscaping's stem
   * resolves "snow plowing".
   *
   * SUPERSET of the pre-existing 561210 infer keywords (recall can only grow):
   * four of the five are curated synonyms here — facilities support, facilities
   * management, building maintenance, integrated facilities. The fifth,
   * "janitorial management", is deliberately NOT repeated in this entry even
   * though the infer map maps it to 561210: its first word is a stem into the
   * JANITORIAL entry ("janitorial"), so making it an exact synonym here would
   * (a) strip 561720 from that phrase and (b) pull 561210 into a plain "janitor"
   * query — the exact bleed this entry must not create. It keeps resolving to
   * 561210 through the infer map, unchanged (pinned in the regression suite), and
   * the superset rule's purpose still holds structurally: every curated
   * facilities phrase's expansion carries all five 561210 infer keywords,
   * because the implied code 561210 pulls its infer keyword list (asserted).
   *
   * SEPARATION — 561210 vs 561720 (janitorial) vs 561110 (office admin):
   *   561210 = BROAD base-operations / facility-operations MANAGEMENT
   *     (facilities / facility management, integrated facilities, facilities
   *     and base operations, facilities maintenance, building maintenance);
   *   561720 Janitorial Services = the CLEANING work itself
   *     (custodial, commercial cleaning, floor care, restroom sanitation,
   *     window cleaning, …);
   *   561110 Office Administrative Services = office admin
   *     (office administrative, administrative services, office services).
   * Not one synonym here is a cleaning-service phrase and not one 561720/561110
   * phrase is an exact synonym of this entry, so the payloads are disjoint in
   * BOTH directions (proven at payload level in the regression suite).
   *
   * Precision: no synonym is a bare "facilities" or "maintenance" (the same rule
   * that keeps janitorial free of bare "cleaning") — every term is a compound
   * phrase procurement actually writes, and GENERIC_TRADE_TERMS structurally
   * filters whole-term generics out of the match set. The list is held at 8
   * compound phrases so that no OTHER query's 12-term expansion cap is disturbed
   * — the 437-query before/after diff shows zero code losses and zero term
   * losses everywhere except the one documented phrase below.
   *
   * DOCUMENTED SIDE EFFECT of exact-hit-wins (see expandTrade): "building
   * maintenance" is BOTH a curated synonym here and a first-word stem into the
   * janitorial entry ("building cleaning"). As an exact curated phrase it now
   * binds exactly — 561210 + 561790 (its two pre-existing infer owners) — so the
   * 561720 that it used to inherit through that stem is gone, which is what the
   * infer map always said this phrase is (building maintenance is not janitorial
   * cleaning). No cleaning-only query and no janitorial match TERM changed: the
   * regression suite pins both this binding and the untouched 561720 payload.
   */
  "facilities-support-services": {
    label: "Facilities Support/Operations",
    synonyms: [
      "facilities support",
      "facilities management",
      "facility management",
      "integrated facilities",
      "facilities operations",
      "facilities maintenance",
      "building maintenance",
      "base operations support",
    ],
    naics: ["561210"],
  },

  /**
   * OWNER 09-16 — SOLID WASTE COLLECTION → NAICS 562111 Solid Waste Collection
   * (real Census code; the 5th and last of the owner's five everyday-service
   * codes named 09-15).
   *
   * `exactOnly` — the same mechanism the owner's 09-15 arrangement-intent ruling
   * put on Logistics/488510 and #391 put on Security Guards. "waste" is a prefix
   * stem onto everything waste-adjacent (waste management, hazardous waste,
   * wastewater, waste disposal) and "trash"/"garbage" are single generic nouns,
   * so 562111 binds ONLY for the exact collection/hauling phrases below: a bare
   * "waste" query keeps EXACTLY today's behavior (no code implied) and nothing
   * can inherit this entry through the stem.
   *
   * SUPERSET: the synonym set contains every pre-existing 562111 infer keyword
   * (solid waste, waste collection, waste hauling, trash, garbage, refuse,
   * rubbish), so a "solid waste" scan keeps every term it already matched on —
   * recall can only grow — plus the collection phrases procurement uses. The
   * list is deliberately held at MAX_EXPANDED_TERMS (12), the same cap
   * discipline Security Guards applies: every entry is BOTH a curated match term
   * and a query form, and a 13th term would push a real term (and a pre-existing
   * infer keyword) out of the cap on some queries. Longer/shorter variants users
   * type ("waste collection services") still match by substring of the shorter
   * phrase once it resolves.
   *
   * SEPARATION — 562111 vs the other 562x codes:
   *   562111 = collection/hauling of MUNICIPAL SOLID WASTE (trash, garbage,
   *     refuse, rubbish, solid waste collection/hauling);
   *   562112 = HAZARDOUS waste collection, 562119 = other waste collection;
   *   562212 / 562219 = landfill and waste DISPOSAL;
   *   562920 = recycling / materials recovery.
   * Not one synonym here mentions hazardous, disposal, landfill or recycling,
   * and no 5621xx-other / 5622xx / 5629xx phrase is an exact synonym of this
   * entry — the payloads are disjoint in BOTH directions (proven at payload
   * level in the regression suite).
   */
  "solid-waste-collection": {
    label: "Solid Waste/Collection",
    exactOnly: true,
    synonyms: [
      "solid waste",
      "solid waste collection",
      "municipal solid waste",
      "waste collection",
      "waste hauling",
      "trash",
      "trash collection",
      "garbage",
      "garbage collection",
      "refuse",
      "refuse collection",
      "rubbish",
    ],
    naics: ["562111"],
  },
  /**
   * OWNER 09-15 — DELIVERY → NAICS 492110 (Couriers and Express Delivery
   * Services). The DEFAULT implied code for delivery work is 492110 ONLY.
   *
   * The freight-trucking 484xxx codes are deliberately NOT part of default
   * delivery: a "delivery" search must never silently become a trucking search.
   * Freight delivery is modeled by the explicit SUB-TERM entry directly below
   * ("freight delivery"), which adds the 484xxx freight-trucking codes on top of
   * 492110 — using the registry's existing lookup (direct synonym hit), the same
   * mechanism every other trade uses. No new machinery.
   *
   * "delivery service" MOVED here from the trucking entry (owner 09-15): while it
   * lived in trucking, the documented stem rule ("delivery" is the first word of
   * the "delivery service" synonym) made a bare "delivery" query pull the whole
   * trucking set — exactly the coupling the owner asked to remove.
   */
  "delivery-couriers": {
    label: "Delivery/Couriers",
    synonyms: [
      "delivery",
      "deliveries",
      "courier",
      "couriers",
      "courier service",
      "courier services",
      "express delivery",
      "package delivery",
      "parcel delivery",
      "delivery service",
      "delivery services",
    ],
    naics: ["492110"],
  },
  /**
   * OWNER 09-15 — FREIGHT DELIVERY sub-term: the CONDITIONAL half of the
   * Delivery trade. When — and only when — the selected work is FREIGHT delivery
   * ("freight delivery" / "freight delivery service(s)"), the freight-trucking
   * codes 484110/484121/484122/484220/484230 ride ALONGSIDE the delivery
   * default 492110 (the owner's "freight delivery adds the 484xxx codes").
   *
   * Nothing else changes: the term is an ordinary registry entry, so
   * expandTrade's existing direct-synonym lookup resolves it and the freight
   * codes are already validated against NAICS_NAMES at module load.
   */
  "freight-delivery": {
    label: "Freight Delivery",
    synonyms: [
      "freight delivery",
      "freight delivery service",
      "freight delivery services",
    ],
    naics: ["492110", "484110", "484121", "484122", "484220", "484230"],
  },
  /**
   * OWNER 09-14/09-15 — LOGISTICS → NAICS 488510 Freight Transportation
   * Arrangement (real code, registered in NAICS_NAMES).
   *
   * "logistics" is its OWN trade from 09-15 on. It was a synonym inside the
   * trucking entry during the 09-13 breadth fix; it was removed there so the
   * term resolves to exactly ONE trade instead of two (trucking keeps all of its
   * codes — nothing else about trucking changed).
   *
   * STRICT SEPARATION (owner add-on 09-15): 488510 is the ONLY code implied
   * here. Logistics is NOT warehousing — 493110 is never added to a logistics
   * scan — and the Warehousing trade below never adds 488510. The two verticals
   * do not imply each other in either direction.
   *
   * ARRANGEMENT-INTENT ONLY (owner 09-15 ruling): NAICS 488510 is for businesses
   * that ARRANGE freight transportation (brokers / forwarders / 3PLs) — a
   * trucking company CARRIES freight. So this entry is `exactOnly`: 488510 binds
   * ONLY for the exact arrangement phrases below ("freight broker", "freight
   * brokerage", "freight forwarder", "freight forwarding", "3PL", "third party
   * logistics" / "third-party logistics", "freight transportation arrangement").
   * Bare "freight" and generic "freight <noun>" queries ("freight delivery",
   * "freight shipping", "freight hauling", "freight transportation") are
   * CARRIER intent and resolve to Trucking/Delivery with NO 488510 — the stem
   * rule can never pull this entry in.
   */
  "logistics-freight-arrangement": {
    label: "Logistics",
    exactOnly: true,
    synonyms: [
      "logistics",
      "freight transportation arrangement",
      "freight forwarding",
      "freight forwarder",
      "freight broker",
      "freight brokerage",
      "third party logistics",
      "third-party logistics",
      "3pl",
    ],
    naics: ["488510"],
  },
  /**
   * OWNER 09-15 — WAREHOUSING → NAICS 493110 General Warehousing and Storage.
   *
   * Warehousing is its own trade: "warehousing" (and the storage/distribution
   * language procurement actually uses) resolves HERE, to 493110, and is never
   * defaulted to logistics (488510 is not in this entry's naics list, and no
   * logistics synonym stems off these terms). 493110 stays available for
   * warehousing work exactly as the owner asked.
   */
  "warehousing-storage": {
    label: "Warehousing/Storage",
    synonyms: [
      "warehousing",
      "warehouse",
      "warehouses",
      "storage",
      "storage services",
      "distribution center",
      "distribution centers",
      "order fulfillment",
    ],
    naics: ["493110"],
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
 * OWNER 09-15 (canonical code presentation): every 6-digit NAICS code the
 * registry implies — deduped, in first-seen order. A code can legitimately be
 * implied by MORE THAN ONE trade (492110 is in both Trucking and Delivery),
 * so any surface presenting "the codes for my trade" must render it ONCE; this
 * list is the deduped source for such surfaces (e.g. the Radar trade-field
 * datalist suggestions, which append these so 492110/488510/493110 and the
 * 484xxx freight codes are always selectable under their canonical
 * NAICS_NAMES title). Presentation-only — matching/scoring never reads it.
 */
export const REGISTRY_IMPLIED_NAICS: string[] = REGISTRY_NAICS.filter(
  (c, i, a) => a.indexOf(c) === i,
);

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

  // 1) Registry lookup.
  //
  //    DIRECT HITS WIN (owner 09-15 arrangement-intent ruling). When the query
  //    is an EXACT synonym of any entry, ONLY the exact-hit entries fire — the
  //    first-word prefix stem is skipped entirely. This keeps a precise phrase
  //    from ALSO pulling in a broader trade through the stem: "freight broker"
  //    resolves to Logistics (488510) and NOT trucking (its stem would match
  //    trucking's synonym "freight"), and "freight delivery" resolves to the
  //    freight-delivery sub-term exactly — no 488510 from the logistics stem.
  const registryEntries = Object.values(TRADE_ALIASES);
  const exactHits = registryEntries.filter((entry) =>
    entry.synonyms.some((s) => s.toLowerCase() === lower),
  );
  const useStem = exactHits.length === 0;
  for (const entry of registryEntries) {
    const synonyms = entry.synonyms.map((s) => s.toLowerCase());
    const hitDirect = synonyms.includes(lower);
    if (hitDirect) {
      for (const s of synonyms) if (!terms.includes(s)) terms.push(s);
      for (const code of entry.naics) if (!naicsCodes.includes(code)) naicsCodes.push(code);
      continue;
    }
    // No exact phrase anywhere → the first-word stem may fire, EXCEPT for
    // exactOnly entries (the Logistics trade): 488510 is arrangement-intent
    // ONLY, so a bare "freight" or a generic "freight <noun>" query can never
    // inherit its "freight forwarding"/"freight broker" synonyms via the stem.
    if (!useStem || entry.exactOnly) continue;
    const firstWord = lower.split(/\s+/)[0] || "";
    const hitStem =
      firstWord.length >= 3 && synonyms.some((s) => s === firstWord || s.startsWith(firstWord));
    if (!hitStem) continue;
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
  // OWNER PRECISION CONSTRAINT (09-07): generic terms are filtered out of the
  // match set HERE (single source of truth) — a generic word can never appear
  // as a match term, so every downstream matcher (tradeTextIncludes,
  // tradeProvenanceFor, tradeKeywordPred) inherits the rule for free. The
  // verbatim original (terms[0]) is NEVER filtered: a literal user query keeps
  // today's precision/behavior; only ADDED synonyms are subject to the block.
  // Implied NAICS codes are untouched (the evidence path stays open).
  const [verbatim, ...added] = terms;
  const filtered = added.filter((t) => !GENERIC_TRADE_TERMS.has(t));
  return {
    original: raw,
    isNaics: false,
    terms: [verbatim, ...filtered].slice(0, MAX_EXPANDED_TERMS),
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

/** Registry label for a code (industry-level, owner-exact why-line fragment).
 *
 *  A code can legitimately be implied by MORE THAN ONE trade (owner 09-15:
 *  492110 is implied by the trucking entry AND by the Delivery trade). Returning
 *  the first entry blindly would label a DELIVERY scan's implied-NAICS match
 *  "Trucking/Hauling" — an overclaim. So when the expansion is known, the entry
 *  is chosen by SPECIFICITY against the scan actually running: most codes shared
 *  with the expansion wins, and among equally-overlapping entries the SMALLEST
 *  naics set wins (the 1-code Delivery set is more specific than the 6-code
 *  trucking set). Display/provenance only — no matching or scoring path reads
 *  this. */
function registryLabelForCode(code: string, expansion?: TradeExpansion): string | null {
  const candidates = Object.values(TRADE_ALIASES).filter((e) => e.naics.includes(code));
  if (candidates.length === 0) return null;
  if (!expansion) return candidates[0].label;
  const implied = new Set(expansion.naicsCodes);
  let best = candidates[0];
  let bestOverlap = -1;
  for (const entry of candidates) {
    const overlap = entry.naics.filter((c) => implied.has(c)).length;
    if (
      overlap > bestOverlap ||
      (overlap === bestOverlap && entry.naics.length < best.naics.length)
    ) {
      best = entry;
      bestOverlap = overlap;
    }
  }
  return best.label;
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
  const label = registryLabelForCode(code, expansion) ?? NAICS_NAMES[code] ?? code;
  return {
    original: expansion.original,
    matchedConcept: label,
    conceptLabel: label,
    matchedNaics: code,
  };
}

/**
 * DEFAULT-MATCH STRENGTH (owner 09-14 match-quality / local-accuracy PR).
 *
 * A keyword hit is a DEFAULT result only when the trade is corroborated by the
 * bid's TITLE or an implied NAICS code:
 *   - a non-NAICS query is STRONG when any expanded term appears in the TITLE,
 *     or the bid's stored naics_code is in the expansion's implied code set;
 *   - a NAICS-code query (the input itself is a 6-digit code) is STRONG by
 *     construction — the SQL predicate is exact equality, so every returned
 *     row IS the code.
 *
 * A hit that appears ONLY in the description and/or the category field is WEAK
 * evidence: source category tags are frequently junk ("Construction" stamped
 * on a Frozen Beef supply solicitation; "Security" on a food-delivery row), and
 * a stray description word ("Securities", "security clearance") is not a trade.
 * Weak rows are EXCLUDED from the default result set (local + nationwide) and
 * surface — when their resolved geography is the requested state — only under
 * the explicitly labeled "Related opportunities" section (adjacent evidence,
 * never a direct match). See radar.tsx's handler, which applies this split.
 */
export function isStrongTradeMatch(
  title: string | null | undefined,
  _category: string | null | undefined,
  _description: string | null | undefined,
  naicsCode: string | null | undefined,
  expansion: TradeExpansion,
): boolean {
  if (expansion.isNaics) return true; // exact NAICS equality — strong by construction
  const titleText = String(title ?? "").toLowerCase();
  const terms = expansion.terms.filter((t) => t && t.length >= 2);
  if (terms.some((t) => titleText.includes(t))) return true;
  const code = String(naicsCode ?? "").trim();
  return !!code && expansion.naicsCodes.includes(code);
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
  // Callers pass the ~/db FACTORY (`sql = () => neon(url)`), per the
  // documented contract. Tagging the factory directly (`` sql`...` ``) just
  // RETURNS an unexecuted neon query object instead of a composable fragment —
  // the interpolated function then serializes into invalid SQL and every
  // keyword-trade Radar scan died with "syntax error at or near $1"
  // (owner 09-13 zero-results root cause, fixed here). Resolve a live neon
  // handle first; accept an already-resolved instance (has .unsafe) as-is.
  const s = typeof (sql as any)?.unsafe === "function" ? sql : sql();
  if (expansion.isNaics || expansion.terms.length === 0) return s``;
  const clauses: any[] = [];
  for (const term of expansion.terms.slice(0, MAX_EXPANDED_TERMS)) {
    if (!term || term.length < 2) continue;
    clauses.push(
      s`(
        ${s`LOWER(COALESCE(title,'')) LIKE ${"%" + term + "%"}`} OR
        ${s`LOWER(COALESCE(description,'')) LIKE ${"%" + term + "%"}`} OR
        ${s`LOWER(COALESCE(category,'')) LIKE ${"%" + term + "%"}`}
      )`,
    );
  }
  if (expansion.naicsCodes.length > 0) {
    clauses.push(s`naics_code = ANY(${expansion.naicsCodes})`);
  }
  if (clauses.length === 0) return s``;
  let acc = clauses[0] as any;
  for (let i = 1; i < clauses.length; i++) {
    acc = s`(${acc} OR ${clauses[i]})`;
  }
  return s`AND (${acc})`;
}

/**
 * Precision self-check (owner 09-07 constraint). No test runner exists in this
 * repo, so this throw-guarded verifier is the regression protection: run with
 * `bun src/lib/trade-registry.ts` (import.meta.main guard — never runs on
 * import). Asserts: (a) trucking expansion carries no bare generic match term;
 * (b) "trucking" does NOT match generic "Transportation services" text;
 * (c) a specific term ("freight hauling") still matches; (d) the NAICS path
 * (484121) still works.
 */
export function verifyTradePrecision(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`[trade-registry precision] FAIL: ${msg}`);
  };
  const exp = expandTrade("trucking");
  assert(!exp.terms.includes("transport"), 'terms must not include "transport"');
  assert(!exp.terms.includes("delivery"), 'terms must not include "delivery"');
  assert(
    !exp.terms.some((t) => GENERIC_TRADE_TERMS.has(t) && t !== exp.terms[0]),
    "no added term may be a GENERIC_TRADE_TERMS entry",
  );
  assert(
    tradeTextIncludes("Transportation services", exp) === false,
    '"trucking" must NOT match "Transportation services"',
  );
  assert(
    tradeProvenanceFor("Transportation services", exp, null) === null,
    'no provenance for a generic-only hit (why-line must never overclaim)',
  );
  assert(
    tradeTextIncludes("Freight hauling needed for base supply run", exp) === true,
    'specific term "freight hauling" must still match',
  );
  assert(exp.naicsCodes.includes("484121"), "trucking must imply NAICS 484121");
  assert(
    tradeProvenanceFor("Office supplies", exp, "484121")?.matchedNaics === "484121",
    "implied-NAICS branch must still produce provenance",
  );
  // Owner 09-13: trucking breadth — full NAICS family + "equipment transport".
  for (const code of ["484110", "484121", "484122", "484230", "492110"]) {
    assert(exp.naicsCodes.includes(code), `trucking must imply NAICS ${code}`);
  }
  assert(
    tradeTextIncludes("Equipment transport for the logistics yard", exp) === true,
    '"equipment transport" must match after the registry expansion',
  );

  // Owner 09-14 (hauling amendment): "hauling" is a SEARCHABLE Trucking trade
  // term — it resolves to the SAME trucking expansion (label "Trucking/Hauling")
  // and implies the full trucking NAICS set INCLUDING the newly added
  // 484220 Specialized Freight (except Used Goods) Trucking, Local, alongside
  // the kept codes 484110/484121/484122/484230 (+ 492110).
  const haul = expandTrade("hauling");
  assert(haul.terms[0] === "hauling", '"hauling" original term is preserved');
  assert(haul.terms.includes("trucking"), '"hauling" must expand to the trucking term');
  assert(haul.naicsCodes.includes("484220"), '"hauling" must imply NAICS 484220');
  for (const code of ["484110", "484121", "484122", "484230", "492110"]) {
    assert(haul.naicsCodes.includes(code), `"hauling" must imply NAICS ${code}`);
  }
  assert(
    tradeTextIncludes("2027 Sludge Hauling Contracts", haul) === true,
    '"hauling" must match a real sludge-hauling solicitation',
  );
  assert(
    tradeTextIncludes("F--SOLID WASTE DISPOSAL AND BACKHAULING - TUBA CITY D", haul) === true,
    '"hauling" must match the owner waste→trucking backhauling title',
  );
  // When the ORIGINAL term itself is what matched, provenance preserves the
  // verbatim term (existing documented behavior) — so the industry label
  // check uses a non-original synonym hit ("freight hauling" → Trucking/Hauling).
  const haulProv = tradeProvenanceFor("Freight hauling needed for base supply run", haul, null);
  assert(haulProv?.conceptLabel === "Trucking/Hauling", '"hauling" provenance label must be "Trucking/Hauling"');
  assert(
    haulProv?.matchedNaics != null &&
      ["484110", "484121", "484122", "484220", "484230", "492110"].includes(haulProv.matchedNaics),
    '"hauling" provenance must imply a trucking NAICS code (got ' + String(haulProv?.matchedNaics) + ')',
  );
  // A literal "hauling" text hit keeps the VERBATIM label (original preserved
  // — never an overclaim to a different concept).
  assert(
    tradeProvenanceFor("2027 Sludge Hauling Contracts", haul, null)?.conceptLabel === "hauling",
    'a literal "hauling" text hit keeps the verbatim label',
  );

  // Owner 09-13: janitorial vertical — curated terms only, NO bare "cleaning".
  const jan = expandTrade("janitorial");
  for (const t of [
    "janitorial",
    "custodial",
    "commercial cleaning",
    "building cleaning",
    "housekeeping",
    "floor care",
    "carpet cleaning",
    "restroom sanitation",
    "window cleaning",
  ]) {
    assert(jan.terms.includes(t), `janitorial expansion must include "${t}"`);
  }
  assert(!jan.terms.includes("cleaning"), 'janitorial terms must NOT include bare "cleaning"');
  assert(jan.naicsCodes.includes("561720"), "janitorial must imply NAICS 561720");
  assert(
    tradeTextIncludes("Janitorial and Custodial Services for Municipal Complex", jan) === true,
    "a real janitorial solicitation must match",
  );
  assert(
    tradeTextIncludes("10--ROD,CLEANING,SMALL ARM", jan) === false,
    '"cleaning" alone must never match unrelated munitions-cleaning work',
  );
  assert(
    tradeTextIncludes("Kitchen Hood Cleaning Services", jan) === false,
    "kitchen-hood cleaning (561790) must not match janitorial without another signal",
  );
  assert(
    tradeProvenanceFor("Office supplies", jan, "561720")?.matchedNaics === "561720",
    "janitorial implied-NAICS branch must produce provenance",
  );

  // ── OWNER 09-14/09-15: DELIVERY / FREIGHT-DELIVERY / LOGISTICS / WAREHOUSING
  // (1) "delivery" → the Delivery trade: DEFAULT code 492110 ONLY. The
  //     freight-trucking 484xxx codes are the explicit "freight delivery"
  //     sub-term's job, never a bare "delivery" query's.
  const del = expandTrade("delivery");
  assert(del.terms[0] === "delivery", '"delivery" original term is preserved');
  assert(del.naicsCodes.includes("492110"), '"delivery" must imply NAICS 492110');
  assert(
    del.naicsCodes.length === 1,
    '"delivery" must imply EXACTLY one code (492110) — got ' + JSON.stringify(del.naicsCodes),
  );
  for (const code of ["484110", "484121", "484122", "484220", "484230"]) {
    assert(
      !del.naicsCodes.includes(code),
      `default "delivery" must NOT imply freight-trucking ${code}`,
    );
  }
  assert(
    tradeProvenanceFor("Overnight courier service", del, null)?.conceptLabel === "Delivery/Couriers",
    '"delivery" text hit must resolve to the Delivery/Couriers trade',
  );
  assert(
    tradeProvenanceFor("Office supplies", del, "492110")?.conceptLabel === "Delivery/Couriers",
    'a delivery scan\'s implied-NAICS 492110 match must say "Delivery/Couriers" (NOT Trucking/Hauling)',
  );
  assert(
    tradeProvenanceFor("Office supplies", exp, "492110")?.conceptLabel === "Trucking/Hauling",
    "the SAME 492110 code on a trucking scan must still say Trucking/Hauling",
  );
  // (2) "freight delivery" — the conditional sub-term: 492110 + the 484xxx
  //     freight-trucking codes.
  const fd = expandTrade("freight delivery");
  assert(fd.terms[0] === "freight delivery", '"freight delivery" original term is preserved');
  for (const code of ["492110", "484110", "484121", "484122", "484220", "484230"]) {
    assert(fd.naicsCodes.includes(code), `"freight delivery" must imply NAICS ${code}`);
  }
  // (3) "logistics" → the Logistics trade: 488510 ONLY, never warehousing.
  const log = expandTrade("logistics");
  assert(log.terms[0] === "logistics", '"logistics" original term is preserved');
  assert(log.naicsCodes.includes("488510"), '"logistics" must imply NAICS 488510');
  assert(
    !log.naicsCodes.includes("493110"),
    '"logistics" is NOT warehousing — it must never imply 493110',
  );
  assert(
    !log.naicsCodes.some((c) => c.startsWith("484")),
    '"logistics" must not imply the freight-trucking 484xxx codes',
  );
  assert(
    tradeProvenanceFor("Freight transportation arrangement services", log, null)?.conceptLabel ===
      "Logistics",
    '"logistics" text hit must resolve to the Logistics trade',
  );
  assert(
    tradeProvenanceFor("Office supplies", log, "488510")?.conceptLabel === "Logistics",
    'a logistics scan\'s implied-NAICS 488510 match must say "Logistics"',
  );
  // (4) "warehousing" → the Warehousing trade: 493110 ONLY, never logistics.
  const wh = expandTrade("warehousing");
  assert(wh.terms[0] === "warehousing", '"warehousing" original term is preserved');
  assert(wh.naicsCodes.includes("493110"), '"warehousing" must imply NAICS 493110');
  assert(
    wh.naicsCodes.length === 1,
    '"warehousing" must imply EXACTLY one code (493110) — got ' + JSON.stringify(wh.naicsCodes),
  );
  assert(
    !wh.naicsCodes.includes("488510"),
    '"warehousing" must NEVER default to logistics — 488510 must not be implied',
  );
  assert(
    tradeProvenanceFor("Warehouse storage services", wh, null)?.conceptLabel === "Warehousing/Storage",
    '"warehousing" text hit must resolve to the Warehousing/Storage trade',
  );
  assert(
    tradeProvenanceFor("Office supplies", wh, "493110")?.conceptLabel === "Warehousing/Storage",
    'a warehousing scan\'s implied-NAICS 493110 match must say "Warehousing/Storage"',
  );
  // STRICT SEPARATION, both directions (owner add-on 09-15).
  assert(
    !log.naicsCodes.includes("493110") && !wh.naicsCodes.includes("488510"),
    "logistics and warehousing must never imply each other's code",
  );
  // ── OWNER 09-15 ARRANGEMENT-INTENT RULING: 488510 binds ONLY for the exact
  // arrangement phrases. Bare "freight" and generic "freight <noun>" queries
  // are CARRIER intent → Trucking/Delivery, never Logistics.
  const freight = expandTrade("freight");
  assert(
    freight.terms[0] === "freight",
    '"freight" original term is preserved',
  );
  assert(
    !freight.naicsCodes.includes("488510"),
    'bare "freight" is a CARRIER business — it must NOT imply 488510 (arrangement-intent only)',
  );
  for (const code of ["484110", "484121", "484122", "484220", "484230", "492110"]) {
    assert(freight.naicsCodes.includes(code), `"freight" must imply trucking code ${code}`);
  }
  assert(
    tradeProvenanceFor("Freight hauling needed for base supply run", freight, null)?.conceptLabel ===
      "Trucking/Hauling",
    '"freight" text hit must resolve to the Trucking/Hauling trade',
  );
  // "freight delivery" → the freight-delivery sub-term EXACTLY (six codes) with
  // NO 488510 — the old stem-on-"freight" no longer inherits Logistics.
  const fdExact = expandTrade("freight delivery");
  assert(
    fdExact.naicsCodes.length === 6 && !fdExact.naicsCodes.includes("488510"),
    '"freight delivery" must be EXACTLY the six freight codes with NO 488510 — got ' +
      JSON.stringify(fdExact.naicsCodes),
  );
  // Other carrier-intent freight phrases stay trucking-only, no 488510.
  for (const q of ["freight shipping", "freight hauling", "freight transportation"]) {
    const carrier = expandTrade(q);
    assert(
      !carrier.naicsCodes.includes("488510"),
      `"${q}" is carrier intent — must NOT imply 488510`,
    );
    assert(
      carrier.naicsCodes.includes("484121"),
      `"${q}" must imply the freight-trucking codes`,
    );
  }
  // The EXACT arrangement phrases resolve to Logistics and ONLY 488510.
  for (const q of [
    "freight broker",
    "freight brokerage",
    "freight forwarder",
    "freight forwarding",
    "3pl",
    "3PL",
    "third party logistics",
    "third-party logistics",
    "freight transportation arrangement",
  ]) {
    const arr = expandTrade(q);
    assert(
      arr.naicsCodes.length === 1 && arr.naicsCodes[0] === "488510",
      `"${q}" must resolve to Logistics ONLY (488510) — got ` + JSON.stringify(arr.naicsCodes),
    );
    assert(
      !arr.naicsCodes.includes("493110") && !arr.terms.includes("warehousing"),
      `"${q}" must never imply warehousing`,
    );
  }
  assert(
    tradeProvenanceFor(
      "Third party logistics coordination for the region",
      expandTrade("freight broker"),
      null,
    )?.conceptLabel === "Logistics",
    '"freight broker" expansion must label a synonym hit as the Logistics trade',
  );
  // Trucking kept everything it had (incl. owner-ratified 492110) and gained no
  // logistics/warehousing code.
  assert(exp.naicsCodes.includes("492110"), "trucking must KEEP owner-ratified 492110");
  for (const code of ["484110", "484121", "484122", "484220", "484230"]) {
    assert(exp.naicsCodes.includes(code), `trucking must keep freight-trucking ${code}`);
  }
  assert(
    !exp.naicsCodes.includes("488510") && !exp.naicsCodes.includes("493110"),
    "trucking must not have gained 488510 (logistics) or 493110 (warehousing)",
  );
  // Courier presentation: a delivery search IS courier work (never badged
  // "Related logistics — courier delivery"); trucking/freight/warehousing keep
  // the existing related-subtype behavior.
  assert(tradeExpresslyCourier("delivery") === true, 'a "delivery" search presents 492110 rows as its own work');
  assert(tradeExpresslyCourier("courier services") === true, "an express courier search stays courier work");
  assert(tradeExpresslyCourier("trucking") === false, '"trucking" presentation is unchanged');
  assert(tradeExpresslyCourier("hauling") === false, '"hauling" presentation is unchanged');
  assert(tradeExpresslyCourier("freight delivery") === false, 'a freight-delivery search keeps the related courier subtype');
  assert(tradeExpresslyCourier("warehousing") === false, '"warehousing" is never courier work');
}

// @ts-ignore — bun-only entry guard; never runs on import.
if ((import.meta as any).main) {
  verifyTradePrecision();
  // eslint-disable-next-line no-console
  console.log("[trade-registry precision] PASS: generic-only never matches; specific + NAICS paths intact.");
}

/**
 * NAICS 492110-family detection (owner v6.2 courier subtype): 492110 Couriers
 * and Express Delivery Services etc. The trucking registry IMPLIES 492110 as an
 * adjacent logistics code, but courier delivery is NOT work a "trucking"
 * business does by default — matches in this family render a "Related
 * logistics — courier delivery" subtype label instead of plain trucking.
 */
export function isCourierFamilyNaics(code: string | null | undefined): boolean {
  return /^49211/.test(String(code ?? "").trim());
}

/** True when the visitor's OWN trade wording expressly includes courier work
 *  ("courier", "couriers", "courier services") — 492110-family matches then
 *  present as real courier matches, NOT a related-logistics subtype.
 *
 *  Owner 09-15 (Delivery trade): the same must hold for a search whose IMPLIED
 *  NAICS set is entirely 492110 — the new "delivery" trade (and its courier
 *  synonyms). 492110 is not adjacent work for a delivery search, it IS the
 *  requested work, so its rows must not be badged "Related logistics — courier
 *  delivery" (radar.tsx's courierSubtype). Trucks/freight are unaffected: any
 *  484xxx code in the implied set makes `every` false, preserving the existing
 *  trucking presentation (including "freight delivery", where a 492110 row
 *  legitimately stays a related-logistics subtype next to the freight codes). */
export function tradeExpresslyCourier(trade: string | null | undefined): boolean {
  const t = String(trade ?? "");
  if (/\bcourier\b/i.test(t)) return true;
  const expansion = expandTrade(t);
  return (
    expansion.naicsCodes.length > 0 && expansion.naicsCodes.every((c) => isCourierFamilyNaics(c))
  );
}
