import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useCallback } from "react";
import { sql } from "~/db";
import { getCurrentUser } from "~/lib/auth";

// ── Constants ─────────────────────────────────────────────────────────────────

const INDUSTRIES = [
  { value: "Construction", label: "Construction", examples: "general contracting, electrical, roofing, concrete" },
  { value: "IT Services", label: "IT Services", examples: "software development, cybersecurity, cloud, help desk" },
  { value: "Landscaping", label: "Landscaping", examples: "lawn care, tree service, snow removal, grounds maintenance" },
  { value: "Janitorial", label: "Janitorial", examples: "office cleaning, floor care, disinfection, waste management" },
  { value: "Security", label: "Security", examples: "physical security, surveillance, patrol, alarm monitoring" },
  { value: "HVAC", label: "HVAC", examples: "installation, repair, duct cleaning, refrigeration" },
  { value: "Plumbing & Electrical", label: "Plumbing & Electrical", examples: "pipe fitting, wiring, inspections, repairs" },
  { value: "Marketing Agency", label: "Marketing Agency", examples: "digital ads, branding, web design, PR" },
  { value: "Manufacturing", label: "Manufacturing", examples: "fabrication, assembly, machining, production" },
  { value: "Other", label: "Other", examples: "describe your business in your own words" },
] as const;

const SERVICES_BY_INDUSTRY: Record<string, string[]> = {
  Construction: ["General Contracting", "Electrical", "Plumbing", "Roofing", "Concrete", "Painting", "Demolition", "Site Preparation"],
  Landscaping: ["Lawn Maintenance", "Tree Service", "Snow Removal", "Grounds Maintenance", "Irrigation", "Hardscaping", "Pest Control"],
  "IT Services": ["Software Development", "Network Infrastructure", "Cybersecurity", "Cloud Services", "Help Desk", "Data Analytics"],
  HVAC: ["Installation", "Repair & Maintenance", "Duct Cleaning", "Refrigeration", "Energy Audits"],
  Security: ["Physical Security", "Surveillance Systems", "Access Control", "Patrol Services", "Alarm Monitoring"],
  Janitorial: ["Office Cleaning", "Floor Care", "Window Cleaning", "Waste Management", "Disinfection", "Pressure Washing"],
};

export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

export const CERTIFICATIONS = [
  { value: "8a", label: "8(a) Business Development" },
  { value: "hubzone", label: "HUBZone" },
  { value: "wosb", label: "WOSB/EDWOSB" },
  { value: "sdvosb", label: "SDVOSB" },
  { value: "vosb", label: "VOSB" },
  { value: "minority_owned", label: "Minority-Owned" },
  { value: "disadvantaged", label: "Disadvantaged" },
] as const;

// ── Server Function ───────────────────────────────────────────────────────────

const saveProfile = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (typeof data !== "object" || data === null) {
      throw new Error("Invalid request");
    }
    const d = data as {
      businessName: string;
      industry: string;
      locations: string[];
      services: string[];
      naicsCodes: string[];
      certifications: string[];
    };
    if (!d.businessName || d.businessName.trim().length === 0) {
      throw new Error("Business name is required.");
    }
    if (!d.industry) {
      throw new Error("Please select an industry.");
    }
    if (!d.locations || d.locations.length === 0) {
      throw new Error("Please select at least one location.");
    }
    if (!d.services || d.services.length === 0) {
      throw new Error("Please select at least one service.");
    }
    return {
      businessName: d.businessName.trim(),
      industry: d.industry,
      locations: d.locations,
      services: d.services,
      naicsCodes: d.naicsCodes || [],
      certifications: d.certifications || [],
    };
  })
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("Not authenticated");
    }

    // Ensure new profile columns exist (backward compat)
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS naics_codes JSONB DEFAULT '[]'::jsonb`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS certifications JSONB DEFAULT '[]'::jsonb`; } catch {}

    // Upsert business profile
    const existing = await sql()`
      SELECT id FROM business_profiles WHERE user_id = ${user.id}
    `;

    if (existing.length > 0) {
      await sql()`
        UPDATE business_profiles
        SET business_name = ${data.businessName},
            industry = ${data.industry},
            locations = ${JSON.stringify(data.locations)}::jsonb,
            service_categories = ${JSON.stringify(data.services)}::jsonb,
            naics_codes = ${JSON.stringify(data.naicsCodes)}::jsonb,
            certifications = ${JSON.stringify(data.certifications)}::jsonb,
            updated_at = NOW()
        WHERE user_id = ${user.id}
      `;
    } else {
      await sql()`
        INSERT INTO business_profiles (user_id, business_name, industry, locations, service_categories, naics_codes, certifications)
        VALUES (${user.id}, ${data.businessName}, ${data.industry}, ${JSON.stringify(data.locations)}::jsonb, ${JSON.stringify(data.services)}::jsonb, ${JSON.stringify(data.naicsCodes)}::jsonb, ${JSON.stringify(data.certifications)}::jsonb)
      `;
    }

    return { success: true };
  });

// ── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/onboarding")({
  loader: () => getCurrentUser(),
  component: OnboardingPage,
});

// ── Types ────────────────────────────────────────────────────────────────────

interface WizardState {
  step: number;
  businessName: string;
  industry: string;
  locations: string[];
  services: string[];
  customServiceInput: string;
  naicsCodes: string[];
  certifications: string[];
}

// ── Step Indicator ───────────────────────────────────────────────────────────

function StepIndicator({ currentStep }: { currentStep: number }) {
  const steps = [
    { num: 1, label: "Industry" },
    { num: 2, label: "Locations" },
    { num: 3, label: "Services" },
    { num: 4, label: "NAICS" },
    { num: 5, label: "Certifications" },
    { num: 6, label: "Confirm" },
  ];

  return (
    <div className="flex items-center justify-center gap-0 mb-10">
      {steps.map((s, i) => (
        <div key={s.num} className="flex items-center">
          {/* Step circle */}
          <div className="flex flex-col items-center">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition-all ${
                s.num < currentStep
                  ? "bg-blue-600 text-white"
                  : s.num === currentStep
                    ? "bg-blue-600 text-white ring-4 ring-blue-200"
                    : "bg-slate-200 text-slate-500"
              }`}
            >
              {s.num < currentStep ? (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                s.num
              )}
            </div>
            <span className={`mt-2 text-xs font-medium ${s.num <= currentStep ? "text-slate-700" : "text-slate-400"}`}>
              {s.label}
            </span>
          </div>
          {/* Connector line */}
          {i < steps.length - 1 && (
            <div className={`mx-2 h-0.5 w-10 sm:w-16 mt-[-1.25rem] ${s.num < currentStep ? "bg-blue-600" : "bg-slate-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Step 1: Industry ─────────────────────────────────────────────────────────

function StepIndustry({
  businessName,
  industry,
  onChangeBusinessName,
  onSelectIndustry,
  onNext,
}: {
  businessName: string;
  industry: string;
  onChangeBusinessName: (v: string) => void;
  onSelectIndustry: (v: string) => void;
  onNext: () => void;
}) {
  const selected = INDUSTRIES.find((i) => i.value === industry);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">What&rsquo;s your business?</h2>
        <p className="mt-1 text-sm text-slate-500">Tell us about your company so we can find the right contracts.</p>
      </div>

      {/* Business Name */}
      <div>
        <label htmlFor="bizName" className="block text-sm font-medium text-slate-700">
          Business name
        </label>
        <input
          id="bizName"
          type="text"
          value={businessName}
          onChange={(e) => onChangeBusinessName(e.target.value)}
          placeholder="e.g., Acme Contracting LLC"
          className="mt-1.5 block w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </div>

      {/* Industry Selector */}
      <div>
        <label htmlFor="industry" className="block text-sm font-medium text-slate-700">
          Industry
        </label>
        <select
          id="industry"
          value={industry}
          onChange={(e) => onSelectIndustry(e.target.value)}
          className="mt-1.5 block w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none bg-white"
        >
          <option value="" disabled>
            Select your industry...
          </option>
          {INDUSTRIES.map((ind) => (
            <option key={ind.value} value={ind.value}>
              {ind.label}
            </option>
          ))}
        </select>
        {selected && (
          <p className="mt-2 text-sm text-slate-500">
            <span className="font-medium text-slate-600">{selected.label}</span> &mdash; {selected.examples}
          </p>
        )}
      </div>

      {/* Next Button */}
      <div className="flex justify-end pt-4">
        <button
          onClick={onNext}
          disabled={!businessName.trim() || !industry}
          className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Locations ────────────────────────────────────────────────────────

function StepLocations({
  locations,
  onToggle,
  onBack,
  onNext,
}: {
  locations: string[];
  onToggle: (state: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const toggleAll = () => {
    if (locations.length === US_STATES.length) {
      // Deselect all
      US_STATES.forEach((s) => {
        if (locations.includes(s)) onToggle(s);
      });
    } else {
      // Select all
      US_STATES.forEach((s) => {
        if (!locations.includes(s)) onToggle(s);
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Where do you work?</h2>
        <p className="mt-1 text-sm text-slate-500">Select the states where your business operates.</p>
      </div>

      {/* Select All */}
      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={locations.length === US_STATES.length}
          onChange={toggleAll}
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="text-sm font-medium text-slate-700">
          {locations.length === US_STATES.length ? "Deselect all" : "Select all states"}
        </span>
      </label>

      {/* State Grid */}
      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
        {US_STATES.map((state) => {
          const checked = locations.includes(state);
          return (
            <button
              key={state}
              type="button"
              onClick={() => onToggle(state)}
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

      {/* Selected count */}
      <p className="text-sm text-slate-500">
        {locations.length} state{locations.length !== 1 ? "s" : ""} selected
      </p>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <button
          onClick={onBack}
          className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 active:scale-[0.98]"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={locations.length === 0}
          className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Services ─────────────────────────────────────────────────────────

function StepServices({
  industry,
  services,
  customServiceInput,
  onToggleService,
  onAddCustom,
  onCustomInputChange,
  onBack,
  onNext,
}: {
  industry: string;
  services: string[];
  customServiceInput: string;
  onToggleService: (svc: string) => void;
  onAddCustom: () => void;
  onCustomInputChange: (v: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const presetServices = SERVICES_BY_INDUSTRY[industry] || [];

  const handleAddCustom = () => {
    onAddCustom();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddCustom();
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">What services do you provide?</h2>
        <p className="mt-1 text-sm text-slate-500">
          Select the services your business offers. These help us match you with the right bids.
        </p>
      </div>

      {/* Preset services */}
      {presetServices.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-600">Common services for {industry}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {presetServices.map((svc) => {
              const checked = services.includes(svc);
              return (
                <button
                  key={svc}
                  type="button"
                  onClick={() => onToggleService(svc)}
                  className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-all ${
                    checked
                      ? "border-blue-500 bg-blue-50 text-blue-700 shadow-sm"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                      checked ? "border-blue-500 bg-blue-500" : "border-slate-300"
                    }`}
                  >
                    {checked && (
                      <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  {svc}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          Add your services below — there are no presets for this industry.
        </div>
      )}

      {/* Custom service input */}
      <div className="border-t border-slate-200 pt-4">
        <p className="text-sm font-medium text-slate-600 mb-2">Add custom services</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={customServiceInput}
            onChange={(e) => onCustomInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g., Specialty waterproofing..."
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <button
            type="button"
            onClick={handleAddCustom}
            disabled={!customServiceInput.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
          >
            Add
          </button>
        </div>
      </div>

      {/* Current selected services summary */}
      {services.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {services.map((svc) => (
            <span
              key={svc}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
            >
              {svc}
              <button
                type="button"
                onClick={() => onToggleService(svc)}
                className="ml-0.5 text-slate-400 hover:text-slate-600"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <button
          onClick={onBack}
          className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 active:scale-[0.98]"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={services.length === 0}
          className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ── Step 4: NAICS Codes ──────────────────────────────────────────────────────

function StepNAICS({
  naicsCodes,
  naicsInput,
  onNaicsInputChange,
  onAddNaicsCode,
  onRemoveNaicsCode,
  onBack,
  onNext,
}: {
  naicsCodes: string[];
  naicsInput: string;
  onNaicsInputChange: (v: string) => void;
  onAddNaicsCode: () => void;
  onRemoveNaicsCode: (code: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onAddNaicsCode();
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">What are your NAICS codes?</h2>
        <p className="mt-1 text-sm text-slate-500">
          NAICS codes classify your business for government contracting. Enter your primary NAICS codes (e.g. 236220, 238160).
        </p>
      </div>

      {/* Input */}
      <div className="border-t border-slate-200 pt-4">
        <p className="text-sm font-medium text-slate-600 mb-2">Add NAICS codes</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={naicsInput}
            onChange={(e) => onNaicsInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. 236220"
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-mono"
          />
          <button
            type="button"
            onClick={onAddNaicsCode}
            disabled={!naicsInput.trim() || !/^\d{6}$/.test(naicsInput.trim())}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
          >
            Add
          </button>
        </div>
        <p className="mt-1.5 text-xs text-slate-400">Enter a 6-digit NAICS code and press Add or Enter.</p>
      </div>

      {/* Current NAICS codes */}
      {naicsCodes.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {naicsCodes.map((code) => (
            <span
              key={code}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-xs font-mono font-medium text-blue-700"
            >
              {code}
              <button
                type="button"
                onClick={() => onRemoveNaicsCode(code)}
                className="ml-0.5 text-blue-400 hover:text-blue-600"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
          <p className="text-sm text-slate-500">No NAICS codes added yet. You can skip this step if you&rsquo;re not sure.</p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <button
          onClick={onBack}
          className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 active:scale-[0.98]"
        >
          Back
        </button>
        <button
          onClick={onNext}
          className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md active:scale-[0.98]"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ── Step 5: Certifications ───────────────────────────────────────────────────

function StepCertifications({ certifications, onToggle, onBack, onNext }: {
  certifications: string[];
  onToggle: (certification: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Which certifications do you hold?</h2>
        <p className="mt-1 text-sm text-slate-500">Select your business certifications so we can prioritize contracts you qualify for.</p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {CERTIFICATIONS.map((cert) => {
          const checked = certifications.includes(cert.value);
          return (
            <button key={cert.value} type="button" onClick={() => onToggle(cert.value)}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-all ${checked ? "border-blue-500 bg-blue-50 text-blue-700 shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"}`}>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${checked ? "border-blue-500 bg-blue-500" : "border-slate-300"}`}>
                {checked && <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
              </span>
              {cert.label}
            </button>
          );
        })}
      </div>
      <p className="text-sm text-slate-500">{certifications.length} certification{certifications.length !== 1 ? "s" : ""} selected</p>
      <div className="flex justify-between pt-4">
        <button onClick={onBack} className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 active:scale-[0.98]">Back</button>
        <button onClick={onNext} className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md active:scale-[0.98]">Continue</button>
      </div>
    </div>
  );
}

// ── Step 6: Review ───────────────────────────────────────────────────────────

function StepReview({
  businessName,
  industry,
  locations,
  services,
  naicsCodes,
  certifications,
  saving,
  onBack,
  onFinish,
}: {
  businessName: string;
  industry: string;
  locations: string[];
  services: string[];
  naicsCodes: string[];
  certifications: string[];
  saving: boolean;
  onBack: () => void;
  onFinish: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Review your profile</h2>
        <p className="mt-1 text-sm text-slate-500">Confirm your details before we start finding bids for you.</p>
      </div>

      {/* Summary card */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 space-y-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Business Name</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{businessName}</p>
        </div>

        <div className="border-t border-slate-200 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Industry</p>
          <span className="mt-1 inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700">
            {industry}
          </span>
        </div>

        <div className="border-t border-slate-200 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Locations</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {locations.map((loc) => (
              <span key={loc} className="rounded-md bg-white border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
                {loc}
              </span>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-200 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Services</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {services.map((svc) => (
              <span key={svc} className="rounded-md bg-white border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
                {svc}
              </span>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-200 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">NAICS Codes</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {naicsCodes.length > 0 ? naicsCodes.map((code) => (
              <span key={code} className="rounded-md bg-white border border-slate-200 px-2 py-0.5 text-xs font-mono font-semibold text-slate-700">
                {code}
              </span>
            )) : (
              <span className="text-sm text-slate-400">None provided</span>
            )}
          </div>
        </div>

        <div className="border-t border-slate-200 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Certifications</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {certifications.length > 0 ? certifications.map((value) => (
              <span key={value} className="rounded-md bg-white border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
                {CERTIFICATIONS.find((cert) => cert.value === value)?.label || value}
              </span>
            )) : <span className="text-sm text-slate-400">None provided</span>}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <button
          onClick={onBack}
          disabled={saving}
          className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-40 active:scale-[0.98]"
        >
          Back
        </button>
        <button
          onClick={onFinish}
          disabled={saving}
          className="rounded-xl bg-amber-500 px-8 py-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-amber-600 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98]"
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
            "Finish Setup"
          )}
        </button>
      </div>
    </div>
  );
}

// ── Main Page Component ──────────────────────────────────────────────────────

function OnboardingPage() {
  const currentUser = Route.useLoaderData();
  const navigate = useNavigate();

  // Redirect if not logged in
  if (!currentUser) {
    navigate({ to: "/login" });
    return null;
  }

  const [state, setState] = useState<WizardState>({
    step: 1,
    businessName: "",
    industry: "",
    locations: [],
    services: [],
    customServiceInput: "",
    naicsCodes: [],
    certifications: [],
  });

  const [naicsInput, setNaicsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = useCallback((patch: Partial<WizardState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleSelectIndustry = (industry: string) => {
    // When industry changes, reset services to empty (different presets)
    setState((prev) => ({ ...prev, industry, services: [], customServiceInput: "" }));
  };

  const handleToggleLocation = (loc: string) => {
    setState((prev) => ({
      ...prev,
      locations: prev.locations.includes(loc)
        ? prev.locations.filter((l) => l !== loc)
        : [...prev.locations, loc],
    }));
  };

  const handleToggleService = (svc: string) => {
    setState((prev) => ({
      ...prev,
      services: prev.services.includes(svc)
        ? prev.services.filter((s) => s !== svc)
        : [...prev.services, svc],
    }));
  };

  const handleAddCustomService = () => {
    const svc = state.customServiceInput.trim();
    if (!svc) return;
    if (state.services.includes(svc)) {
      setState((prev) => ({ ...prev, customServiceInput: "" }));
      return;
    }
    setState((prev) => ({
      ...prev,
      services: [...prev.services, svc],
      customServiceInput: "",
    }));
  };

  const handleToggleCertification = (certification: string) => {
    setState((prev) => ({ ...prev, certifications: prev.certifications.includes(certification)
      ? prev.certifications.filter((c) => c !== certification)
      : [...prev.certifications, certification] }));
  };

  const handleAddNaicsCode = () => {
    const code = naicsInput.trim();
    if (!code || !/^\d{6}$/.test(code)) return;
    if (state.naicsCodes.includes(code)) {
      setNaicsInput("");
      return;
    }
    setState((prev) => ({
      ...prev,
      naicsCodes: [...prev.naicsCodes, code],
    }));
    setNaicsInput("");
  };

  const handleRemoveNaicsCode = (code: string) => {
    setState((prev) => ({
      ...prev,
      naicsCodes: prev.naicsCodes.filter((c) => c !== code),
    }));
  };

  const handleFinish = async () => {
    setError("");
    setSaving(true);
    try {
      await saveProfile({
        data: {
          businessName: state.businessName,
          industry: state.industry,
          locations: state.locations,
          services: state.services,
          naicsCodes: state.naicsCodes,
          certifications: state.certifications,
        },
      });
      navigate({ to: "/dashboard" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile. Please try again.");
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-2xl px-4 py-4 flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900">
              <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
            <span className="text-lg font-bold tracking-tight text-slate-900">Contrax</span>
          </a>
          <span className="text-sm text-slate-500">{currentUser.email}</span>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-2xl px-4 py-10">
        {/* Step indicator */}
        <StepIndicator currentStep={state.step} />

        {/* Content card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          {/* Error */}
          {error && (
            <div className="mb-6 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {state.step === 1 && (
            <StepIndustry
              businessName={state.businessName}
              industry={state.industry}
              onChangeBusinessName={(v) => update({ businessName: v })}
              onSelectIndustry={handleSelectIndustry}
              onNext={() => {
                if (!state.businessName.trim() || !state.industry) return;
                setState((prev) => ({ ...prev, step: 2 }));
              }}
            />
          )}

          {state.step === 2 && (
            <StepLocations
              locations={state.locations}
              onToggle={handleToggleLocation}
              onBack={() => setState((prev) => ({ ...prev, step: 1 }))}
              onNext={() => {
                if (state.locations.length === 0) return;
                setState((prev) => ({ ...prev, step: 3 }));
              }}
            />
          )}

          {state.step === 3 && (
            <StepServices
              industry={state.industry}
              services={state.services}
              customServiceInput={state.customServiceInput}
              onToggleService={handleToggleService}
              onAddCustom={handleAddCustomService}
              onCustomInputChange={(v) => update({ customServiceInput: v })}
              onBack={() => setState((prev) => ({ ...prev, step: 2 }))}
              onNext={() => {
                if (state.services.length === 0) return;
                setState((prev) => ({ ...prev, step: 4 }));
              }}
            />
          )}

          {state.step === 4 && (
            <StepNAICS
              naicsCodes={state.naicsCodes}
              naicsInput={naicsInput}
              onNaicsInputChange={setNaicsInput}
              onAddNaicsCode={handleAddNaicsCode}
              onRemoveNaicsCode={handleRemoveNaicsCode}
              onBack={() => setState((prev) => ({ ...prev, step: 3 }))}
              onNext={() => {
                setState((prev) => ({ ...prev, step: 5 }));
              }}
            />
          )}

          {state.step === 5 && (
            <StepCertifications
              certifications={state.certifications}
              onToggle={handleToggleCertification}
              onBack={() => setState((prev) => ({ ...prev, step: 4 }))}
              onNext={() => setState((prev) => ({ ...prev, step: 6 }))}
            />
          )}

          {state.step === 6 && (
            <StepReview
              businessName={state.businessName}
              industry={state.industry}
              locations={state.locations}
              services={state.services}
              naicsCodes={state.naicsCodes}
              certifications={state.certifications}
              saving={saving}
              onBack={() => setState((prev) => ({ ...prev, step: 5 }))}
              onFinish={handleFinish}
            />
          )}
        </div>
      </main>
    </div>
  );
}
