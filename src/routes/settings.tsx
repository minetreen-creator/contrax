import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useCallback, useEffect } from "react";
import { sql } from "~/db";
import { getCurrentUser } from "~/lib/auth";
import { checkTrial, type TrialStatus } from "~/lib/trial";
import { SPECIALTY_OPTIONS, daysUntilExpiry, type License } from "~/lib/healthcare";
import { CERTIFICATIONS, certificationDaysRemaining, certificationStatus } from "~/lib/certifications";

// ── Constants ─────────────────────────────────────────────────────────────────

const INDUSTRIES = [
  { value: "Construction", label: "Construction" },
  { value: "IT Services", label: "IT Services" },
  { value: "Landscaping", label: "Landscaping" },
  { value: "Janitorial", label: "Janitorial" },
  { value: "Security", label: "Security" },
  { value: "HVAC", label: "HVAC" },
  { value: "Plumbing & Electrical", label: "Plumbing & Electrical" },
  { value: "Marketing Agency", label: "Marketing Agency" },
  { value: "Manufacturing", label: "Manufacturing" },
  { value: "Other", label: "Other" },
] as const;

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

// CERTIFICATIONS is imported from ~/lib/certifications (shared with the
// dashboard status card and /tracking certifications tab).

const REVENUE_RANGES = [
  { value: "Under $500K", label: "Under $500K" },
  { value: "$500K–$1M", label: "$500K–$1M" },
  { value: "$1M–$5M", label: "$1M–$5M" },
  { value: "$5M–$10M", label: "$5M–$10M" },
  { value: "$10M–$50M", label: "$10M–$50M" },
  { value: "$50M+", label: "$50M+" },
] as const;

// ── Types ────────────────────────────────────────────────────────────────────

interface BusinessProfileFull {
  id: number;
  business_name: string;
  industry: string;
  locations: string[];
  service_categories: string[];
  naics_codes: string[];
  uei: string | null;
  cage_code: string | null;
  duns: string | null;
  sam_expiration: string | null;
  certifications: string[];
  certification_dates: Record<string, string>;
  years_in_business: number | null;
  employee_count: number | null;
  annual_revenue: string | null;
  past_performance_summary: string | null;
  capability_statement: string | null;
  specialties: string[];
  licenses: License[];
  typical_contract_value: string | null;
}

interface SettingsFormData {
  businessName: string;
  uei: string;
  cageCode: string;
  duns: string;
  samExpiration: string;
  certifications: string[];
  certificationDates: Record<string, string>;
  yearsInBusiness: string;
  employeeCount: string;
  annualRevenue: string;
  pastPerformance: string;
  capabilityStatement: string;
  industry: string;
  locations: string[];
  naicsCodes: string;
  specialties: string[];
  licenses: License[];
  typicalContractValue: string;
}

// ── Server Functions ─────────────────────────────────────────────────────────

const fetchProfile = createServerFn({ method: "GET" }).handler(async (): Promise<BusinessProfileFull | null> => {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");

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

  if (rows.length === 0) return null;

  const p = rows[0] as any;
  return {
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
    certification_dates: p.certification_dates && typeof p.certification_dates === "object" && !Array.isArray(p.certification_dates) ? p.certification_dates : {},
    years_in_business: p.years_in_business ?? null,
    employee_count: p.employee_count ?? null,
    annual_revenue: p.annual_revenue ?? null,
    past_performance_summary: p.past_performance_summary ?? null,
    capability_statement: p.capability_statement ?? null,
    specialties: Array.isArray(p.specialties) ? p.specialties : [],
    licenses: Array.isArray(p.licenses) ? p.licenses : [],
    typical_contract_value: p.typical_contract_value ?? null,
  };
});

