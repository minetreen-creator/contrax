import { createFileRoute } from "@tanstack/react-router";
import { awardSitemapXml } from "~/lib/award-pages";

/**
 * /sitemap-awards.xml — the federal award pages (src/lib/award-pages.ts), newest first. Cached at
 * the edge for a day; a database error returns 503 so crawlers retry.
 */
async function handler() {
  try {
    const { awardSitemapRows } = await import("~/lib/award-pages.server");
    return new Response(awardSitemapXml(await awardSitemapRows()), {
      status: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=3600",
      },
    });
  } catch (e) {
    console.error("[sitemap-awards] failed:", (e as Error).message);
    return new Response("Sitemap temporarily unavailable", { status: 503, headers: { "retry-after": "3600" } });
  }
}

export const Route = createFileRoute("/sitemap-awards.xml")({ server: { handlers: { GET: handler } } });
