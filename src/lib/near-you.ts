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
