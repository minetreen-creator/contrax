// Filters are trusted server constants; all request-derived values use SQL parameters.
export function learningQuery(human: string, qaUser: string) {
  return `
      WITH events AS (
        SELECT visitor_id, created_at, event_name, path, user_id FROM funnel_events
        WHERE created_at >= $1 AND created_at < $2
          AND visitor_id IS NOT NULL AND visitor_id <> '' AND ${human}
      ), pages AS (
        SELECT visitor_id, created_at, split_part(path, '?', 1) AS path FROM page_views
        WHERE created_at >= $1 AND created_at < $2
          AND visitor_id IS NOT NULL AND visitor_id <> '' AND ${human}
      ), learning AS (
        SELECT visitor_id, MIN(created_at) AS learn_at FROM (
          SELECT visitor_id, created_at FROM pages WHERE path = ANY($3)
          UNION ALL
          SELECT visitor_id, created_at FROM events
          WHERE event_name IN ('learn_page_view', 'course_started', 'course_completed')
            AND split_part(path, '?', 1) = ANY($3)
        ) visits GROUP BY visitor_id
      ), activity AS (
        SELECT l.visitor_id, l.learn_at,
          MIN(e.created_at) FILTER (WHERE e.event_name = 'course_started') AS started_at,
          MIN(e.created_at) FILTER (WHERE e.event_name = 'course_completed') AS completed_at,
          MIN(e.created_at) FILTER (WHERE e.event_name = 'radar_scan_complete') AS radar_at,
          MIN(e.created_at) FILTER (WHERE e.event_name = 'signup_success') AS signup_at,
          MIN(e.created_at) FILTER (WHERE e.event_name = ANY($4)) AS activated_at,
          MAX(u.id::text) FILTER (WHERE e.event_name = 'signup_success' AND u.subscription_status = 'active') AS active_user_id
        FROM learning l LEFT JOIN events e ON e.visitor_id = l.visitor_id AND e.created_at >= l.learn_at
        LEFT JOIN users u ON u.id::text = e.user_id AND NOT COALESCE(u.is_admin, false) AND ${qaUser}
        GROUP BY l.visitor_id, l.learn_at
      ) SELECT a.*, LEAST(a.started_at, (
        SELECT MIN(p.created_at) FROM pages p WHERE p.visitor_id = a.visitor_id
          AND p.created_at >= a.learn_at AND p.path = ANY($5)
      )) AS opened_at FROM activity a`;
}
