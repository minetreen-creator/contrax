/**
 * More than one trade on one account (owner 2026-11-26, "1"). A South Carolina buyer bought two
 * passes three minutes apart, one set to construction and one to landscaping: the morning email
 * already matches every trade in a profile's `service_categories` (src/lib/digest-match.ts), but
 * Settings only let a member pick one industry. These are the extra trades a member types there.
 * PURE.
 */
export const MAX_OTHER_TRADES = 5;
export const OTHER_TRADE_MIN = 3;
export const OTHER_TRADE_MAX = 40;

/** Trimmed, de-duplicated (case ignored), without the main trade, capped. Anything not a short plain phrase is dropped. */
export function cleanOtherTrades(list: unknown, mainTrade?: string | null): string[] {
  if (!Array.isArray(list)) return [];
  const main = String(mainTrade ?? "").trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const t = raw.replace(/\s+/g, " ").trim();
    if (t.length < OTHER_TRADE_MIN || t.length > OTHER_TRADE_MAX) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9 &/,.'-]*$/.test(t)) continue;
    const k = t.toLowerCase();
    if (k === main || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= MAX_OTHER_TRADES) break;
  }
  return out;
}
