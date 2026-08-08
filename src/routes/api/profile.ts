import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import type { License } from "~/lib/healthcare";

/**
 * Business profile endpoint — replaces the saveProfile (onboarding + settings)
 * and fetchProfile (settings) createServerFn RPCs, which silently fail on
 * production Vercel.
 *
 * POST accepts BOTH payload shapes:
 *  - Onboarding: { businessName, industry, locations, services, naicsCodes[], certifications[] }
 *  - Settings:   { businessName, uei, cageCode, duns, samExpiration, certifications,
 *                  certificationDates, yearsInBusiness, employeeCount, annualRevenue,
 *                  pastPerformance, capabilityStatement, industry, locations,
 *                  naicsCodes (comma-separated string), specialties, licenses,
 *                  typicalContractValue }
 * The two flows are detected by the presence of `services` (only onboarding
 * sends it) and handled exactly as the two original handlers did.
 */

interface ProfilePayload {
  businessName?: string;
  industry?: string;
  locations?: string[];
  services?: string[];
  naicsCodes?: string[] | string;
  certifications?: string[];
  uei?: string;
  cageCode?: string;
  duns?: string;
  samExpiration?: string;
  certificationDates?: Record<string, string>;
  yearsInBusiness?: string;
  employeeCount?: string;
  annualRevenue?: string;
  pastPerformance?: string;
  capabilityStatement?: string;
  specialties?: string[];
  licenses?: License[];
  typicalContractValue?: string;
}

