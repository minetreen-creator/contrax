import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";

async function getProfileHandler({ request }: { request: Request }): Promise<Response> {
  try {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  // Lazy migration guards for the healthcare staffing columns.
  try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS specialties JSONB DEFAULT '[]'::jsonb`; } catch {}
  try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS licenses JSONB DEFAULT '[]'::jsonb`; } catch {}
  try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS typical_contract_value TEXT`; } catch {}
  try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS certification_dates JSONB DEFAULT '{}'::jsonb`; } catch {}
  const rows = await sql()`
    SELECT id, business_name, industry, locations, service_categories, naics_codes,
           uei, cage_code, duns, sam_expiration, certifications, certification_dates,
           years_in_business, employee_count, annual_revenue,
           past_performance_summary, capability_statement,
           specialties, licenses, typical_contract_value
    FROM business_profiles
    WHERE user_id = ${user.id}
    LIMIT 1
  `;
  if (rows.length === 0) return Response.json(null);
  const p = rows[0] as any;
  return Response.json({
    id: p.id,
    business_name: p.business_name ?? "",
    industry: p.industry ?? "",
    locations: Array.isArray(p.locations) ? p.locations : [],
    service_categories: Array.isArray(p.service_categories) ? p.service_categories : [],
    naics_codes: Array.isArray(p.naics_codes) ? p.naics_codes : [],
    uei: p.uei ?? null,
    cage_code: p.cage_code ?? null,
    duns: p.duns ?? null,
    sam_expiration: p.sam_expiration ? String(p.sam_expiration).slice(0, 10) : null,
    certifications: Array.isArray(p.certifications) ? p.certifications : [],
    certification_dates:
      p.certification_dates && typeof p.certification_dates === "object" && !Array.isArray(p.certification_dates)
        ? p.certification_dates
        : {},
    years_in_business: p.years_in_business ?? null,
    employee_count: p.employee_count ?? null,
    annual_revenue: p.annual_revenue ?? null,
    past_performance_summary: p.past_performance_summary ?? null,
    capability_statement: p.capability_statement ?? null,
    specialties: Array.isArray(p.specialties) ? p.specialties : [],
    licenses: Array.isArray(p.licenses) ? p.licenses : [],
    typical_contract_value: p.typical_contract_value ?? null,
  });
  } catch (err: any) {
  console.error("[api/profile GET]", err?.message || err);
  return Response.json({ error: "Internal server error" }, { status: 500 });
  }
  }

export const Route = createFileRoute("/api/profile-data")({
  server: {
    handlers: {
      GET: getProfileHandler,
    },
  },
});
