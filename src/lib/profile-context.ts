/**
 * Shared AI profile context builder.
 *
 * Every AI prompt in Contrax should "know" the business through the same,
 * consistent block of profile context. This module is the single source of
 * truth for turning a `BusinessProfile` into (a) a dense text summary that
 * gets injected into AI system/user prompts and (b) a set of scoring weights
 * that tell the AI which factors to prioritize for THIS particular business.
 *
 * Pure functions only — safe to import from server functions and client code.
 */

import type { BusinessProfile } from "~/components/CompanyProfile";

/** Normalizes a stored certification value into a display label. */
export function normalizeCert(cert: string): string {
  const c = String(cert || "").trim();
  const map: Record<string, string> = {
    "8a": "8(a)",
    "8(a)": "8(a)",
    hubzone: "HUBZone",
    wosb: "WOSB",
    edwosb: "EDWOSB",
    wosb_edwosb: "WOSB/EDWOSB",
    sdvosb: "SDVOSB",
    vosb: "VOSB",
    minority_owned: "Minority-Owned",
    minority: "Minority-Owned",
    disadvantaged: "Disadvantaged",
    veteran: "Veteran-Owned",
    service_disabled_veteran: "Service-Disabled Veteran-Owned",
    mbe: "MBE",
    wbe: "WBE",
    dbe: "DBE",
    sba: "SBA 8(a)",
  };
  if (map[c.toLowerCase()]) return map[c.toLowerCase()];
  return c;
}

function fmtList(value: unknown): string {
  return Array.isArray(value) && value.length > 0
    ? value.map((v) => String(v)).join(", ")
    : "";
}

/**
 * Builds a dense, readable text summary of the business profile, formatted for
 * injection into AI system/user prompts. Missing fields are skipped so the
 * block stays clean; when nothing is set a single fallback line is returned.
 */
export function buildProfileContext(profile: BusinessProfile): string {
  const p = (profile ?? {}) as Partial<BusinessProfile>;
  const lines: string[] = ["BUSINESS PROFILE:"];

  const push = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;
    lines.push(`${label}: ${String(value)}`);
  };

  push("Name", p.business_name);
  push("Industry", p.industry);
  push("NAICS", fmtList(p.naics_codes));
  push(
    "Certifications",
    Array.isArray(p.certifications) && p.certifications.length
      ? p.certifications.map((c) => normalizeCert(String(c))).join(", ")
      : "",
  );
  push("Locations", fmtList(p.locations));
  push("Services", fmtList(p.service_categories));
  push("Specialties", fmtList(p.specialties));
  push(
    "Licenses",
    Array.isArray(p.licenses) && p.licenses.length
      ? p.licenses
          .map((l) => {
            const lic = l as { type?: string; state?: string | null };
            const t = String(lic?.type || "").trim();
            if (!t) return "";
            return lic?.state ? `${t} (${lic.state})` : t;
          })
          .filter(Boolean)
          .join(", ")
      : "",
  );

  // Team line mirrors the canonical example: "24 employees, 12 years in business"
  const teamBits: string[] = [];
  if (p.employee_count != null && Number(p.employee_count) > 0) teamBits.push(`${p.employee_count} employees`);
  if (p.years_in_business != null && Number(p.years_in_business) > 0) teamBits.push(`${p.years_in_business} years in business`);
  push("Team", teamBits.join(", "));
  push("Annual revenue", p.annual_revenue);
  push("Entity type", p.is_agency ? "Government agency" : "Small business");

  const ids: string[] = [];
  if (p.uei) ids.push(`UEI ${p.uei}`);
  if (p.cage_code) ids.push(`CAGE ${p.cage_code}`);
  if (p.duns) ids.push(`DUNS ${p.duns}`);
  push("Registration IDs", ids.join(" / "));
  push("SAM registration expires", p.sam_expiration);

  push("Past performance", p.past_performance_summary);
  push("Capability statement", p.capability_statement);
  push("Typical contract size", p.typical_contract_value);

  return lines.length > 1
    ? lines.join("\n")
    : "BUSINESS PROFILE:\n(No profile information available)";
}

/**
 * Returns a set of factor weights the AI should prioritize when scoring an
 * opportunity for this business. Heavier weight = more influence on the
 * final recommendation.
 *
 * - Set-aside certified firms (8(a), HUBZone, SDVOSB…): certification match is decisive.
 * - Established/larger firms: past performance and experience dominate.
 * - Small, young firms: competition and size fit matter most (find winnable niches).
 */
export function buildScoringWeights(profile: BusinessProfile): Record<string, number> {
  const p = (profile ?? {}) as Partial<BusinessProfile>;
  const w: Record<string, number> = {
    industry_match: 0.2,
    naics_match: 0.2,
    experience_match: 0.2,
    size_fit: 0.15,
    competition: 0.15,
    agency_sentiment: 0.1,
  };

  const certs = Array.isArray(p.certifications) ? p.certifications.map((c) => String(c)) : [];
  const years = Number(p.years_in_business) || 0;
  const employees = Number(p.employee_count) || 0;
  const revenue = String(p.annual_revenue || "");

  const hasSetAside = certs.some((c) =>
    /8\(a\)|hubzone|sdvosb|vosb|wosb|edwosb|minority|disadvantaged|veteran|mbe|wbe|dbe/i.test(c),
  );
  if (hasSetAside) {
    // Set-aside eligibility is often the decisive filter — weight it hardest.
    w.certification_match = 0.25;
    w.naics_match = 0.2;
    w.experience_match = 0.15;
    w.size_fit = 0.15;
    w.competition = 0.1;
    w.agency_sentiment = 0.15;
  }

  const isLarge = years >= 10 || employees >= 50 || /10M|50M/.test(revenue);
  if (isLarge) {
    // Established firms win on track record — past performance and experience dominate.
    w.past_performance = 0.25;
    w.experience_match = 0.3;
    w.naics_match = 0.15;
    w.size_fit = 0.15;
    w.competition = 0.1;
    w.agency_sentiment = 0.05;
  }

  const isSmallNew = years < 3 && employees < 25 && !isLarge && !hasSetAside;
  if (isSmallNew) {
    // Young firms should hunt winnable niches — competition and size fit dominate.
    w.competition = 0.25;
    w.size_fit = 0.2;
    w.industry_match = 0.2;
    w.naics_match = 0.15;
    w.experience_match = 0.1;
    w.agency_sentiment = 0.1;
  }

  return w;
}
