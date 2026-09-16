/**
 * Radar trade-field suggestions — the ONE source for both datalist inputs
 * (`src/routes/radar.tsx` + `src/components/HeroRadar.tsx`). Owner 09-15.
 *
 * WHY THIS EXISTS (the bug it fixes): both inputs used to build their datalist
 * from `Object.entries(NAICS_NAMES).slice(0, 120)`. NAICS_NAMES is grouped by
 * sector, so that arbitrary 120-entry window stopped inside "Professional /
 * Administrative / Support services" and cut off the everyday-service trades the
 * owner's members actually work in — Facilities Support 561210 (pos 129),
 * Security Guards 561612 (138), Janitorial 561720 (141), Landscaping 561730
 * (142) and Solid Waste Collection 562111 (148) never reached the public
 * dropdown, while construction/manufacturing codes (which sort early) always
 * did. A truncation is not a curation, and a slice bump would just move the
 * cliff (184 codes today, more tomorrow).
 *
 * THE MECHANISM (curate first, no truncation):
 *   1. CURATED TRADE TERMS lead the list: one entry per curated TRADE_ALIASES
 *      trade, valued at the trade's primary search term ("janitorial",
 *      "landscaping", "security guard", …) and labeled with the trade's own
 *      concept label ("Janitorial/Cleaning", "Landscaping/Grounds", …). Picking
 *      one puts REAL curated search language in the field, which expandTrade
 *      then resolves through the registry — the suggestions surface what the
 *      platform actually curates, not a wall of codes.
 *   2. CURATED CODES lead the code block: every code the registry implies
 *      (REGISTRY_IMPLIED_NAICS, deduped and ordered by the registry) plus the
 *      owner's five everyday-service codes, each under its CANONICAL
 *      NAICS_NAMES title (492110 renders ONCE — owner 09-15 canonical-once).
 *   3. THEN the COMPLETE NAICS_NAMES set (184 codes, each exactly once) so no
 *      trade is "missing from the list" again — no window, no cliff.
 *
 * Presentation-only: the trade field stays free text, and matching / scoring /
 * the funnel read nothing from here. Both datalist inputs render this same
 * flat [value, text] list, so the two surfaces can never drift apart.
 */
import { NAICS_NAMES } from "~/lib/naics-names";
import { TRADE_ALIASES, REGISTRY_IMPLIED_NAICS } from "~/lib/trade-registry";

/**
 * The owner's 09-15 everyday-service set (real Census codes only). Janitorial,
 * landscaping and security-guards are curated trades today; facilities support
 * (561210) and solid waste collection (562111) are named-but-not-yet-curated, so
 * they are surfaced here explicitly rather than being left behind a cutoff again.
 */
export const OWNER_EVERYDAY_SERVICE_NAICS: readonly string[] = [
  "561210", // Facilities Support Services
  "561612", // Security Guards and Patrol Services
  "561720", // Janitorial Services
  "561730", // Landscaping Services
  "562111", // Solid Waste Collection
];

/** [value, option text] — a datalist option is `value` + its visible text. */
export type TradeSuggestion = [string, string];

const label = (code: string) => `${code} — ${NAICS_NAMES[code]}`;

/**
 * Curated trade TERMS (item 1): the trade's own primary search term as the
 * value, the curated concept label as the visible text. Every value is the
 * first synonym of its TRADE_ALIASES entry, i.e. a term that resolves through
 * the registry to that trade's exact NAICS set (asserted in the regression
 * suite, so a registry rename can never leave a dead suggestion behind).
 */
export const CURATED_TRADE_SUGGESTIONS: TradeSuggestion[] = Object.values(
  TRADE_ALIASES,
).map((entry) => [entry.synonyms[0], `${entry.synonyms[0]} — ${entry.label}`]);

/**
 * Curated CODES (item 2): registry-implied codes (deduped, registry order —
 * 492110 appears once even though Trucking and Delivery both imply it) followed
 * by the owner's everyday-service codes that are not already implied.
 */
export const CURATED_SUGGESTION_NAICS: readonly string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of [...REGISTRY_IMPLIED_NAICS, ...OWNER_EVERYDAY_SERVICE_NAICS]) {
    if (!NAICS_NAMES[code] || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
})();

/** Canonical code options: curated codes first, then every remaining
 *  NAICS_NAMES code — the COMPLETE set, each code exactly once. */
export const NAICS_CODE_SUGGESTIONS: TradeSuggestion[] = (() => {
  const curated = new Set(CURATED_SUGGESTION_NAICS);
  const curatedOptions = CURATED_SUGGESTION_NAICS.map(
    (code) => [code, label(code)] as TradeSuggestion,
  );
  const restOptions = Object.keys(NAICS_NAMES)
    .filter((code) => !curated.has(code))
    .map((code) => [code, label(code)] as TradeSuggestion);
  return [...curatedOptions, ...restOptions];
})();

/** What both datalist inputs render, in order: curated trades, then codes. */
export const TRADE_SUGGESTIONS: TradeSuggestion[] = [
  ...CURATED_TRADE_SUGGESTIONS,
  ...NAICS_CODE_SUGGESTIONS,
];
