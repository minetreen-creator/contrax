/**
 * Visitor country for the admin board (owner 2026-10-06).
 *
 * Rows from 2026-10-06 on carry the real country (x-vercel-ip-country). Older
 * rows only have a region code, and region codes collide across countries
 * (Lagos state is "LA", same as Louisiana), so for those the country is an
 * ESTIMATE and is labeled as one. Pure: safe for the client bundle.
 */

const US_REGION_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA",
  "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR",
  "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR", "GU", "VI", "AS", "MP",
]);

/** Foreign cities whose region code is also a US state code (seen on the board). */
const FOREIGN_CITY_ON_US_CODE = new Set(["lagos", "ikeja", "ebute ikorodu", "ikorodu", "lekki"]);

export interface VisitorCountry {
  /** "US", another ISO code, or "??" when outside the US but the country is unknown. */
  code: string;
  /** True when it came from the recorded country, false when estimated from the region code. */
  exact: boolean;
}

export function visitorCountry(country: string | null | undefined, region: string | null | undefined, city: string | null | undefined): VisitorCountry | null {
  const c = (country ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(c)) return { code: c, exact: true };
  const r = (region ?? "").trim().toUpperCase();
  if (!r) return null;
  const cityLc = (city ?? "").trim().toLowerCase();
  if (US_REGION_CODES.has(r) && !FOREIGN_CITY_ON_US_CODE.has(cityLc)) return { code: "US", exact: false };
  return { code: "??", exact: false };
}

export function isUsVisitor(country: string | null | undefined, region: string | null | undefined, city: string | null | undefined): boolean {
  return visitorCountry(country, region, city)?.code === "US";
}

const NAMES: Record<string, string> = {
  US: "United States", NG: "Nigeria", SA: "Saudi Arabia", MG: "Madagascar", PH: "Philippines", IN: "India",
  PK: "Pakistan", GB: "United Kingdom", CA: "Canada", MA: "Morocco", IL: "Israel", IT: "Italy", FR: "France",
  IQ: "Iraq", TT: "Trinidad and Tobago", IS: "Iceland", KE: "Kenya", GH: "Ghana", AE: "United Arab Emirates",
};

/** "Nigeria", "United States (est.)", "Outside the US (est.)". */
export function countryLabel(v: VisitorCountry | null): string {
  if (!v) return "Unknown";
  if (v.code === "??") return "Outside the US (est.)";
  const name = NAMES[v.code] ?? v.code;
  return v.exact ? name : `${name} (est.)`;
}
