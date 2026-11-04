/**
 * Radar trade fallback (owner 2026-10-26). Niche trades ("siding", "well
 * service", "insulation") rarely appear as government bids on their own; the
 * work is inside broader construction, grounds or hauling contracts. When a
 * search for one finds nothing, Radar re-runs it once on the broader trade so
 * the visitor's free search never ends on "nothing found".
 */

const FALLBACKS: [RegExp, string][] = [
  [/janitor|custodial|cleaning|housekeep|pressure wash|power wash/, "janitorial"],
  [/landscap|lawn|mow|grounds|tree|sod|irrigation|mulch|snow/, "landscaping"],
  [/junk|debris|haul|dumpster|moving|movers|\btow(ing)?\b|wrecker|roadside/, "trucking"],
  [
    /siding|roof|gutter|window|door|shutter|insulation|spray foam|drywall|plaster|paint|floor|tile|carpet|masonry|brick|stone|concrete|paving|asphalt|sealcoat|stripin|deck|fence|remodel|renovat|restoration|handyman|carpent|framing|demolition|grading|excavat|well|septic|inspection|waterproof|cabinet|kitchen|bath/,
    "construction",
  ],
];

/**
 * NAICS code searches (owner 2026-11-04: "238150 · OH" — Glass and Glazing —
 * found 0; few city and county boards tag bids with codes). A code with nothing
 * open re-runs once on its broad trade, like a niche trade word does.
 */
const CODE_FALLBACKS: [RegExp, string][] = [
  [/^561730$/, "landscaping"],
  [/^561720$/, "janitorial"],
  [/^(484|4885)\d*$/, "trucking"],
  [/^23\d{4}$/, "construction"],
];

/** The broader trade to retry with, or null when there is none (or it is the same trade). */
export function broaderRadarTrade(trade: string | null | undefined): string | null {
  const t = (trade ?? "").trim().toLowerCase();
  if (!t) return null;
  if (/^\d{2,6}$/.test(t)) return CODE_FALLBACKS.find(([re]) => re.test(t))?.[1] ?? null;
  for (const [re, broader] of FALLBACKS) {
    if (re.test(t)) return t === broader ? null : broader;
  }
  return null;
}
