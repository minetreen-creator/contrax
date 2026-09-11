/**
 * Bid Scout funnel — Phase B (owner 2026-09-11).
 *
 * SEPARATE assisted-service path. Deliberately NOT part of the canonical
 * unified funnel (Qualified visit → Radar completed → Signup completed →
 * Activated → Paid), NOT part of the Radar Conversion funnel, NOT part of the
 * Autopsy funnel. A Bid Scout purchase is a distinct product sold OUTSIDE the
 * self-serve funnel — so its events are standalone names with NO stage
 * membership anywhere else (see src/lib/tracking-intake.ts EVENT_LABELS).
 *
 * Counting rules (mirror the canonical analytics exclusions):
 *   - viewed / checkout_started: COUNT(DISTINCT visitor_id) over funnel_events
 *     in the rolling now − 30×24h ISO-UTC window, with the SAME bot / QA /
 *     admin exclusions every admin funnel applies (BOT_EXCLUSION_SQL +
 *     qaFunnelExclusionSQL + adminFunnelExclusionSQL).
 *   - purchased: COUNT(DISTINCT bidScoutId) from bid_scout_subscriptions
 *     (status ANY, created_at OR updated_at inside the window) — the table the
 *     webhook maintains is the source of truth (the purchase EVENT is a
 *     timeline/audit record; the row is the truth). Email-level QA/admin
 *     exclusions apply the same way they do on every admin surface.
 *
 * READ-ONLY: SELECTs only. No migration, no writes.
 */
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import {
  qaFunnelExclusionSQL,
  qaUserExclusionSQL,
  adminFunnelExclusionSQL,
} from "~/lib/qa-exclusion";
import { ADMIN_EMAILS } from "~/lib/admin";

export type BidScoutFunnelStageKey = "viewed" | "checkout_started" | "purchased";

export interface BidScoutFunnelStage {
  key: BidScoutFunnelStageKey;
  label: string;
  count: number;
}

export interface BidScoutFunnelResult {
  range: "30d";
  stages: BidScoutFunnelStage[];
}

export const BID_SCOUT_FUNNEL_STAGES: {
  key: BidScoutFunnelStageKey;
  label: string;
  event: string;
}[] = [
  { key: "viewed", label: "Bid Scout viewed", event: "bid_scout_viewed" },
  { key: "checkout_started", label: "Checkout started", event: "bid_scout_checkout_started" },
  { key: "purchased", label: "Purchased", event: "bid_scout_purchased" },
];

/** Rolling window: now − 30×24h, ISO-UTC (same convention as the admin funnels). */
export function bidScoutFunnelWindow(): { fromIso: string; toIso: string } {
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86400 * 1000);
  return { fromIso: from.toISOString(), toIso: now.toISOString() };
}

/**
 * Separate 30-day Bid Scout funnel. Returns the three stage counts even when
 * every stage is 0 — the shape is stable and forward-compatible.
 */
export async function getBidScoutFunnel30d(): Promise<BidScoutFunnelResult> {
  const { fromIso } = bidScoutFunnelWindow();
  const humanFilter = `NOT COALESCE((${BOT_EXCLUSION_SQL}), false)`;
  const qaFilter = qaFunnelExclusionSQL("");
  const adminFilter = adminFunnelExclusionSQL("");

  const stageCount = async (event: string): Promise<number> => {
    try {
      const rows: any[] = await sql()`
        SELECT COUNT(DISTINCT visitor_id) AS n FROM funnel_events
        WHERE visitor_id IS NOT NULL AND visitor_id <> ''
          AND created_at >= ${fromIso}
          AND event_name = ${event}
          AND ${sql().unsafe(humanFilter)}
          AND ${sql().unsafe(qaFilter)} AND ${sql().unsafe(adminFilter)}`;
      return Number(rows?.[0]?.n ?? 0);
    } catch (err) {
      console.error(`[bid-scout-funnel] stage ${event} failed (continuing):`, err);
      return 0;
    }
  };

  // Purchased: the bid_scout_subscriptions table is the source of truth.
  // Status ANY; created_at OR updated_at inside the window; same QA/admin
  // email exclusions every admin surface applies.
  let purchased = 0;
  try {
    // bid_scout_subscriptions has NO user_email column — the QA/admin email
    // exclusions target its `email` column (same email-level semantics as
    // qaUserExclusionSQL on users / qaFunnelExclusionSQL on funnel_events).
    const adminConds =
      ADMIN_EMAILS.size === 0
        ? "TRUE"
        : ([...ADMIN_EMAILS]
            .map((e) => `LOWER(COALESCE(email, '')) <> '${e.toLowerCase()}'`)
            .join(" AND "));
    const rows: any[] = await sql()`
      SELECT COUNT(DISTINCT id) AS n FROM bid_scout_subscriptions
      WHERE (created_at >= ${fromIso} OR updated_at >= ${fromIso})
        AND ${sql().unsafe(qaUserExclusionSQL(""))}
        AND ${sql().unsafe(adminConds)}`;
    purchased = Number(rows?.[0]?.n ?? 0);
  } catch (err) {
    console.error("[bid-scout-funnel] purchased stage failed (continuing):", err);
  }

  const viewed = await stageCount("bid_scout_viewed");
  const checkoutStarted = await stageCount("bid_scout_checkout_started");

  return {
    range: "30d",
    stages: [
      { key: "viewed", label: "Bid Scout viewed", count: viewed },
      { key: "checkout_started", label: "Checkout started", count: checkoutStarted },
      { key: "purchased", label: "Purchased", count: purchased },
    ],
  };
}