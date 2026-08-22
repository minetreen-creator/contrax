import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";
import { countRoleMatches } from "~/lib/healthcare";
import { ARCHIVED_STATUSES, DEAD_SQL } from "~/lib/bid-status";
import { locationMatchesStates, naicsPred, setAsidePredMulti } from "~/lib/open-bids";
import { LOW_CONTENT_SQL } from "~/lib/low-content";

// Mirrors the Bid shape from /api/dashboard-data, plus `status` (the user's
// saved_matches.status, or null when the bid was never saved/dismissed) so the
// archive tab can label WHY each item was archived.
interface ArchiveBid {
  id: number; title: string; agency: string; description: string;
  location: string; category: string; set_aside: string | null; due_date: string; estimated_value: string;
  source_url: string | null; role_matches: number;
  naics_code: string | null; created_at: string; status: string | null;
}

async function handler({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

    // Lazy migration guards (same pattern as dashboard-data) so old DBs interpret
    // set_aside / specialties consistently with the live feed.
    try { await sql()`ALTER TABLE bids ADD COLUMN IF NOT EXISTS set_aside TEXT`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS specialties JSONB DEFAULT '[]'::jsonb`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS certifications JSONB DEFAULT '[]'::jsonb`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS naics_codes JSONB DEFAULT '[]'::jsonb`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS locations JSONB DEFAULT '[]'::jsonb`; } catch {}
    let specialties: string[] = [];
    let certifications: string[] = [];
    let naicsCodes: string[] = [];
    let locations: string[] = [];
    try {
      const pr = await sql()`SELECT specialties, certifications, naics_codes, locations FROM business_profiles WHERE user_id = ${user.id}`;
      if (pr.length > 0) {
        const p = pr[0] as any;
        specialties = Array.isArray(p.specialties) ? p.specialties : [];
        certifications = Array.isArray(p.certifications) ? p.certifications : [];
        naicsCodes = Array.isArray(p.naics_codes) ? p.naics_codes : [];
        locations = Array.isArray(p.locations) ? p.locations : [];
      }
    } catch {}

    // ARCHIVED = closed/no-go: due strictly before today, OR this user
    // dismissed/closed it (regardless of due date), filtered to the SAME
    // profile relevance as the live feed (set-aside + NAICS SQL predicates +
    // location), deduped on (title, agency). LEFT JOIN saved_matches so each
    // row carries the status that put it here.
    const setAsideFrag = setAsidePredMulti(certifications, sql);
    const naicsFrag = naicsPred(naicsCodes, sql);
    const rows = await sql()`SELECT * FROM (
      SELECT DISTINCT ON (b.title, b.agency)
        b.id, b.title, b.agency, b.description, b.location, b.category, b.set_aside,
        b.due_date, b.estimated_value, b.source_url, b.naics_code, b.created_at, sm.status
      FROM bids b
      LEFT JOIN saved_matches sm ON sm.bid_id = b.id AND sm.user_id = ${user.id}
      WHERE (${sql().unsafe(DEAD_SQL)}
         OR sm.status = ANY(${ARCHIVED_STATUSES}))
        AND ${sql().unsafe(LOW_CONTENT_SQL)}
        ${setAsideFrag} ${naicsFrag}
      ORDER BY b.title, b.agency
    ) a
    ORDER BY due_date DESC NULLS LAST`;

    const bids: ArchiveBid[] = (rows as any[])
      .filter((b) => locationMatchesStates(b.location, locations))
      .map((b) => ({
        id: b.id, title: b.title, agency: b.agency, description: b.description,
        location: b.location, category: b.category, set_aside: b.set_aside ?? null,
        due_date: b.due_date ? String(b.due_date) : "",
        estimated_value: b.estimated_value, source_url: b.source_url,
        naics_code: b.naics_code ?? null,
        created_at: b.created_at ? String(b.created_at) : "",
        status: b.status ?? null,
        role_matches: countRoleMatches(b as any, specialties),
      }));

    return Response.json({ bids });
  } catch (err) {
    console.error("[api/dashboard-archive] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load archived bids" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/dashboard-archive")({
  server: { handlers: { GET: handler } },
});
