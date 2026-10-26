/**
 * "Similar open bids near you" on /bid/$id (owner 2026-10-26): visitors who
 * reach a bid page from Radar's "Open now" box left from it. The box shows a
 * few real open bids in the same state, matched on the NAICS code (exact
 * first, then its 4-digit industry group), and opens Radar on that search.
 */

export const SIMILAR_BIDS_LIMIT = 3;

/** NAICS prefixes to try, most specific first. Empty when the code is unusable. */
export function similarNaicsPrefixes(naics: string | null | undefined): string[] {
  const code = (naics ?? "").trim();
  if (!/^\d{6}$/.test(code)) return [];
  return [code, code.slice(0, 4)];
}

/** The Radar search for "all of these" — runs on arrival (deep link with a trade). */
export function similarRadarHref(naics: string | null | undefined, state: string | null | undefined): string | null {
  const code = (naics ?? "").trim();
  if (!/^\d{6}$/.test(code)) return null;
  const p = new URLSearchParams({ trade: code });
  if (state) p.set("state", state);
  return `/radar?${p.toString()}`;
}