const saveProfile = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (typeof data !== "object" || data === null) {
      throw new Error("Invalid request");
    }
    const d = data as SettingsFormData;
    if (!d.businessName || d.businessName.trim().length === 0) {
      throw new Error("Business name is required.");
    }
    return {
      businessName: d.businessName.trim(),
      uei: d.uei?.trim() || null,
      cageCode: d.cageCode?.trim() || null,
      duns: d.duns?.trim() || null,
      samExpiration: d.samExpiration?.trim() || null,
      certifications: d.certifications || [],
      certificationDates: d.certificationDates && typeof d.certificationDates === "object" ? Object.fromEntries(Object.entries(d.certificationDates).filter(([key, value]) => d.certifications.includes(key) && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value as string))) : {},
      yearsInBusiness: d.yearsInBusiness ? parseInt(d.yearsInBusiness, 10) || null : null,
      employeeCount: d.employeeCount ? parseInt(d.employeeCount, 10) || null : null,
      annualRevenue: d.annualRevenue?.trim() || null,
      pastPerformance: d.pastPerformance?.trim() || null,
      capabilityStatement: d.capabilityStatement?.trim() || null,
      industry: d.industry?.trim() || "",
      locations: d.locations || [],
      naicsCodes: d.naicsCodes?.trim() || null,
      specialties: Array.isArray(d.specialties) ? d.specialties.filter((s: string) => typeof s === "string" && s.trim().length > 0).map((s: string) => s.trim()) : [],
      licenses: Array.isArray(d.licenses) ? d.licenses.filter((l: License) => l && typeof l.type === "string" && l.type.trim().length > 0).map((l: License) => ({ type: l.type.trim(), state: (l.state || "").trim() || null, expires: (l.expires || "").trim() || null })) : [],
      typicalContractValue: d.typicalContractValue?.trim() || null,
    };
  })
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");

    // Lazy migration guards for the healthcare staffing columns.
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS specialties JSONB DEFAULT '[]'::jsonb`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS licenses JSONB DEFAULT '[]'::jsonb`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS typical_contract_value TEXT`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS certification_dates JSONB DEFAULT '{}'::jsonb`; } catch {}

    // Parse comma-separated NAICS codes into array
    const naicsArray = data.naicsCodes
      ? data.naicsCodes.split(",").map((c: string) => c.trim()).filter((c: string) => c.length > 0)
      : [];

    const existing = await sql()`
      SELECT id FROM business_profiles WHERE user_id = ${user.id}
    `;

    if (existing.length > 0) {
      await sql()`
        UPDATE business_profiles
        SET business_name = ${data.businessName},
            industry = ${data.industry},
            locations = ${JSON.stringify(data.locations)}::jsonb,
            naics_codes = ${JSON.stringify(naicsArray)}::jsonb,
            uei = ${data.uei},
            cage_code = ${data.cageCode},
            duns = ${data.duns},
            sam_expiration = ${data.samExpiration ? data.samExpiration : null}::date,
            certifications = ${JSON.stringify(data.certifications)}::jsonb,
            certification_dates = ${JSON.stringify(data.certificationDates)}::jsonb,
            years_in_business = ${data.yearsInBusiness},
            employee_count = ${data.employeeCount},
            annual_revenue = ${data.annualRevenue},
            past_performance_summary = ${data.pastPerformance},
            capability_statement = ${data.capabilityStatement},
            specialties = ${JSON.stringify(data.specialties)}::jsonb,
            licenses = ${JSON.stringify(data.licenses)}::jsonb,
            typical_contract_value = ${data.typicalContractValue},
            updated_at = NOW()
        WHERE user_id = ${user.id}
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
          ${user.id}, ${data.businessName}, ${data.industry},
          ${JSON.stringify(data.locations)}::jsonb, ${JSON.stringify(naicsArray)}::jsonb,
          ${data.uei}, ${data.cageCode}, ${data.duns},
          ${data.samExpiration ? data.samExpiration : null}::date,
          ${JSON.stringify(data.certifications)}::jsonb,
          ${JSON.stringify(data.certificationDates)}::jsonb,
          ${data.yearsInBusiness}, ${data.employeeCount}, ${data.annualRevenue},
          ${data.pastPerformance}, ${data.capabilityStatement},
          ${JSON.stringify(data.specialties)}::jsonb,
          ${JSON.stringify(data.licenses)}::jsonb,
          ${data.typicalContractValue}
        )
      `;
    }

    return { success: true };
  });

// ── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  loader: () => getCurrentUser(),
  component: SettingsPage,
});

// ── Toast ────────────────────────────────────────────────────────────────────

function SuccessToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed top-20 right-6 z-50 animate-slide-in rounded-lg bg-green-600 px-5 py-3 text-sm font-medium text-white shadow-lg">
      <span className="mr-2">✓</span>
      {message}
      <button onClick={onClose} className="ml-3 text-green-200 hover:text-white">&times;</button>
    </div>
  );
}

// ── Page Component ───────────────────────────────────────────────────────────

function SettingsPage() {
  const currentUser = Route.useLoaderData();
  const navigate = useNavigate();

  // Redirect if not logged in
  if (!currentUser) {
    navigate({ to: "/login" });
    return null;
  }

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [trial, setTrial] = useState<TrialStatus | null>(null);
  useEffect(() => { checkTrial().then(setTrial).catch(() => {}); }, []);

  const [form, setForm] = useState<SettingsFormData>({
    businessName: "",
    uei: "",
    cageCode: "",
    duns: "",
    samExpiration: "",
    certifications: [],
    certificationDates: {},
    yearsInBusiness: "",
    employeeCount: "",
    annualRevenue: "",
    pastPerformance: "",
    capabilityStatement: "",
    industry: "",
    locations: [],
    naicsCodes: "",
    specialties: [],
    licenses: [],
    typicalContractValue: "",
  });

  // Fetch profile on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const profile = await fetchProfile();
        if (!cancelled && profile) {
          setForm({
            businessName: profile.business_name,
            uei: profile.uei ?? "",
            cageCode: profile.cage_code ?? "",
            duns: profile.duns ?? "",
            samExpiration: profile.sam_expiration ?? "",
            certifications: profile.certifications,
            certificationDates: profile.certification_dates,
            yearsInBusiness: profile.years_in_business != null ? String(profile.years_in_business) : "",
            employeeCount: profile.employee_count != null ? String(profile.employee_count) : "",
            annualRevenue: profile.annual_revenue ?? "",
            pastPerformance: profile.past_performance_summary ?? "",
            capabilityStatement: profile.capability_statement ?? "",
            typicalContractValue: profile.typical_contract_value ?? "",
            industry: profile.industry,
            locations: profile.locations,
            naicsCodes: profile.naics_codes.join(", "),
            specialties: profile.specialties,
            licenses: Array.isArray(profile.licenses) ? profile.licenses : [],
          });
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const updateField = useCallback((field: keyof SettingsFormData, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const toggleCertification = useCallback((cert: string) => {
    setForm((prev) => ({
      ...prev,
      certifications: prev.certifications.includes(cert)
        ? prev.certifications.filter((c) => c !== cert)
        : [...prev.certifications, cert],
    }));
  }, []);

  const updateCertificationDate = useCallback((cert: string, date: string) => {
    setForm((prev) => ({
      ...prev,
      certificationDates: { ...prev.certificationDates, [cert]: date },
    }));
  }, []);

  const toggleLocation = useCallback((state: string) => {
    setForm((prev) => ({
      ...prev,
      locations: prev.locations.includes(state)
        ? prev.locations.filter((l) => l !== state)
        : [...prev.locations, state],
    }));
  }, []);

  const toggleSpecialty = useCallback((spec: string) => {
    setForm((prev) => ({
      ...prev,
      specialties: prev.specialties.includes(spec)
        ? prev.specialties.filter((s) => s !== spec)
        : [...prev.specialties, spec],
    }));
  }, []);

  const addCustomSpecialty = useCallback((value: string) => {
    const spec = value.trim();
    if (!spec) return;
    setForm((prev) =>
      prev.specialties.some((s) => s.toLowerCase() === spec.toLowerCase())
        ? prev
        : { ...prev, specialties: [...prev.specialties, spec] },
    );
  }, []);

  const updateLicense = useCallback((idx: number, patch: Partial<License>) => {
    setForm((prev) => ({
      ...prev,
      licenses: prev.licenses.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));
  }, []);

  const addLicense = useCallback(() => {
    setForm((prev) => ({ ...prev, licenses: [...prev.licenses, { type: "", state: "", expires: "" }] }));
  }, []);

  const removeLicense = useCallback((idx: number) => {
    setForm((prev) => ({ ...prev, licenses: prev.licenses.filter((_, i) => i !== idx) }));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      await saveProfile({ data: form });
      setToast("Settings saved successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-500">
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Loading settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Toast */}
      {toast && <SuccessToast message={toast} onClose={() => setToast("")} />}

      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <a href="/dashboard" className="inline-flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900">
              <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
            <span className="text-lg font-bold tracking-tight text-slate-900">Contrax</span>
          </a>
          <div>
            <span className="text-sm text-slate-500">{currentUser.email}</span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Business Settings</h1>
          <p className="mt-1 text-sm text-slate-500">
            Update your business profile to get better bid matches and stronger proposals.
          </p>
        </div>

        {/* Section: Plan & Trial */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 mb-1">Plan &amp; Trial</h2>
              <p className="text-sm text-slate-500">Your subscription status and 21-day free trial.</p>
            </div>
            <a href="/upgrade" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50">
              Manage plan
            </a>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current plan</p>
              <p className="mt-1 text-lg font-bold text-slate-900 capitalize">{trial?.planTier ?? "—"}</p>
              {trial?.active ? (
                <p className="mt-1 text-xs text-amber-700">Free trial — no card required</p>
              ) : trial && !trial.expired && trial.planTier ? (
                <p className="mt-1 text-xs text-green-700">Active subscription</p>
              ) : (
                <p className="mt-1 text-xs text-slate-400">No plan selected</p>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Trial status</p>
              {trial?.active ? (
                <p className="mt-1 text-lg font-bold text-slate-900">
                  {trial.daysLeft} day{trial.daysLeft === 1 ? "" : "s"} left
                </p>
              ) : trial?.expired ? (
                <p className="mt-1 text-lg font-bold text-red-600">Trial ended</p>
              ) : (
                <p className="mt-1 text-lg font-bold text-slate-900">{trial ? "Not in trial" : "…"}</p>
              )}
              {trial?.endsAt ? (
                <p className="mt-1 text-xs text-slate-500">
                  Ends {new Date(trial.endsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </p>
              ) : trial && !trial.expired && trial.planTier ? (
                <p className="mt-1 text-xs text-green-700">Paid plan — no trial</p>
              ) : null}
            </div>
          </div>
          {trial?.active && (
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
              <span>Your 21-day free trial is almost over — keep bid matching, AI scoring, and proposal drafting after it ends.</span>
              <a href="/upgrade" className="shrink-0 font-semibold text-blue-700 underline hover:text-blue-800">Upgrade now →</a>
            </div>
          )}
          {trial?.expired && (
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
              <span>Your trial has ended — subscribe to regain access to your workspace and bid matches.</span>
              <a href="/upgrade" className="shrink-0 font-semibold text-red-800 underline hover:text-red-900">View plans →</a>
            </div>
          )}
        </section>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Error */}
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Section: Company Identity */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Company Identity</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="businessName" className="block text-sm font-medium text-slate-700">
                  Business Name
                </label>
                <input
                  id="businessName"
                  type="text"
                  value={form.businessName}
                  onChange={(e) => updateField("businessName", e.target.value)}
                  required
                  className="mt-1.5 block w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="e.g., Acme Contracting LLC"
                />
              </div>
              <div>
                <label htmlFor="uei" className="block text-sm font-medium text-slate-700">
                  UEI
                </label>
                <input
                  id="uei"
                  type="text"
                  value={form.uei}
                  onChange={(e) => updateField("uei", e.target.value)}
                  className="mt-1.5 block w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-mono"
                  placeholder="e.g., XXXX123456789"
                />
              </div>
              <div>
                <label htmlFor="cageCode" className="block text-sm font-medium text-slate-700">
                  CAGE Code
                </label>
                <input
                  id="cageCode"
                  type="text"
                  value={form.cageCode}
                  onChange={(e) => updateField("cageCode", e.target.value)}
                  className="mt-1.5 block w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-mono"
                  placeholder="e.g., 1ABCD"
                />
              </div>
              <div>
                <label htmlFor="duns" className="block text-sm font-medium text-slate-700">
                  DUNS
                </label>
                <input
                  id="duns"
                  type="text"
                  value={form.duns}
                  onChange={(e) => updateField("duns", e.target.value)}
                  className="mt-1.5 block w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-mono"
                  placeholder="e.g., 123456789"
                />
              </div>
            </div>
          </section>

          {/* Section: SAM Registration */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">SAM Registration</h2>
            <div className="max-w-xs">
              <label htmlFor="samExpiration" className="block text-sm font-medium text-slate-700">
                SAM Expiration Date
              </label>
              <input
                id="samExpiration"
                type="date"
                value={form.samExpiration}
                onChange={(e) => updateField("samExpiration", e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </section>

          {/* Section: Certifications */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Certifications</h2>
            <p className="text-sm text-slate-500 mb-4">Track certification expiration dates so you never miss a renewal deadline. Dates are optional.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {CERTIFICATIONS.map((cert) => {
                const checked = form.certifications.includes(cert.value);
                const date = form.certificationDates[cert.value] || "";
                const certDays = certificationDaysRemaining(date);
                const certSt = certificationStatus(certDays);
                const status = certSt.kind === "missing" ? null : certSt.label;
                return (
                  <div key={cert.value} className={`rounded-lg border p-3 transition-all ${checked ? "border-blue-500 bg-blue-50 shadow-sm" : "border-slate-200 bg-white"}`}>
                    <button type="button" onClick={() => toggleCertification(cert.value)} className={`flex w-full items-center gap-3 text-left text-sm ${checked ? "text-blue-700" : "text-slate-700"}`}>
                      <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${checked ? "border-blue-500 bg-blue-500" : "border-slate-300"}`}>
                        {checked && <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                      </div>
                      <span className="font-medium">{cert.label}</span>
                      {status && <span className={`ml-auto inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${certSt.badge}`}>{certSt.kind === "active" ? "🟢" : certSt.kind === "expired" ? "🔴" : "🟡"} {status}</span>}
                    </button>
                    {checked && <div className="mt-3 border-t border-blue-100 pt-2">
                      <label htmlFor={`cert-expiry-${cert.value}`} className="block text-xs font-medium text-slate-600">Expiration date <span className="font-normal text-slate-400">(optional)</span></label>
                      <input id={`cert-expiry-${cert.value}`} type="date" value={date} onChange={(e) => updateCertificationDate(cert.value, e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                      {certSt.kind !== "missing" && (
                        <p className={`mt-1 text-[11px] font-medium ${certSt.text}`}>
                          {certSt.kind === "expired"
                            ? `Expired ${Math.abs(certDays)} day${Math.abs(certDays) !== 1 ? "s" : ""} ago`
                            : certDays === 0
                              ? "Expires today"
                              : `${certDays} day${certDays !== 1 ? "s" : ""} remaining`}
                        </p>
                      )}
                    </div>}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Section: Staffing Specialties */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Staffing Specialties</h2>
            <p className="text-sm text-slate-500 mb-4">
              Select the healthcare roles your agency staffs. Contrax uses these to prioritize matching bids and to score role fit in win probability.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {SPECIALTY_OPTIONS.map((spec) => {
                const checked = form.specialties.includes(spec);
                return (
                  <button
                    key={spec}
                    type="button"
                    onClick={() => toggleSpecialty(spec)}
                    className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-all ${
                      checked
                        ? "border-teal-500 bg-teal-50 text-teal-700 shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                        checked ? "border-teal-500 bg-teal-500" : "border-slate-300"
                      }`}
                    >
                      {checked && (
                        <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    {spec}
                  </button>
                );
              })}
            </div>
            {/* Custom specialty tag input */}
            <div className="mt-4 flex gap-2">
              <input
                id="customSpecialty"
                type="text"
                placeholder="Add a custom role (e.g., School Nurse, Telehealth RN)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomSpecialty((e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).value = "";
                  }
                }}
                onBlur={(e) => {
                  if (e.target.value.trim()) {
                    addCustomSpecialty(e.target.value);
                    e.target.value = "";
                  }
                }}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              />
              <button
                type="button"
                onClick={() => {
                  const input = document.getElementById("customSpecialty") as HTMLInputElement | null;
                  if (input && input.value.trim()) {
                    addCustomSpecialty(input.value);
                    input.value = "";
                  }
                }}
                className="rounded-lg bg-teal-600 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-700 transition-colors"
              >
                Add
              </button>
            </div>
            {form.specialties.filter((s) => !SPECIALTY_OPTIONS.includes(s)).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {form.specialties.filter((s) => !SPECIALTY_OPTIONS.includes(s)).map((s) => (
                  <span key={s} className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700">
                    {s}
                    <button type="button" onClick={() => toggleSpecialty(s)} className="text-teal-400 hover:text-teal-600">&times;</button>
                  </span>
                ))}
              </div>
            )}
            <p className="mt-2 text-sm text-slate-500">
              {form.specialties.length} role{form.specialties.length !== 1 ? "s" : ""} selected
            </p>
          </section>

          {/* Section: Licenses & Credentials */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-semibold text-slate-900">Licenses &amp; Credentials</h2>
              <button
                type="button"
                onClick={addLicense}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                Add License
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              Track licenses, certifications, and clearances your staff hold. The compliance checker cross-references these against RFP requirements.
            </p>
            {form.licenses.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-400">
                No licenses added yet. Click &ldquo;Add License&rdquo; to track RN licenses, ACLS, BLS, clearances, and more.
              </div>
            ) : (
              <div className="space-y-3">
                {form.licenses.map((lic, idx) => {
                  const days = daysUntilExpiry(lic.expires);
                  const expired = days !== null && days < 0;
                  const expiringSoon = days !== null && !expired && days <= 90;
                  return (
                    <div key={idx} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                      <input
                        type="text"
                        value={lic.type}
                        onChange={(e) => updateLicense(idx, { type: e.target.value })}
                        placeholder="e.g., RN License, ACLS, BLS"
                        className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                      <select
                        value={lic.state || ""}
                        onChange={(e) => updateLicense(idx, { state: e.target.value })}
                        className="w-full sm:w-40 rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none bg-white"
                      >
                        <option value="">State (optional)</option>
                        {US_STATES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={lic.expires || ""}
                        onChange={(e) => updateLicense(idx, { expires: e.target.value })}
                        className="w-full sm:w-44 rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                      <div className="flex items-center gap-2 shrink-0">
                        {expired ? (
                          <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">● Expired</span>
                        ) : expiringSoon ? (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">● {days === 0 ? "Expires today" : `${days}d left`}</span>
                        ) : lic.expires ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-1 text-xs font-bold text-green-700">✓ Valid</span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => removeLicense(idx)}
                          className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                          aria-label="Remove license"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Section: Company Size */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Company Size</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="yearsInBusiness" className="block text-sm font-medium text-slate-700">
                  Years in Business
                </label>
                <input
                  id="yearsInBusiness"
                  type="number"
                  min="0"
                  value={form.yearsInBusiness}
                  onChange={(e) => updateField("yearsInBusiness", e.target.value)}
                  className="mt-1.5 block w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="e.g., 5"
                />
              </div>
              <div>
                <label htmlFor="employeeCount" className="block text-sm font-medium text-slate-700">
                  Employee Count
                </label>
                <input
                  id="employeeCount"
                  type="number"
                  min="0"
                  value={form.employeeCount}
                  onChange={(e) => updateField("employeeCount", e.target.value)}
                  className="mt-1.5 block w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="e.g., 25"
                />
              </div>
              <div>
                <label htmlFor="annualRevenue" className="block text-sm font-medium text-slate-700">
                  Annual Revenue Range
                </label>
                <select
                  id="annualRevenue"
                  value={form.annualRevenue}
                  onChange={(e) => updateField("annualRevenue", e.target.value)}
                  className="mt-1.5 block w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none bg-white"
                >
                  <option value="">Select range...</option>
                  {REVENUE_RANGES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Typical Contract Value */}
            <div>
              <label htmlFor="typicalContractValue" className="block text-sm font-medium text-slate-700">
                Typical Contract Value
              </label>
              <p className="mt-1 text-xs text-slate-400">
                The range of contract sizes you usually pursue (e.g., "$50K–$250K" or "Under $500K").
              </p>
              <select
                id="typicalContractValue"
                value={form.typicalContractValue}
                onChange={(e) => updateField("typicalContractValue", e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none bg-white"
              >
                <option value="">Select range...</option>
                <option value="Under $50K">Under $50K</option>
                <option value="$50K–$250K">$50K–$250K</option>
                <option value="$250K–$1M">$250K–$1M</option>
                <option value="$1M–$5M">$1M–$5M</option>
                <option value="$5M+">$5M+</option>
              </select>
              <input
                type="text"
                placeholder="Or enter a custom range..."
                value={form.typicalContractValue}
                onChange={(e) => updateField("typicalContractValue", e.target.value)}
                className="mt-2 block w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </section>

          {/* Section: Past Performance */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Past Performance</h2>
            <div>
              <label htmlFor="pastPerformance" className="block text-sm font-medium text-slate-700">
                Key Contract Wins
              </label>
              <p className="mt-1 text-xs text-slate-400">
                Describe up to 3 of your most relevant past government contracts or projects.
              </p>
              <textarea
                id="pastPerformance"
                value={form.pastPerformance}
                onChange={(e) => updateField("pastPerformance", e.target.value)}
                maxLength={2000}
                rows={5}
                className="mt-2 block w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-y"
                placeholder="e.g., $2.4M DoD construction project — completed on time and under budget. Managed a 40-person crew..."
              />
              <p className="mt-1 text-xs text-right text-slate-400">
                {form.pastPerformance.length}/2000
              </p>
            </div>
          </section>

          {/* Section: Capability Statement */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Capability Statement</h2>
            <div>
              <label htmlFor="capabilityStatement" className="block text-sm font-medium text-slate-700">
                Capability Narrative
              </label>
              <p className="mt-1 text-xs text-slate-400">
                A concise narrative describing your company&rsquo;s core capabilities, differentiators, and qualifications for government work.
              </p>
              <textarea
                id="capabilityStatement"
                value={form.capabilityStatement}
                onChange={(e) => updateField("capabilityStatement", e.target.value)}
                rows={5}
                className="mt-2 block w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-y"
                placeholder="e.g., Established in 2010, we are a veteran-owned small business specializing in facility construction and maintenance. Our team holds certifications in..."
              />
            </div>
          </section>

          {/* Section: Industry & Location */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Industry & Location</h2>

            {/* Industry */}
            <div className="mb-6">
              <label htmlFor="industry" className="block text-sm font-medium text-slate-700">
                Industry
              </label>
              <select
                id="industry"
                value={form.industry}
                onChange={(e) => updateField("industry", e.target.value)}
                className="mt-1.5 block w-full max-w-sm rounded-lg border border-slate-300 px-4 py-3 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none bg-white"
              >
                <option value="">Select your industry...</option>
                {INDUSTRIES.map((ind) => (
                  <option key={ind.value} value={ind.value}>{ind.label}</option>
                ))}
              </select>
            </div>

            {/* Locations */}
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">Operating Locations</p>
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
                {US_STATES.map((state) => {
                  const checked = form.locations.includes(state);
                  return (
                    <button
                      key={state}
                      type="button"
                      onClick={() => toggleLocation(state)}
                      className={`rounded-lg border px-3 py-2.5 text-xs font-semibold transition-all ${
                        checked
                          ? "border-blue-500 bg-blue-50 text-blue-700 shadow-sm"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {state}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-sm text-slate-500">
                {form.locations.length} state{form.locations.length !== 1 ? "s" : ""} selected
              </p>
            </div>
          </section>

          {/* Section: NAICS Codes */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">NAICS Codes</h2>
            <div>
              <label htmlFor="naicsCodes" className="block text-sm font-medium text-slate-700">
                NAICS Codes
              </label>
              <p className="mt-1 text-xs text-slate-400">
                Comma-separated list of your NAICS codes (e.g., 236220, 238160, 541512)
              </p>
              <input
                id="naicsCodes"
                type="text"
                value={form.naicsCodes}
                onChange={(e) => updateField("naicsCodes", e.target.value)}
                className="mt-2 block w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-mono"
                placeholder="e.g., 236220, 238160, 541512"
              />
            </div>
          </section>

          {/* Save Button */}
          <div className="flex justify-end pt-4">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-slate-900 px-8 py-3.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98]"
            >
              {saving ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving...
                </span>
              ) : (
                "Save Changes"
              )}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
