/**
 * Healthcare staffing helpers shared by the dashboard, settings, and compliance
 * pages. Pure data + pure functions — safe to import from client and server code.
 */

// NAICS codes that indicate healthcare / medical services.
export const HEALTHCARE_NAICS = [
  "561320", // Temporary Help Services (incl. healthcare staffing)
  "621111", // Offices of Physicians (except Mental Health)
  "621112", // Offices of Physicians, Mental Health
  "621210", // Offices of Dentists
  "621330", // Offices of Mental Health Practitioners
  "621340", // Offices of Physical, Occupational, Speech Therapists
  "621391", // Offices of Podiatrists
  "621399", // Offices of All Other Miscellaneous Health Practitioners
  "621410", // Family Planning Centers
  "621420", // Outpatient Mental Health / Substance Abuse Centers
  "621491", // HMO Medical Centers
  "621493", // Freestanding Ambulatory Surgical Centers
  "621498", // All Other Outpatient Care Centers
  "621511", // Medical Laboratories
  "621512", // Diagnostic Imaging Centers
  "621610", // Home Health Care Services
  "621910", // Ambulance Services
  "621991", // Blood and Organ Banks
  "621999", // All Other Miscellaneous Ambulatory Health Care Services
  "622110", // General Medical and Surgical Hospitals
  "622210", // Psychiatric and Substance Abuse Hospitals
  "622310", // Specialty (except Psychiatric) Hospitals
  "623110", // Nursing Care Facilities (Skilled Nursing Facilities)
  "623210", // Residential Intellectual and Developmental Disability Facilities
  "623220", // Residential Mental Health and Substance Abuse Facilities
  "623311", // Continuing Care Retirement Communities
  "623312", // Assisted Living Facilities
  "623990", // Other Residential Care Facilities
  "624120", // Services for the Elderly and Persons with Disabilities
  "624190", // Other Individual and Family Services
  "624230", // Emergency and Other Relief Services
];

// Keywords that strongly suggest a healthcare staffing opportunity.
export const HEALTHCARE_KEYWORDS = [
  "nursing", "nurse", "registered nurse", "nurse practitioner", "rn staffing",
  "lpn", "cna", "physician", "locum", "medical", "healthcare", "health care",
  "health services", "hospital", "clinic", "correctional health", "physical therap",
  "occupational therap", "speech therap", "respiratory therap", "pharmac",
  "psychiatric", "behavioral health", "dental", "radiology", "imaging",
  "laboratory", "phlebotom", "surgical", "anesthesi", "emergency medical",
  "paramedic", "emt", "vaccination", "immuniz", "telehealth", "home health",
  "home care", "assisted living", "skilled nursing", "nurse practitioner",
  "physician assistant", "medical assistant", "hospice", "urgent care",
  "patient", "medical services", "midwife", "military treatment",
];

// Selectable staffing roles shown on the /settings page.
export const SPECIALTY_OPTIONS = [
  "RN",
  "LPN",
  "LVN",
  "CNA",
  "Nurse Practitioner",
  "Physician Assistant",
  "Physician",
  "Locum Tenens",
  "Medical Assistant",
  "Physical Therapist",
  "Occupational Therapist",
  "Speech Therapist",
  "Respiratory Therapist",
  "CRNA",
  "Pharmacist",
  "Dentist",
  "Psychiatrist",
  "Behavioral Health Specialist",
  "Radiology Tech",
  "Lab Tech",
  "Paramedic",
  "EMT",
  "Phlebotomist",
  "Surgical Tech",
  "Midwife",
];

// Aliases so short role codes match the way solicitations phrase them.
const SPECIALTY_ALIASES: Record<string, string[]> = {
  "RN": ["rn", "registered nurse", "registered nurses", "staff nurse"],
  "LPN": ["lpn", "licensed practical nurse", "licensed practical nurses"],
  "LVN": ["lvn", "licensed vocational nurse", "licensed vocational nurses"],
  "CNA": ["cna", "certified nursing assistant", "certified nurse aide", "nursing assistant"],
  "Physician": ["physician", "doctor", "md ", "physicians"],
  "Nurse Practitioner": ["nurse practitioner", "np ", "advanced practice nurse", "advanced practice registered nurse"],
  "Physician Assistant": ["physician assistant", "pa ", "physician's assistant"],
  "Locum Tenens": ["locum", "locum tenens"],
  "Physical Therapist": ["physical therapist", "physical therapy", "pt "],
  "Paramedic": ["paramedic", "paramedics"],
};

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when a bid looks like a healthcare opportunity — either its category /
 * title / description mention healthcare keywords, or its NAICS codes overlap
 * the healthcare list.
 */
