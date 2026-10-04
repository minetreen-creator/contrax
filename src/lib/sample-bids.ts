import { createServerFn } from "@tanstack/react-start";
import { setAsidePred } from "~/lib/open-bids";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { isProductBuy } from "~/lib/trade-classification";
import { cleanBidTitle, isCodeHeavyTitle } from "~/lib/bid-title";

// Live sample of REAL open SDVOSB set-asides, NEWEST first (owner 2026-10-03:
// "closing soonest" showed the same five rows day after day until each aged
// out, so the site looked stale). Each is still at least two days from its
// deadline so it stays actionable. SERVICE work only: parts and supply orders
// (SAM's "59--ACCESSORY KIT" product listings, numeric FSC prefixes, and
// titles isProductBuy recognises) are not something a contractor bids on.
// Used by the homepage hero card and the /bid-scout example. Never throws: a
// failed query returns [] and callers hide the sample.
export type SampleBid = {
  id: number;
  title: string;
  agency: string | null;
  location: string | null;
  due_date: string | null;
  set_aside: string | null;
  source_url: string | null;
  /** When Contrax first recorded the notice (ISO). */
  created_at: string | null;
};

/** SAM product listings lead with a numeric Federal Supply Class ("59--…", "6515--…"); services lead with a letter ("S201--…"). */
export function isProductListingTitle(title: string): boolean {
  return /^\s*\d{2,4}\s*--/.test(title) || isProductBuy(title.toLowerCase());
}

export const getSdvosbSample = createServerFn({ method: "GET" }).handler(
  async (): Promise<SampleBid[]> => {
    try {
      const { sql } = await import("~/db");
      const rows = (await sql()`
        SELECT id, title, agency, location, due_date, set_aside, source_url, created_at
        FROM bids
        WHERE due_date::date >= (NOW() + INTERVAL '2 days')::date
          AND title !~ '^[[:space:]]*[0-9]{2,4}[[:space:]]*--'
          ${setAsidePred("sdvosb", sql)}
          AND ${sql().unsafe(LOW_CONTENT_SQL)}
          AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT 60
      `) as any[];
      const seen = new Set<string>();
      const picked = rows.filter((r) => {
        const title = String(r.title ?? "");
        // Homepage examples must read as plain English (owner 2026-10-04).
        if (!title || isProductListingTitle(title) || isCodeHeavyTitle(title)) return false;
        const key = `${title.toLowerCase()}|${String(r.agency ?? "").toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return picked.slice(0, 5).map((r) => ({
        id: Number(r.id),
        title: cleanBidTitle(String(r.title ?? "")).title,
        agency: r.agency ? String(r.agency) : null,
        location: r.location ? String(r.location) : null,
        due_date: r.due_date ? String(r.due_date) : null,
        set_aside: r.set_aside ? String(r.set_aside) : null,
        source_url: r.source_url ? String(r.source_url) : null,
        created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
      }));
    } catch {
      return [];
    }
  },
);
