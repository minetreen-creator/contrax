/**
 * CompanyProfile — read-only summary card showing how Contrax's AI understands
 * a business. This is NOT an editor (that lives at /settings). It renders the
 * business profile the way the AI sees it, collapsed by default so it doesn't
 * clutter the bid feed, and expands to the full summary on demand.
 *
 * Also exports the shared `BusinessProfile` type used across the app and by
 * `src/lib/profile-context.ts`.
 */

import { useState } from "react";
import type { License } from "~/lib/healthcare";
import { normalizeCert } from "~/lib/profile-context";

// ── Shared type ───────────────────────────────────────────────────────────────

/** Full business profile shape as persisted in `business_profiles`. */
export interface BusinessProfile {
  id: number;
  business_name: string;
  industry: string;
  locations: string[];
  service_categories: string[];
  naics_codes: string[];
  logo_url: string | null;
  is_agency: boolean;
  uei: string | null;
  cage_code: string | null;
  sam_expiration: string | null;
  duns: string | null;
  certifications: string[];
  /** Expiration dates keyed by certification value (e.g. { "8a": "2031-06-30" }). */
  certification_dates?: Record<string, string>;
  years_in_business: number | null;
  employee_count: number | null;
  annual_revenue: string | null;
  past_performance_summary: string | null;
  capability_statement: string | null;
  specialties: string[];
  licenses: License[];
  typical_contract_value: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Section({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Placeholder({ children }: { children?: React.ReactNode }) {
  return (
    <span className="text-sm italic text-slate-400">
      {children ?? "Not set"}
    </span>
  );
}

function Tag({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600 ${
        mono ? "font-mono" : ""
      }`}
    >
      {children}
    </span>
  );
}

function CertBadge({ cert }: { cert: string }) {
  const label = normalizeCert(cert);
  return (
    <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
      {label}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CompanyProfile({ profile }: { profile: BusinessProfile }) {
  const [expanded, setExpanded] = useState(false);

  const certifications = Array.isArray(profile.certifications) ? profile.certifications : [];
  const naics = Array.isArray(profile.naics_codes) ? profile.naics_codes : [];
  const locations = Array.isArray(profile.locations) ? profile.locations : [];
  const services = Array.isArray(profile.service_categories) ? profile.service_categories : [];
  const specialties = Array.isArray(profile.specialties) ? profile.specialties : [];

  const teamBits: string[] = [];
  if (profile.employee_count != null && profile.employee_count > 0)
    teamBits.push(`${profile.employee_count} employees`);
  if (profile.years_in_business != null && profile.years_in_business > 0)
    teamBits.push(`${profile.years_in_business} years in business`);

  const ids: string[] = [];
  if (profile.uei) ids.push(`UEI ${profile.uei}`);
  if (profile.cage_code) ids.push(`CAGE ${profile.cage_code}`);
  if (profile.duns) ids.push(`DUNS ${profile.duns}`);
  if (profile.sam_expiration) ids.push(`SAM expires ${String(profile.sam_expiration).slice(0, 10)}`);

  return (
    <section
      className="mb-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      aria-label="Company profile summary"
    >
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50/70"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 shadow-sm">
            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-900">How Contrax understands your business</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Every AI analysis — win probability, proposals, pricing — starts from this profile.
            </p>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          <a
            href="/settings"
            onClick={(e) => e.stopPropagation()}
            className="hidden rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 sm:inline-flex"
          >
            Edit in Settings
          </a>
          <svg
            className={`h-5 w-5 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {/* Expanded summary */}
      {expanded && (
        <div className="border-t border-slate-100 px-5 py-5">
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            <Section label="Industry">
              {profile.industry ? (
                <span className="inline-flex items-center rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
                  {profile.industry}
                </span>
              ) : (
                <Placeholder />
              )}
            </Section>

            <Section label="Typical contract value">
              {profile.typical_contract_value ? (
                <span className="inline-flex items-center rounded-lg bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  {profile.typical_contract_value}
                </span>
              ) : (
                <Placeholder>e.g. $50K–$250K — set in Settings</Placeholder>
              )}
            </Section>

            <Section label="NAICS codes">
              {naics.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {naics.map((code) => (
                    <Tag key={code} mono>{code}</Tag>
                  ))}
                </div>
              ) : (
                <Placeholder />
              )}
            </Section>

            <Section label="Certifications">
              {certifications.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {certifications.map((cert) => (
                    <CertBadge key={cert} cert={cert} />
                  ))}
                </div>
              ) : (
                <Placeholder />
              )}
            </Section>

            <Section label="Geographic preferences">
              {locations.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {locations.map((loc) => (
                    <Tag key={loc}>{loc}</Tag>
                  ))}
                </div>
              ) : (
                <Placeholder />
              )}
            </Section>

            <Section label="Team">
              {teamBits.length > 0 ? (
                <p className="text-sm font-medium text-slate-700">{teamBits.join(" · ")}</p>
              ) : (
                <Placeholder />
              )}
              {profile.annual_revenue && (
                <p className="mt-1 text-xs text-slate-500">Revenue: {profile.annual_revenue}</p>
              )}
            </Section>

            <Section label="Past performance" className="sm:col-span-2">
              {profile.past_performance_summary ? (
                <p className="line-clamp-3 max-w-3xl text-sm leading-relaxed text-slate-600">
                  {profile.past_performance_summary}
                </p>
              ) : (
                <Placeholder>No past performance recorded yet.</Placeholder>
              )}
            </Section>

            {specialties.length > 0 && (
              <Section label="Specialties" className="sm:col-span-2">
                <div className="flex flex-wrap gap-1.5">
                  {specialties.map((s) => (
                    <Tag key={s}>{s}</Tag>
                  ))}
                </div>
              </Section>
            )}

            {services.length > 0 && (
              <Section label="Services" className="sm:col-span-2">
                <div className="flex flex-wrap gap-1.5">
                  {services.map((svc) => (
                    <Tag key={svc}>{svc}</Tag>
                  ))}
                </div>
              </Section>
            )}

            {ids.length > 0 && (
              <Section label="Registration & SAM" className="sm:col-span-2">
                <div className="flex flex-wrap gap-1.5">
                  {ids.map((id) => (
                    <Tag key={id} mono>{id}</Tag>
                  ))}
                </div>
              </Section>
            )}
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-400">
              {profile.business_name ? (
                <>
                  <span className="font-semibold text-slate-500">{profile.business_name}</span>
                  {profile.is_agency ? " · Government agency entity" : " · Small business entity"}
                </>
              ) : (
                "No business name set."
              )}
            </p>
            <a href="/settings" className="text-xs font-semibold text-blue-600 hover:text-blue-700">
              Edit in Settings →
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
