import { createServerFn } from "@tanstack/react-start";
import { stateFromGeoHeaders } from "~/lib/radar-geo";

/**
 * "Contracts ending near you" (owner 2026-10-29): the biggest federal contracts
 * in the visitor's approximate state that end in the next ENDING_MONTHS months,
 * from public USAspending records (recompete_contracts). Each one is likely to
 * be re-bid. The current holder's name is a Professional feature
 * ("Contracts Ending Soon"), so it is never sent; the card shows agency,
 * amount, end date and trade. Nationwide when the state is unknown.
 */
export const ENDING_MONTHS = 6;
export const ENDING_LIMIT = 3;

export interface EndingCard {
  agency: string;
  amount: number;
  endDate: string;
  trade: string;
  description: string | null;
}

export interface EndingNearYou {
  state: string;
  rows: EndingCard[];
}

export const getEndingNearYou = createServerFn({ method: "GET" }).handler(async (): Promise<EndingNearYou> => {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const h = getRequest().headers;
    const state = stateFromGeoHeaders(h.get("x-vercel-ip-country"), h.get("x-vercel-ip-country-region"));
    const { endingSoonForState } = await import("~/lib/federal-trade-data.server");
    let rows = state ? await endingSoonForState(state, ENDING_MONTHS, ENDING_LIMIT) : [];
    const scope = rows.length ? state : "";
    if (!rows.length) rows = await endingSoonForState(null, ENDING_MONTHS, ENDING_LIMIT);
    return {
      state: scope,
      rows: rows.map((r) => ({
        agency: r.sub_agency || r.agency || "Federal agency",
        amount: r.amount,
        endDate: r.end_date,
        trade: r.trade_slug,
        description: r.description,
      })),
    };
  } catch (err) {
    console.error("[ending-near-you] failed:", err);
    return { state: "", rows: [] };
  }
});

/** "$1.2M" / "$412K" / "$9,500". PURE. */
export function shortDollars(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
