import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";

/** Exports the waitlist as a CSV attachment for download. */
async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

  try {
    const rows = await sql()`SELECT email, source, created_at FROM waitlist ORDER BY created_at DESC`;
    const header = "email,source,created_at";
    const dataRows = (rows as any[]).map((r) =>
      `${r.email},${r.source || "landing_page"},${String(r.created_at)}`
    );
    const csv = [header, ...dataRows].join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="waitlist.csv"',
      },
    });
  } catch (err) {
    console.error("[api/admin/waitlist-csv] error:", err);
    return Response.json({ error: "Failed to export waitlist" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/waitlist-csv")({
  server: { handlers: { GET: handler } },
});
