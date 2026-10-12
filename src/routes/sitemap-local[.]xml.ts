import { createFileRoute } from "@tanstack/react-router";
import { RESOLVED_AGENCIES, LOCAL_PLACES, agencyHref, placeHref } from "~/lib/local-agencies";
import { buildLocalSitemapXml } from "~/lib/local-sitemap";

/**
 * /sitemap-local.xml — the city/county and agency pages that have at least one
 * open bid right now (empty pages are noindex, so they stay out). Cached at the
 * edge for an hour; a database error returns 503 so crawlers retry.
 */
async function handler() {
  try {
    const { openCountsBySource } = await import("~/lib/local-landing");
    const counts = await openCountsBySource(RESOLVED_AGENCIES.map((a) => a.source));
    const paths = [
      "/local-bids",
      ...LOCAL_PLACES.filter((p) => p.agencies.some((a) => (counts[a.source] ?? 0) > 0)).map(placeHref),
      ...RESOLVED_AGENCIES.filter((a) => (counts[a.source] ?? 0) > 0).map(agencyHref),
    ];
    return new Response(buildLocalSitemapXml(paths), {
      status: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=600",
      },
    });
  } catch (e) {
    console.error("[sitemap-local] failed:", (e as Error).message);
    return new Response("Sitemap temporarily unavailable", { status: 503, headers: { "retry-after": "3600" } });
  }
}

export const Route = createFileRoute("/sitemap-local.xml")({ server: { handlers: { GET: handler } } });
