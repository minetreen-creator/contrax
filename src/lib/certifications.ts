// ── Certification metadata + deadline helpers ────────────────────────────────
// Shared by the dashboard status card, /tracking certifications tab, and
// /settings. Keeps the set-aside cert list (8(a), SDVOSB, WOSB/EDWOSB,
// HUBZone, plus VOSB / minority / disadvantaged) in one place.
export interface CertificationMeta {
  value: string;
  label: string;
  shortLabel: string;
  /** Renewal cadence shown in the UI so users know when to expect renewal. */
  cadence: string;
}

export const CERTIFICATIONS: CertificationMeta[] = [
  {
    value: "8a",
    label: "8(a) Business Development",
    shortLabel: "8(a)",
    cadence: "9-year program · annual reviews · 4-year developmental stage",
  },
  {
    value: "sdvosb",
    label: "SDVOSB",
    shortLabel: "SDVOSB",
    cadence: "3-year CVE recertification",
  },
  {
    value: "wosb",
    label: "WOSB/EDWOSB",
    shortLabel: "WOSB",
    cadence: "Annual certification",
  },
  {
    value: "hubzone",
    label: "HUBZone",
    shortLabel: "HUBZone",
    cadence: "Annual recertification",
  },
  {
    value: "vosb",
    label: "VOSB",
    shortLabel: "VOSB",
    cadence: "3-year recertification",
  },
  {
    value: "minority_owned",
    label: "Minority-Owned",
    shortLabel: "Minority-Owned",
    cadence: "Varies by certifying body",
  },
  {
    value: "disadvantaged",
    label: "Disadvantaged",
    shortLabel: "Disadvantaged",
    cadence: "Varies by program",
  },
];

export function certLabel(value: string): string {
  return CERTIFICATIONS.find((c) => c.value === value)?.label ?? value;
}

export function certMeta(value: string): CertificationMeta | undefined {
  return CERTIFICATIONS.find((c) => c.value === value);
}

/**
 * Whole days between today (midnight) and the expiration date.
 * Returns Infinity when no date is set.
 */
export function certificationDaysRemaining(dateStr: string | null | undefined): number {
  if (!dateStr) return Infinity;
  const end = new Date(`${dateStr}T00:00:00`).getTime();
  if (Number.isNaN(end)) return Infinity;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Math.ceil((end - start.getTime()) / 86400000);
}

export type CertificationStatusKind = "active" | "expiring" | "expired" | "missing";

export interface CertificationStatus {
  kind: CertificationStatusKind;
  label: string;
  /** Badge pill classes (bg + text). */
  badge: string;
  /** Text color for the "X days remaining" line. */
  text: string;
}

/**
 * Color-coded status per product spec:
 *   green >90 days · amber 31–90 · red ≤30 days · slate when expired/missing.
 */
export function certificationStatus(days: number): CertificationStatus {
  if (!Number.isFinite(days)) {
    return { kind: "missing", label: "No date set", badge: "bg-slate-100 text-slate-600", text: "text-slate-500" };
  }
  if (days < 0) {
    return { kind: "expired", label: "Expired", badge: "bg-red-100 text-red-700", text: "text-red-600" };
  }
  if (days <= 30) {
    return { kind: "expiring", label: "Expiring Soon", badge: "bg-red-100 text-red-700", text: "text-red-600" };
  }
  if (days <= 90) {
    return { kind: "expiring", label: "Expiring Soon", badge: "bg-amber-100 text-amber-700", text: "text-amber-600" };
  }
  return { kind: "active", label: "Active", badge: "bg-green-100 text-green-700", text: "text-green-600" };
}

export function fmtCertDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
