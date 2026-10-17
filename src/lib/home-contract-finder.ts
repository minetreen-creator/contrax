/** Suggestions only: visitors confirm the trade and choose geography explicitly. */
const TRADES: [RegExp, string][] = [
  [/\b(cleaning|janitorial|custodial)\b/i, "janitorial"],
  [/\b(landscaping|grounds|lawn)\b/i, "landscaping"],
  [/\b(trucking|hauling|freight)\b/i, "trucking"],
  [/\b(construction|building contractor)\b/i, "construction"],
  [/\b(security guards?|guard services?)\b/i, "security guard"],
  [/\b(hvac|heating|air conditioning)\b/i, "HVAC"],
  [/\b(plumbing|plumber)\b/i, "plumbing"],
  [/\b(electrical|electrician)\b/i, "electrical"],
  [/\b(IT services|information technology|computer support)\b/i, "IT services"],
];

export function suggestHomepageTrade(description: string): string {
  // These need their own specific search, not a general janitorial suggestion.
  if (
    /\b(sell|supplies|equipment|products|window|carpet|pressure wash|power wash|laundry|dry clean)\b/i.test(
      description,
    )
  )
    return "";
  const matches = TRADES.filter(([pattern]) => pattern.test(description));
  // Multiple services need an explicit choice; never silently discard a trade.
  if (matches.length === 1) return matches[0][1];
  const code = description.trim();
  return /^\d{6}$/.test(code) ? code : "";
}
