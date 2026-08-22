import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";

/**
 * Targeted, PARTIAL business-profile updates for the dashboard's online
 * filter-chip removal ("X" on a state / set-aside / NAICS chip) and the
 * zero-matches "Broaden search (Include Nationwide)" action.
 *
 * Unlike `/api/profile` — which REPLACES the whole profile row on save (it
 * rewrites locations, naics_codes, certifications AND blanks the sibling
 * fields it isn't given, like specialties / licenses / uei / cage_code) — this
 * endpoint patches ONLY the filter-relevant columns it is given. Removing one
 * dimension (e.g. the geo states) must never wipe the user's other profile
 * fields. All values are validated to their exact shape (2-letter states,
 * 6-digit NAICS, non-empty cert keys) and bound as JSONB parameters.
 *
 * Body (all optional; only those present are updated):
 *   { locations?: string[], naicsCodes?: string[], certifications?: string[] }
 */
async function handler({ request }: { request: Request }): Promise<Response> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    const body = (await request.json().catch(() => null)) as {
      locations?: unknown;
      naicsCodes?: unknown;
      certifications?: unknown;
    } | null;
    if (typeof body !== "object" || body === null) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }

    // Lazy migrations (idempotent; match the sibling endpoints).
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS locations JSONB DEFAULT '[]'::jsonb`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS naics_codes JSONB DEFAULT '[]'::jsonb`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS certifications JSONB DEFAULT '[]'::jsonb`; } catch {}

    const sets: string[] = [];
    const vals: unknown[] = [];
    const addJsonb = (col: string, raw: unknown, valid: (v: unknown) => boolean) => {
      if (!Array.isArray(raw)) return;
      const cleaned = raw.filter(valid);
      sets.push(`${col} = $${vals.length + 1}::jsonb`);
      vals.push(JSON.stringify(cleaned));
    };

    addJsonb("locations", body.locations, (v) => typeof v === "string" && /^[A-Z]{2}$/.test(v));
    addJsonb("naics_codes", body.naicsCodes, (v) => typeof v === "string" && /^\d{6}$/.test(v.trim()));
    addJsonb("certifications", body.certifications, (v) => typeof v === "string" && v.trim().length > 0);

    if (sets.length === 0) {
      return Response.json({ error: "Nothing to update" }, { status: 400 });
    }
    sets.push("updated_at = NOW()");
    const whereSql = `WHERE user_id = $${vals.length + 1}`;
    vals.push(user.id);
    const q = `UPDATE business_profiles SET ${sets.join(", ")} ${whereSql}`;
    // multi-column dynamic UPDATE — built from hardcoded column names + bound
    // params only (no user-substituted identifiers or unbound text).
    // `~/db` `sql` is a factory: call it first to get the Neon query function
    // (which carries `.query`), never `sql.query` directly.
    await sql().query(q, vals);
    return Response.json({ success: true });
  } catch (err) {
    console.error("[api/profile-filters] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to update filters" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/profile-filters")({
  server: { handlers: { POST: handler } },
});
