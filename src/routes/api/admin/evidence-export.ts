import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { EVIDENCE_PARTS, etStamp, evidenceCsv, evidencePart, inReconBlock, isScraperFingerprint, type EvidenceRow } from "~/lib/scraper-evidence";

/**
 * GET /api/admin/evidence-export?part=burst|recon — admin only (owner 2026-11-05).
 * Downloads the scraper's page views as CSV, straight to the owner's browser.
 * Nothing is logged but the row count.
 */
async function get({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  const part = evidencePart(new URL(request.url).searchParams.get("part"));
  if (!part) return Response.json({ error: "part must be burst or recon" }, { status: 400 });
  const { from, to, file } = EVIDENCE_PARTS[part];
  try {
    const raw = (await sql()`
      SELECT created_at, ip, path, user_agent, city, region, browser_label, visitor_id, referrer
      FROM page_views
      WHERE created_at >= ${from}::timestamptz AND created_at < ${to}::timestamptz
      ORDER BY created_at`) as Record<string, unknown>[];
    const keep = raw.filter((r) => (part === "burst" ? isScraperFingerprint(r.user_agent as string) : inReconBlock(r.ip as string)));
    const rows: EvidenceRow[] = keep.map((r) => {
      const at = new Date(r.created_at as string);
      const s = (v: unknown) => (v == null ? "" : String(v));
      return {
        time_et: etStamp(at), time_utc: at.toISOString(), ip: s(r.ip), path: s(r.path), user_agent: s(r.user_agent),
        city: s(r.city), region: s(r.region), browser: s(r.browser_label), visitor_id: s(r.visitor_id), referrer: s(r.referrer),
      };
    });
    console.log(`[api/admin/evidence-export] ${part}: ${rows.length} rows`);
    return new Response(evidenceCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[api/admin/evidence-export] failed:", (err as Error).message);
    return Response.json({ error: "Export failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/evidence-export")({ server: { handlers: { GET: get } } });
