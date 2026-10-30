/**
 * Homepage money jar (owner 2026-10-30: "4", then "2": hold the Friday post
 * until it is live). Coins drop into a jar at the real pace of federal contract
 * spending in the trades Contrax covers: last complete fiscal year's USAspending
 * totals (federal_trade_spending), spread evenly over the year. The page says
 * so and says what one coin is worth. Nothing is live-streamed or estimated.
 *
 * PURE and client-safe.
 */

const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60;
/** Aim for about one coin every this many seconds. */
export const TARGET_SECONDS_PER_COIN = 1.5;

/**
 * Trades to add up without double counting: a trade whose federal industry
 * codes all belong to another trade (cybersecurity inside IT services) is
 * dropped. PURE.
 */
export function distinctTrades(naicsByTrade: Readonly<Record<string, readonly string[]>>): string[] {
  const entries = Object.entries(naicsByTrade).filter(([, codes]) => codes.length > 0);
  return entries
    .filter(([trade, codes]) =>
      !entries.some(([other, otherCodes]) =>
        other !== trade &&
        otherCodes.length > codes.length &&
        codes.every((c) => otherCodes.includes(c)),
      ),
    )
    .map(([trade]) => trade);
}

/** Dollars per second at a yearly total's even pace. PURE. */
export function perSecond(yearTotal: number): number {
  return yearTotal > 0 ? yearTotal / SECONDS_PER_YEAR : 0;
}

/** A round coin value (1, 2 or 5 × a power of ten) near one coin per TARGET_SECONDS_PER_COIN. PURE. */
export function coinValue(dollarsPerSecond: number): number {
  const raw = dollarsPerSecond * TARGET_SECONDS_PER_COIN;
  if (!(raw > 0)) return 0;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const lead = raw / pow;
  const step = lead < 1.5 ? 1 : lead < 3.5 ? 2 : lead < 7.5 ? 5 : 10;
  return step * pow;
}

/** "$10,000" / "$2 million" for the coin label. PURE. */
export function coinLabel(value: number): string {
  if (value >= 1_000_000) return `$${value / 1_000_000} million`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}
