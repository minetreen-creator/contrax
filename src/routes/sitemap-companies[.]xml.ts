import { createFileRoute } from "@tanstack/react-router";
import { companySitemapIndexXml, companySitemapXml } from "~/lib/company-pages";

/**
 * /sitemap-companies.xml — the company pages (src/lib/company-pages.ts). With no query it is a
 * sitemap index, one child per state; with ?state=VA it lists that state's company pages. Cached
 * at the edge for a day; a database error returns 503 so crawlers retry.
 */
async function handler({ request }: { request: Request }) {
  try {
    const state = (new URL(request.url).searchParams.get("state") ?? "").toUpperCase();
    const { companySitemapRows, companySitemapStates } = await import("~/lib/company-pages.server");
    const xml = state
      ? companySitemapXml(await companySitemapRows(state))
      : companySitemapIndexXml(await companySitemapStates());
    return new Response(xml, {
      status: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=3600",
      },
    });
  } catch (e) {
    console.error("[sitemap-companies] failed:", (e as Error).message);
    return new Response("Sitemap temporarily unavailable", { status: 503, headers: { "retry-after": "3600" } });
  }
}

export const Route = createFileRoute("/sitemap-companies.xml")({ server: { handlers: { GET: handler } } });
