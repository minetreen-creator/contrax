/**
 * The search box on a state-and-trade page (owner 2026-11-16: "what can we do to get more
 * searches?"). Most visitors arrive on these pages from a Facebook post about one trade; 12% of
 * visitors ever searched. A roofer who lands on Illinois construction can type their own trade and
 * go straight to the results. PURE.
 */

/** Radar's own link shape (see radarHrefFor in seo-trades), for a trade the visitor typed. */
export function landingSearchHref(trade: string, stateCode: string): string | null {
  const term = trade.replace(/\s+/g, " ").trim().slice(0, 80);
  if (term.length < 2) return null;
  const p = new URLSearchParams({ cert: "sdvosb", size: "any", trade: term });
  if (/^[A-Z]{2}$/.test(stateCode)) p.set("state", stateCode);
  p.set("source", "landing_search");
  return `/radar?${p.toString()}`;
}
