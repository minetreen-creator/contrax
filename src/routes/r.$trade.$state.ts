import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { defaultRadarMatches } from "~/lib/radar-candidates";
import { RADAR_MATCH_CAP } from "~/lib/radar-config";
import { parseShareParams, shareHtml } from "~/lib/radar-share";

/**
 * /r/:trade/:state — the shareable Radar link (owner 2026-10-03; see
 * ~/lib/radar-share). Link previews read the live match count from the Open
 * Graph tags; people are redirected to the same Radar search. Cached at the
 * edge for an hour. A bad trade/state goes to /radar; a database error still
 * serves the page, just without a number.
 */
async function handler({ params }: { params: Record<string, string> }) {
  const parsed = parseShareParams(params.trade, params.state);
  if (!parsed) return new Response(null, { status: 302, headers: { location: "/radar" } });
  let count: number | null = null;
  let closestDue: string | null = null;
  try {
    const rows = await defaultRadarMatches(sql, { trade: parsed.trade, state: parsed.state });
    count = rows.length;
    const first = rows.find((r) => r.due_date);
    closestDue = first ? new Date(first.due_date).toISOString() : null;
  } catch (e) {
    console.error("[share] radar count failed (serving without a number):", (e as Error).message);
  }
  const html = shareHtml({
    trade: parsed.trade,
    state: parsed.state,
    count,
    cap: RADAR_MATCH_CAP,
    closestDue,
    now: new Date().toISOString(),
  });
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control":
        count == null ? "no-store" : "public, max-age=0, s-maxage=3600, stale-while-revalidate=600",
    },
  });
}

export const Route = createFileRoute("/r/$trade/$state")({ server: { handlers: { GET: handler } } });
