/**
 * Small-business supplier directory (owner 2026-10-06, revenue idea #8). Small
 * businesses list themselves free; prime contractors, who need certified small
 * subcontractors to meet their subcontracting goals, pay to see contact details.
 * PURE helpers shared by the pages, API routes and tests.
 */

export const SUPPLIER_CERTS = [
  { code: "SDVOSB", label: "Service-Disabled Veteran-Owned (SDVOSB)" },
  { code: "VOSB", label: "Veteran-Owned (VOSB)" },
  { code: "WOSB", label: "Women-Owned (WOSB)" },
  { code: "EDWOSB", label: "Economically Disadvantaged Women-Owned (EDWOSB)" },
  { code: "8A", label: "SBA 8(a)" },
  { code: "HUBZONE", label: "HUBZone" },
  { code: "SDB", label: "Small Disadvantaged Business (SDB)" },
  { code: "SMALL", label: "Small business" },
] as const;
export type SupplierCert = (typeof SUPPLIER_CERTS)[number]["code"];
const CERT_CODES = new Set<string>(SUPPLIER_CERTS.map((c) => c.code));
export const certLabel = (code: string) => SUPPLIER_CERTS.find((c) => c.code === code)?.label ?? code;

/** The paid plan for primes is offered only once the directory has this many listings. */
export const DIRECTORY_MIN_LISTINGS_TO_SELL = 25;

export interface SupplierProfileInput {
  company_name: string;
  uei: string | null;
  certifications: string[];
  naics: string[];
  states: string[];
  city: string | null;
  capabilities: string;
  website: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  listed: boolean;
}

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(String) : String(v ?? "").split(","))
    .map((s) => s.trim())
    .filter(Boolean);
const opt = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

/** Validate the listing form. Returns the normalized profile or the first problem, in plain words. */
export function validateSupplierProfile(raw: Record<string, unknown>): { ok: true; profile: SupplierProfileInput } | { ok: false; error: string } {
  const company_name = String(raw.company_name ?? "").trim();
  if (company_name.length < 2 || company_name.length > 120) return { ok: false, error: "Enter your company name." };

  const uei = opt(raw.uei, 20)?.toUpperCase() ?? null;
  if (uei && !/^[A-Z0-9]{12}$/.test(uei)) return { ok: false, error: "A UEI is 12 letters and numbers (from SAM.gov). Leave it blank if you don't have one yet." };

  const certifications = [...new Set(list(raw.certifications).map((c) => c.toUpperCase()))];
  const badCert = certifications.find((c) => !CERT_CODES.has(c));
  if (badCert) return { ok: false, error: `Unknown certification "${badCert}".` };

  const naics = [...new Set(list(raw.naics))];
  if (naics.length === 0) return { ok: false, error: "Add at least one NAICS code for the work you do, e.g. 238220." };
  if (naics.length > 15) return { ok: false, error: "Up to 15 NAICS codes." };
  const badNaics = naics.find((n) => !/^\d{2,6}$/.test(n));
  if (badNaics) return { ok: false, error: `NAICS codes are 2–6 digits ("${badNaics}" is not).` };

  const states = [...new Set(list(raw.states).map((s) => s.toUpperCase()))];
  if (states.length === 0) return { ok: false, error: "Add the states you work in, e.g. VA, NC." };
  const badState = states.find((s) => !/^[A-Z]{2}$/.test(s));
  if (badState) return { ok: false, error: `Use two-letter state codes ("${badState}" is not one).` };

  const capabilities = String(raw.capabilities ?? "").trim();
  if (capabilities.length < 20) return { ok: false, error: "Describe what your company does in a sentence or two." };
  if (capabilities.length > 1500) return { ok: false, error: "Keep the description under 1,500 characters." };

  let website = opt(raw.website, 200);
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  if (website && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(website)) return { ok: false, error: "That website address doesn't look right." };

  const contact_name = String(raw.contact_name ?? "").trim().slice(0, 80);
  if (contact_name.length < 2) return { ok: false, error: "Enter a contact name." };
  const contact_email = String(raw.contact_email ?? "").trim().toLowerCase().slice(0, 160);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) return { ok: false, error: "Enter a contact email." };
  const contact_phone = opt(raw.contact_phone, 30);

  return {
    ok: true,
    profile: {
      company_name,
      uei,
      certifications,
      naics,
      states,
      city: opt(raw.city, 80),
      capabilities,
      website,
      contact_name,
      contact_email,
      contact_phone,
      listed: raw.listed !== false,
    },
  };
}

export interface SupplierQuery {
  naics: string | null;
  state: string | null;
  cert: string | null;
  q: string | null;
}

export function parseSupplierQuery(p: URLSearchParams): SupplierQuery {
  const naics = (p.get("naics") ?? "").trim();
  const state = (p.get("state") ?? "").trim().toUpperCase();
  const cert = (p.get("cert") ?? "").trim().toUpperCase();
  const q = (p.get("q") ?? "").trim().slice(0, 60);
  return {
    naics: /^\d{2,6}$/.test(naics) ? naics : null,
    state: /^[A-Z]{2}$/.test(state) ? state : null,
    cert: CERT_CODES.has(cert) ? cert : null,
    q: q || null,
  };
}

/** What everyone sees; contact fields are filled only for paying primes. */
export interface SupplierListing {
  id: number;
  company_name: string;
  certifications: string[];
  naics: string[];
  states: string[];
  city: string | null;
  capabilities: string;
  uei: string | null;
  website: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}
