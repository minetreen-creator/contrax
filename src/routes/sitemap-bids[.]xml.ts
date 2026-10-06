import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { noticeKeySql } from "~/lib/notice-dedupe";
import { BID_SITEMAP_MAX_URLS, buildBidSitemapXml } from "~/lib/bid-seo";

/**
 * /sitemap-bids.xml — every OPEN bid page (/bid/:id), built live from the
 * database (bids change every 4 hours on weekdays; public/sitemap.xml only changes on
 * deploy). Same filters as the public bid lists: open, not low-content, not an
 * award row, one page per notice. Listed in robots.txt. Cached at the edge for
 * an hour. A database error returns 503 so crawlers retry instead of reading
 * an empty sitemap as "no pages".
 */
async function handler() {
  try {
    const rows = (await sql()`
      SELECT id, created_at FROM (
        SELECT DISTINCT ON (${sql().unsafe(noticeKeySql("bids"))}) id, created_at
        FROM bids
        WHERE due_date > NOW()
          AND ${sql().unsafe(LOW_CONTENT_SQL)}
          AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
        ORDER BY ${sql().unsafe(noticeKeySql("bids"))}, created_at DESC NULLS LAST
      ) t
      ORDER BY created_at DESC NULLS LAST
      LIMIT ${BID_SITEMAP_MAX_URLS}
    `) as { id: number; created_at: string | Date | null }[];
    const xml = buildBidSitemapXml(
      rows.map((r) => ({ id: Number(r.id), lastmod: r.created_at ? new Date(r.created_at).toISOString() : null })),
    );
    return new Response(xml, {
      status: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=600",
      },
    });
  } catch (e) {
    console.error("[sitemap-bids] failed:", (e as Error).message);
    return new Response("Sitemap temporarily unavailable", { status: 503, headers: { "retry-after": "3600" } });
  }
}

export const Route = createFileRoute("/sitemap-bids.xml")({ server: { handlers: { GET: handler } } });
