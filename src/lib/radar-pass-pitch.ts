/**
 * The $5 offer on Radar results, written from the visitor's own search (owner 2026-11-09: only
 * about 3% of Radar users ever clicked buy; the offer said "N more bids are waiting" and vanished
 * once an email unlocked the list). It names how many of their matches close within 7 days and
 * how many buyers they come from, and what $5 adds on top of seeing the list. PURE.
 */

export interface PassFacts {
  /** Matches on their list closing within 7 days (0..7 days left). */
  closingSoon: number;
  /** Distinct buyers (agencies) behind their matches. */
  buyers: number;
}

/** Facts for the offer from the full match list, before the free preview is cut. PURE. */
export function passFacts(matches: readonly { days_remaining: number | null; agency: string | null }[]): PassFacts {
  const closingSoon = matches.filter((m) => m.days_remaining !== null && m.days_remaining >= 0 && m.days_remaining <= 7).length;
  const buyers = new Set(matches.map((m) => (m.agency ?? "").trim().toLowerCase()).filter(Boolean)).size;
  return { closingSoon, buyers };
}

export function radarPassPitch(o: {
  total: number;
  waiting: number;
  unlocked: boolean;
  trade: string;
  stateName: string | null;
  facts: PassFacts | null;
}): { headline: string; detail: string } {
  const where = o.stateName ? ` in ${o.stateName}` : "";
  const bids = `${o.trade} bid${o.total === 1 ? "" : "s"}`;
  const soon = o.facts?.closingSoon ?? 0;
  const headline =
    soon > 0
      ? `${soon} of your ${o.total} ${bids}${where} close${soon === 1 ? "s" : ""} within 7 days.`
      : o.unlocked
        ? `You've seen your ${o.total} ${bids}${where}. Now go after them.`
        : `${o.waiting} more ${o.trade} bid${o.waiting === 1 ? "" : "s"}${where} are waiting.`;
  const buyers = o.facts && o.facts.buyers > 1 ? ` from ${o.facts.buyers} buyers` : "";
  const detail =
    `$5 opens every official notice, document and buyer contact for these ${o.total} bids${buyers}, ` +
    "and starting tomorrow at 6 AM, each new one in your trade with Auto-Pilot's call: pursue, partner or pass.";
  return { headline, detail };
}
