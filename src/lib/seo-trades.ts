/**
 * State + trade SEO landing pages (/contracts-in/{state}/{trade}).
 *
 * Small contractors search "janitorial contracts in Virginia", not "government
 * contracts". Each trade here maps to the SAME Radar query term the homepage
 * search sends (?trade=), so a page's live list and its "search this in Radar"
 * CTA agree. Matching reuses Radar's trade registry (expandTrade +
 * tradeKeywordPred) — no separate keyword list to drift.
 *
 * PURE module (no DB, no builtins): imported by the route, the server fn and
 * scripts/generate-sitemap.mjs.
 */
export interface SeoTrade {
  /** URL segment: /contracts-in/virginia/{slug} */
  slug: string;
  /** Display label, used in "{label} contracts in {State}". */
  label: string;
  /** Radar query term (fed to expandTrade and to /radar?trade=). */
  radarTerm: string;
}

export const SEO_TRADES: readonly SeoTrade[] = [
  { slug: "janitorial", label: "Janitorial", radarTerm: "janitorial" },
  { slug: "security-guard", label: "Security guard", radarTerm: "security guard" },
  { slug: "trucking", label: "Trucking and hauling", radarTerm: "trucking" },
  { slug: "landscaping", label: "Landscaping", radarTerm: "landscaping" },
  { slug: "construction", label: "Construction", radarTerm: "construction" },
  { slug: "hvac", label: "HVAC and plumbing", radarTerm: "hvac" },
  { slug: "electrical", label: "Electrical", radarTerm: "electrical" },
  { slug: "it-services", label: "IT services", radarTerm: "IT services" },
  // Owner 2026-10-01: trucking companies also do waste and trash hauling, but
  // the trucking trade stays freight-only (waste collection is its own NAICS
  // 562111 trade in the registry). This gives that existing trade its own
  // pages, cross-linked from trucking via RELATED_SEO_TRADES.
  { slug: "waste-hauling", label: "Waste and trash hauling", radarTerm: "waste hauling" },
];

/** Trades whose pages link to each other ("Also see …"). */
export const RELATED_SEO_TRADES: Readonly<Record<string, string>> = {
  trucking: "waste-hauling",
  "waste-hauling": "trucking",
};

export const SEO_TRADE_BY_SLUG: Readonly<Record<string, SeoTrade>> = Object.fromEntries(
  SEO_TRADES.map((t) => [t.slug, t]),
);

/** /radar deep link for a state + trade, matching the homepage search params. */
export function radarHrefFor(trade: SeoTrade, stateCode: string | null): string {
  const p = new URLSearchParams({ cert: "sdvosb", size: "any", trade: trade.radarTerm });
  if (stateCode) p.set("state", stateCode);
  return `/radar?${p.toString()}`;
}
