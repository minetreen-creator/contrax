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
  [/junk|debris|haul|dumpster|moving|movers/, "trucking"],
  [
    /siding|roof|gutter|window|door|shutter|insulation|spray foam|drywall|plaster|paint|floor|tile|carpet|masonry|brick|stone|concrete|paving|asphalt|sealcoat|stripin|deck|fence|remodel|renovat|restoration|handyman|carpent|framing|demolition|grading|excavat|well|septic|inspection|waterproof|cabinet|kitchen|bath/,
    "construction",
  ],
];

/** The broader trade to retry with, or null when there is none (or it is the same trade). */
export function broaderRadarTrade(trade: string | null | undefined): string | null {
  const t = (trade ?? "").trim().toLowerCase();
  if (!t || /^\d{2,6}$/.test(t)) return null;
  for (const [re, broader] of FALLBACKS) {
    if (re.test(t)) return t === broader ? null : broader;
  }
  return null;
}