export function isHealthcareBid(
  bid: { title?: string; description?: string; category?: string },
  naicsCodes?: string[] | null,
): boolean {
  const naics = naicsCodes || [];
  if (naics.some((c) => HEALTHCARE_NAICS.includes(String(c).trim()))) return true;
  const text = `${bid.title || ""} ${bid.description || ""} ${bid.category || ""}`.toLowerCase();
  return HEALTHCARE_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * Count how many of the user's staffing specialties appear in a bid's
 * title / description / category. Used to show the "N role matches" badge and
 * to prioritize role-matching bids in the feed.
 */
export function countRoleMatches(
  bid: { title?: string; description?: string; category?: string },
  specialties: string[],
): number {
  const specs = Array.isArray(specialties) ? specialties : [];
  if (specs.length === 0) return 0;
  const text = `${bid.title || ""} ${bid.description || ""} ${bid.category || ""}`.toLowerCase();
  let count = 0;
  for (const spec of specs) {
    const label = String(spec || "").trim().toLowerCase();
    if (!label) continue;
    const needles = [label, ...(SPECIALTY_ALIASES[label] || [])];
    const hit = needles.some((needle) => {
      const core = needle.replace(/\s+$/, ""); // "np " → "np" for word-boundary matching
      if (core.length <= 3) {
        // Short codes (rn, np, pa, pt) must be standalone words to avoid
        // matching "corner", "turning", etc. Optional trailing "s" covers
        // plurals like "RNs", "LPNs", "CNAs".
        return new RegExp(`\\b${escapeRegex(core)}s?\\b`).test(text);
      }
      return text.includes(needle);
    });
    if (hit) count++;
  }
  return count;
}

// ── License & credential helpers ─────────────────────────────────────────────

export interface License {
  type: string;
  state?: string;
  expires?: string;
}

/**
 * Common credentials / licenses that healthcare solicitations require. Each
 * entry maps a canonical label to the phrases RFPs typically use.
 */
export const CREDENTIAL_PATTERNS: { label: string; patterns: string[] }[] = [
  { label: "ACLS", patterns: ["acls", "advanced cardiac life support"] },
  { label: "BLS", patterns: ["bls", "basic life support"] },
  { label: "PALS", patterns: ["pals", "pediatric advanced life support"] },
  { label: "NRP", patterns: ["nrp", "neonatal resuscitation"] },
  { label: "TNCC", patterns: ["tncc", "trauma nursing core course"] },
  { label: "CCRN", patterns: ["ccrn"] },
  { label: "CEN", patterns: ["cen ", "certified emergency nurse"] },
  { label: "RN License", patterns: ["rn license", "registered nurse license", "active rn", "licensed rn"] },
  { label: "LPN License", patterns: ["lpn license", "licensed practical nurse"] },
  { label: "CNA Certification", patterns: ["cna", "certified nursing assistant", "certified nurse aide"] },
  { label: "CPR Certification", patterns: ["cpr"] },
  { label: "DEA Registration", patterns: ["dea registration", "dea license", "dea number"] },
  { label: "Compact License", patterns: ["compact license", "compact state", "multi-state license", "nurse licensure compact"] },
  { label: "Fingerprint Clearance", patterns: ["fingerprint", "criminal background clearance"] },
  { label: "Background Check", patterns: ["background check", "background investigation"] },
  { label: "Drug Screening", patterns: ["drug screen", "drug test", "drug testing"] },
  { label: "Physical Exam", patterns: ["physical exam", "pre-employment physical", "fitness for duty"] },
  { label: "Tuberculosis Test", patterns: ["tb test", "tuberculosis test", "tb screening"] },
  { label: "Immunization Record", patterns: ["immunization", "vaccination record", "vaccination"] },
  { label: "Credentialing", patterns: ["credentialing", "privileging", "clinical privileges"] },
  { label: "Basic Life Support Certification", patterns: ["basic life support"] },
  { label: "Advanced Practice License", patterns: ["advanced practice", "apr n", "advanced practice registered nurse"] },
];

/** Which of the known credentials appear in the solicitation text. */
export function detectCredentialRequirements(rfpText: string): string[] {
  const text = (rfpText || "").toLowerCase();
  const found: string[] = [];
  for (const cred of CREDENTIAL_PATTERNS) {
    const hit = cred.patterns.some((p) => {
      const needle = p.trim().toLowerCase();
      if (!needle) return false;
      if (needle.endsWith(" ")) return text.includes(needle); // trailing space = word-ish
      if (needle.length <= 4) return new RegExp(`\\b${escapeRegex(needle)}\\b`).test(text);
      return text.includes(needle);
    });
    if (hit) found.push(cred.label);
  }
  return found;
}

/** Normalized comparison so "RN License" in profile matches "RN License" requirement. */
export function licenseMatches(license: License, requirementLabel: string): boolean {
  const lt = String(license?.type || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const ll = requirementLabel.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!lt || !ll) return false;
  if (lt === ll) return true;
  if (ll.length >= 4 && (lt.includes(ll) || ll.includes(lt))) return true;
  // "ACLS" ↔ "ACLS Certification" / "ACLS cert"
  const llCore = ll.replace(/certification|cert|license|licensure/g, "").trim();
  const ltCore = lt.replace(/certification|cert|license|licensure/g, "").trim();
  if (llCore && llCore === ltCore) return true;
  return false;
}

/** Days until expiry (negative = expired). Null when no expiry is set. */
export function daysUntilExpiry(expires?: string): number | null {
  if (!expires) return null;
  const d = new Date(String(expires).slice(0, 10));
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}
