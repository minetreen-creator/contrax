// Title-length helpers for the c_title SEO finding (audit da703ff8-62fc-4503-ab65-9d89dad13c78).
// The check measures the RENDERED <title>: 30–60 chars, main query term up front.
// Where a page's own part plus the " | Contrax" suffix would exceed 60, we clamp at
// word boundaries, append an ellipsis, and FLAG with console.warn instead of
// cutting silently (finding step 3).

export const CONTRAX_SUFFIX = " | Contrax";

/** Clamp `text` so it fits in `budget` chars, trimming at word boundaries with an ellipsis. */
export function clampToBudget(text: string, budget: number, flagKey: string): string {
  if (text.length <= budget) return text;
  const cut = Math.max(budget - 1, 0);
  const words = text.split(/\s+/);
  let out = "";
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > cut) break;
    out = next;
  }
  const clamped = out.length > 0 ? `${out}…` : `${text.slice(0, cut)}…`;
  console.warn(`[c_title] ${flagKey}: "${text}" (${text.length} chars) clamped to "${clamped}"`);
  return clamped;
}

/** opportunities/{setAside}/{naics}: own part `${setAside} ${industry} Bids` ≤ 50 (+ " | Contrax"). */
export function makeNaicsTitle(setAside: string, industryName: string): string {
  const own = `${setAside} ${industryName} Bids`;
  if (own.length <= 50) return `${own}${CONTRAX_SUFFIX}`;
  const nameBudget = 50 - (setAside.length + 6); // " " before "Bids" + "Bids" + " "
  const clamped = clampToBudget(industryName, nameBudget, `naics ${setAside}`);
  return `${setAside} ${clamped} Bids${CONTRAX_SUFFIX}`;
}

/** clauses/{n}: own part `${prefix} — ${clauseTitle}` ≤ 50 (+ " | Contrax"). */
export function makeClauseTitle(prefix: string, clauseTitle: string, flagKey: string): string {
  const own = `${prefix} — ${clauseTitle}`;
  if (own.length <= 50) return `${own}${CONTRAX_SUFFIX}`;
  const titleBudget = 50 - (prefix.length + 3); // " — " separator
  const clamped = clampToBudget(clauseTitle, titleBudget, flagKey);
  return `${prefix} — ${clamped}${CONTRAX_SUFFIX}`;
}

/** blog/{slug}: post title ≤ 45 so " — Contrax Blog" (15) keeps the rendered title ≤ 60. */
export function makeBlogTitle(postTitle: string, slug: string): string {
  const clamped = clampToBudget(postTitle, 45, `blog ${slug}`);
  return `${clamped} — Contrax Blog`;
}