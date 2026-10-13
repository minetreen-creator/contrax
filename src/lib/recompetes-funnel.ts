/**
 * Contracts Ending Soon funnel (owner 2026-10-13): /recompetes visitors and the
 * same later business activity the Story funnel measures, plus the page's three
 * clicks (homepage section, create-account, upgrade). Reuses the Story query,
 * which takes its page paths as a parameter.
 */
import { storyCounts, type StoryVisitor } from "~/lib/story-funnel";

export const RECOMPETES_PATHS = ["/recompetes", "/recompetes/"];
export const RECOMPETES_CLICK_EVENTS = ["recompetes_home_click", "recompetes_signup_click", "recompetes_upgrade_click"] as const;

export function recompetesCounts(rows: StoryVisitor[], clicks: { event_name: string; visitors: number }[]) {
  const s = storyCounts(rows);
  const click = (e: string) => Number(clicks.find((c) => c.event_name === e)?.visitors ?? 0);
  return {
    homeClicks: click("recompetes_home_click"),
    visitors: s.visitors,
    signupClicks: click("recompetes_signup_click"),
    upgradeClicks: click("recompetes_upgrade_click"),
    signup: s.signup,
    activated: s.activated,
    subscriptions: s.subscriptions,
  };
}

export type RecompetesCounts = ReturnType<typeof recompetesCounts>;

/** Distinct visitors per click event. Only trusted exclusion predicates are interpolated. */
export function recompetesClicksQuery(human: string) {
  return `
    SELECT event_name, COUNT(DISTINCT visitor_id)::int AS visitors FROM funnel_events
    WHERE created_at >= $1 AND created_at < $2 AND event_name = ANY($3)
      AND visitor_id IS NOT NULL AND visitor_id <> '' AND ${human}
    GROUP BY event_name
  `;
}
