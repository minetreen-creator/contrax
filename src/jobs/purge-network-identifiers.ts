import { sql } from "~/db";

export const NETWORK_IDENTIFIER_RETENTION_DAYS = 90;

/**
 * Remove raw IP values after the disclosed retention window while preserving
 * the behavioral rows and aggregate analytics they support.
 */
export async function purgeExpiredNetworkIdentifiers(): Promise<Record<string, number>> {
  const interval = `${NETWORK_IDENTIFIER_RETENTION_DAYS} days`;
  const pageViews = await sql()`UPDATE page_views SET ip = NULL
    WHERE ip IS NOT NULL AND created_at < NOW() - ${interval}::interval RETURNING 1`;
  const funnelEvents = await sql()`UPDATE funnel_events SET ip = NULL
    WHERE ip IS NOT NULL AND created_at < NOW() - ${interval}::interval RETURNING 1`;
  const visitorFirst = await sql()`UPDATE visitors SET first_ip = NULL
    WHERE first_ip IS NOT NULL AND first_seen_at < NOW() - ${interval}::interval RETURNING 1`;
  const visitorLast = await sql()`UPDATE visitors SET last_ip = NULL
    WHERE last_ip IS NOT NULL AND last_seen_at < NOW() - ${interval}::interval RETURNING 1`;
  return {
    page_views: pageViews.length,
    funnel_events: funnelEvents.length,
    visitor_first_ip: visitorFirst.length,
    visitor_last_ip: visitorLast.length,
  };
}

if (import.meta.main) {
  const result = await purgeExpiredNetworkIdentifiers();
  console.log(`[network-retention] ${JSON.stringify(result)}`);
}