async function saveProfileHandler(request: Request): Promise<Response> {
  try {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as ProfilePayload | null;
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const d = body as ProfilePayload;
  // ── Validation (preserves the original onboarding + settings validators) ──
  if (!d.businessName || d.businessName.trim().length === 0) {
    return Response.json({ error: "Business name is required." }, { status: 400 });
  }
  const isOnboarding = Array.isArray(d.services);
  if (isOnboarding) {
    if (!d.industry) {
      return Response.json({ error: "Please select an industry." }, { status: 400 });
    }
    if (!Array.isArray(d.locations) || d.locations.length === 0) {
      return Response.json({ error: "Please select at least one location." }, { status: 400 });
    }
    if (!Array.isArray(d.services) || d.services.length === 0) {
      return Response.json({ error: "Please select at least one service." }, { status: 400 });
    }
  }
  const businessName = d.businessName.trim();
  const industry = (d.industry ?? "").trim();
  const locations = Array.isArray(d.locations) ? d.locations : [];
  const services = isOnboarding ? (d.services as string[]) : [];
  // naicsCodes arrives as an array from onboarding, comma-separated text from settings.
  let naicsArray: string[] = [];
  if (Array.isArray(d.naicsCodes)) {
    naicsArray = d.naicsCodes.filter((c): c is string => typeof c === "string" && c.trim().length > 0);
  } else if (typeof d.naicsCodes === "string" && d.naicsCodes.trim().length > 0) {
    naicsArray = d.naicsCodes.split(",").map((c) => c.trim()).filter((c) => c.length > 0);
  }
  const certifications = Array.isArray(d.certifications) ? d.certifications : [];
  const certificationDates =
    d.certificationDates && typeof d.certificationDates === "object" && !Array.isArray(d.certificationDates)
      ? Object.fromEntries(
          Object.entries(d.certificationDates).filter(
            ([key, value]) =>
              certifications.includes(key) && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
          ),
        )
      : {};
  const yearsInBusiness = d.yearsInBusiness ? parseInt(d.yearsInBusiness, 10) || null : null;
  const employeeCount = d.employeeCount ? parseInt(d.employeeCount, 10) || null : null;
  const specialties = Array.isArray(d.specialties)
    ? d.specialties.filter((s: string) => typeof s === "string" && s.trim().length > 0).map((s: string) => s.trim())
    : [];
  const licenses = Array.isArray(d.licenses)
    ? d.licenses
        .filter((l: License) => l && typeof l.type === "string" && l.type.trim().length > 0)
        .map((l: License) => ({ type: l.type.trim(), state: (l.state || "").trim() || null, expires: (l.expires || "").trim() || null }))
    : [];

  // ── Lazy column migrations (backward compat, all idempotent) ─────────────
  try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS naics_codes JSONB DEFAULT '[]'::jsonb`; } catch {}
  try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS certifications JSONB DEFAULT '[]'::jsonb`; } catch {}
  try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS specialties JSONB DEFAULT '[]'::jsonb`; } catch {}
  try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS licenses JSONB DEFAULT '[]'::jsonb`; } catch {}
  try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS typical_contract_value TEXT`; } catch {}
  try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS certification_dates JSONB DEFAULT '{}'::jsonb`; } catch {}

  const existing = await sql()`SELECT id FROM business_profiles WHERE user_id = ${user.id}`;
  if (existing.length > 0) {
    if (isOnboarding) {
      await sql()`
        UPDATE business_profiles
        SET business_name = ${businessName},
            industry = ${industry},
            locations = ${JSON.stringify(locations)}::jsonb,
            service_categories = ${JSON.stringify(services)}::jsonb,
            naics_codes = ${JSON.stringify(naicsArray)}::jsonb,
            certifications = ${JSON.stringify(certifications)}::jsonb,
            updated_at = NOW()
        WHERE user_id = ${user.id}
      `;
    } else {
      await sql()`
        UPDATE business_profiles
        SET business_name = ${businessName},
            industry = ${industry},
            locations = ${JSON.stringify(locations)}::jsonb,
            naics_codes = ${JSON.stringify(naicsArray)}::jsonb,
            uei = ${d.uei ? d.uei.trim() : null},
            cage_code = ${d.cageCode ? d.cageCode.trim() : null},
            duns = ${d.duns ? d.duns.trim() : null},
            sam_expiration = ${d.samExpiration ? d.samExpiration.trim() : null}::date,
            certifications = ${JSON.stringify(certifications)}::jsonb,
            certification_dates = ${JSON.stringify(certificationDates)}::jsonb,
            years_in_business = ${yearsInBusiness},
            employee_count = ${employeeCount},
            annual_revenue = ${d.annualRevenue ? d.annualRevenue.trim() : null},
            past_performance_summary = ${d.pastPerformance ? d.pastPerformance.trim() : null},
            capability_statement = ${d.capabilityStatement ? d.capabilityStatement.trim() : null},
            specialties = ${JSON.stringify(specialties)}::jsonb,
            licenses = ${JSON.stringify(licenses)}::jsonb,
            typical_contract_value = ${d.typicalContractValue ? d.typicalContractValue.trim() : null},
            updated_at = NOW()
        WHERE user_id = ${user.id}
      `;
    }
  } else if (isOnboarding) {
    await sql()`
      INSERT INTO business_profiles (user_id, business_name, industry, locations, service_categories, naics_codes, certifications)
      VALUES (${user.id}, ${businessName}, ${industry}, ${JSON.stringify(locations)}::jsonb, ${JSON.stringify(services)}::jsonb, ${JSON.stringify(naicsArray)}::jsonb, ${JSON.stringify(certifications)}::jsonb)
    `;
  } else {
    await sql()`
      INSERT INTO business_profiles (
        user_id, business_name, industry, locations, naics_codes,
        uei, cage_code, duns, sam_expiration, certifications, certification_dates,
        years_in_business, employee_count, annual_revenue,
        past_performance_summary, capability_statement,
        specialties, licenses, typical_contract_value
      )
      VALUES (
        ${user.id}, ${businessName}, ${industry},
        ${JSON.stringify(locations)}::jsonb, ${JSON.stringify(naicsArray)}::jsonb,
        ${d.uei ? d.uei.trim() : null}, ${d.cageCode ? d.cageCode.trim() : null}, ${d.duns ? d.duns.trim() : null},
        ${d.samExpiration ? d.samExpiration.trim() : null}::date,
        ${JSON.stringify(certifications)}::jsonb,
        ${JSON.stringify(certificationDates)}::jsonb,
        ${yearsInBusiness}, ${employeeCount}, ${d.annualRevenue ? d.annualRevenue.trim() : null},
        ${d.pastPerformance ? d.pastPerformance.trim() : null}, ${d.capabilityStatement ? d.capabilityStatement.trim() : null},
        ${JSON.stringify(specialties)}::jsonb,
        ${JSON.stringify(licenses)}::jsonb,
        ${d.typicalContractValue ? d.typicalContractValue.trim() : null}
      )
    `;
  }
  return Response.json({ success: true });
  } catch (err: any) {
    console.error("[api/profile POST]", err?.message || err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function getProfileHandler(request: Request): Promise<Response> {
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

  export const Route = createFileRoute("/api/profile")({
  server: {
    handlers: {
      POST: saveProfileHandler,
      GET: getProfileHandler,
    },
  },
});
