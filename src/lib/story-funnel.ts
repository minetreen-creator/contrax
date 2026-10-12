import { learningCounts, type LearnVisitor } from "~/lib/learn-funnel";

export const STORY_PATHS = ["/our-story", "/our-story/"];

export type StoryVisitor = Omit<LearnVisitor, "learn_at" | "opened_at" | "completed_at"> & { story_at: string };

export function storyCounts(rows: StoryVisitor[]) {
  const { visitors, radar, signup, activated, subscriptions } = learningCounts(
    rows.map(row => ({ ...row, learn_at: row.story_at })),
  );
  return { visitors, radar, signup, activated, subscriptions };
}

export type StoryCounts = ReturnType<typeof storyCounts>;

// Only trusted exclusion predicates are interpolated; dates, paths and events are parameters.
export function storyQuery(human: string, qaUser: string) {
  return `
    WITH events AS (
      SELECT visitor_id, created_at, event_name, user_id FROM funnel_events
      WHERE created_at >= $1 AND created_at < $2
        AND visitor_id IS NOT NULL AND visitor_id <> '' AND ${human}
    ), story AS (
      SELECT visitor_id, MIN(created_at) AS story_at FROM page_views
      WHERE created_at >= $1 AND created_at < $2
        AND visitor_id IS NOT NULL AND visitor_id <> '' AND ${human}
        AND split_part(split_part(path, '?', 1), '#', 1) = ANY($3)
      GROUP BY visitor_id
    )
    SELECT s.visitor_id, s.story_at,
      MIN(e.created_at) FILTER (WHERE e.event_name = 'radar_scan_complete') AS radar_at,
      MIN(e.created_at) FILTER (WHERE e.event_name = 'signup_success') AS signup_at,
      MIN(e.created_at) FILTER (WHERE e.event_name = ANY($4)) AS activated_at,
      MAX(u.id::text) FILTER (WHERE e.event_name = 'signup_success'
        AND u.subscription_status = 'active') AS active_user_id
    FROM story s
    LEFT JOIN events e ON e.visitor_id = s.visitor_id AND e.created_at > s.story_at
    LEFT JOIN users u ON u.id::text = e.user_id
      AND NOT COALESCE(u.is_admin, false) AND ${qaUser}
    GROUP BY s.visitor_id, s.story_at
  `;
}
