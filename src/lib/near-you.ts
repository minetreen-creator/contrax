import { createServerFn } from "@tanstack/react-start";
import { stateFromGeoHeaders } from "~/lib/radar-geo";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";

/**
 * "What's open near you?" (owner 2026-10-21): the visitor's approximate state
 * from Vercel's IP geo headers, the real count of bids open there right now,
 * and how many arrived in the last 24 hours. Same filters as the Radar
 * "Open now in your state" box. Empty state (no card) outside the US, when the
 * state is unknown, or on any error.
 */
export interface NearYou {
  state: string;
  open: number;
  newToday: number;
}

export const getNearYou = createServerFn({ method: "GET" }).handler(async (): Promise<NearYou> => {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const h = getRequest().headers;
    const state = stateFromGeoHeaders(h.get("x-vercel-ip-country"), h.get("x-vercel-ip-country-region"));
    if (!state) return { state: "", open: 0, newToday: 0 };
    const { sql } = await import("~/db");
    const s = sql();
    const [row] = (await s`
      SELECT COUNT(*)::int AS open,
             COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS new_today
      FROM bids
      WHERE normalized_state = ${state} AND due_date > NOW()
        AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
    `) as { open: number; new_today: number }[];
    return { state, open: Number(row?.open ?? 0), newToday: Number(row?.new_today ?? 0) };
  } catch (err) {
    console.error("[near-you] failed:", err);
    return { state: "", open: 0, newToday: 0 };
  }
});

/** Trades offered as one-tap chips; each opens Radar pre-filled with the state. */
export const NEAR_YOU_TRADES = ["Janitorial", "Landscaping", "Construction", "HVAC", "Trucking", "Security guards", "IT services"] as const;

export function nearYouRadarHref(state: string, trade?: string): string {
  const p = new URLSearchParams({ state, source: "near_you" });
  if (trade) p.set("trade", trade);
  return `/radar?${p.toString()}`;
}

/**
 * "What tomorrow's 6 AM email looks like" on /pricing (owner 2026-10-30, item
 * 4): the three newest open bids posted in the visitor's approximate state in
 * the last few days, due at least 3 days out. Titles, buyers, places and due
 * dates only (the same facts the public bid pages show). Empty outside the US,
 * when the state is unknown, or on any error; the section then hides.
 */
export interface EmailSampleBid {
  id: number;
  title: string;
  agency: string | null;
  location: string | null;
  due: string;
}

export const getEmailSample = createServerFn({ method: "GET" }).handler(async (): Promise<{ state: string; bids: EmailSampleBid[] }> => {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const h = getRequest().headers;
    const state = stateFromGeoHeaders(h.get("x-vercel-ip-country"), h.get("x-vercel-ip-country-region"));
    if (!state) return { state: "", bids: [] };
    // Owner 2026-11-08 (mystery-shopper pass): the sample led with parts orders
    // ("10--HOUSING ASSEMBLY,BAIL", "59--CIRCUIT CARD ASSEMB"). It now shows
    // real trade work posted in the visitor's state this week, one bid per
    // trade in turn (construction, landscaping, janitorial, security), from the
    // same source as the Radar landing panel.
    const { loadBidsFirst, BIDS_FIRST_TABS } = await import("~/lib/bids-first");
    const data = await loadBidsFirst(state);
    if (!data) return { state, bids: [] };
    const weekAgo = Date.now() - 7 * 86_400_000;
    const fresh = BIDS_FIRST_TABS.map((t) => data.bids[t.id].filter((b) => b.posted && Date.parse(b.posted) > weekAgo && b.due_date && Date.parse(b.due_date) > Date.now() + 3 * 86_400_000));
    const picked: EmailSampleBid[] = [];
    const seen = new Set<number>();
    for (let round = 0; picked.length < 3 && round < 6; round++) {
      for (const list of fresh) {
        const b = list[round];
        if (!b || seen.has(b.id) || picked.length >= 3) continue;
        seen.add(b.id);
        picked.push({ id: b.id, title: b.title, agency: b.agency || null, location: b.location, due: b.due_date as string });
      }
    }
    return { state, bids: picked };
  } catch (err) {
    console.error("[email-sample] failed:", err);
    return { state: "", bids: [] };
  }
});
