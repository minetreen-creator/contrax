/**
 * Prime contractor finder (owner 2026-11-09, "now build the prime contractor finder"): most small
 * businesses chase contracts directly, but large primes already hold the work and many are
 * required to give part of it to small businesses (an SBA or GSA subcontracting plan). For one
 * trade and state this lists the companies holding active federal contracts there, the ones with
 * a subcontracting plan first, with what they hold, for which agencies and when their next
 * contract ends (the time to ask to join their team for the rebid). PURE.
 *
 * Sources (public data, already synced): recompete_contracts (USAspending.gov, active contracts
 * ending in the next 18 months) and subcontract_primes (SBA FY24 and GSA directories of primes
 * with subcontracting plans).
 */

export interface PrimeRow {
  uei: string;
  name: string;
  parent: string | null;
  contracts: number;
  value: number;
  agencies: string[];
  nextEnd: string | null;
  hasPlan: boolean;
  planType: string | null;
}

/** Plan holders first (they must subcontract), then the biggest holders of work. */
export function sortPrimes(rows: PrimeRow[]): PrimeRow[] {
  return [...rows].sort((a, b) => Number(b.hasPlan) - Number(a.hasPlan) || b.value - a.value || a.name.localeCompare(b.name));
}

/** Whole months from `now` until a date (0 when it is this month or past). */
export function monthsUntil(date: string | null, now: Date = new Date()): number | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, (d.getUTCFullYear() - now.getUTCFullYear()) * 12 + (d.getUTCMonth() - now.getUTCMonth()));
}

/**
 * When to reach out. Primes line up teammates for a rebid well before the contract ends, so
 * 3 to 12 months out is the window; inside 3 months the team is usually set.
 */
export function approachTiming(nextEnd: string | null, now: Date = new Date()): { label: string; tone: "now" | "soon" | "later" | "late" } {
  const m = monthsUntil(nextEnd, now);
  if (m === null) return { label: "No end date listed", tone: "later" };
  if (m < 3) return { label: "Contract ends within 3 months: the rebid team is likely set; ask about the next one", tone: "late" };
  if (m <= 12) return { label: `Contract ends in about ${m} months: a good time to ask about joining the rebid team`, tone: "now" };
  return { label: `Contract ends in about ${m} months: introduce yourself now, follow up in a few months`, tone: "soon" };
}

export interface IntroProfile {
  businessName?: string | null;
  services?: string[];
  locations?: string[];
  certifications?: string[];
  yearsInBusiness?: number | null;
  pastPerformance?: string | null;
}

const CERT_LABELS: Record<string, string> = {
  "8a": "SBA 8(a)",
  sdvosb: "Service-Disabled Veteran-Owned Small Business (SDVOSB)",
  vosb: "Veteran-Owned Small Business",
  wosb: "Women-Owned Small Business (WOSB)",
  hubzone: "HUBZone",
  minority_owned: "minority-owned",
  disadvantaged: "Small Disadvantaged Business",
};

/**
 * A short introduction email the member sends themselves (Contrax never emails primes). Uses only
 * what the member put in their profile; blanks are left for them to fill. PURE.
 */
export function introEmail(prime: Pick<PrimeRow, "name" | "agencies">, tradeLabel: string, stateName: string, p: IntroProfile): { subject: string; body: string } {
  const biz = p.businessName?.trim() || "[your business name]";
  const certs = (p.certifications ?? []).map((c) => CERT_LABELS[c.toLowerCase()] ?? c).filter(Boolean);
  const services = (p.services ?? []).filter(Boolean).slice(0, 4);
  const agency = prime.agencies[0];
  const lines = [
    `Hello ${prime.name} small business team,`,
    "",
    `${biz} is a ${certs.length ? `${certs.join(", ")} ` : "small "}business providing ${services.length ? services.join(", ") : tradeLabel.toLowerCase()} services in ${stateName}.`,
    `We see your team performs ${tradeLabel.toLowerCase()} work in ${stateName}${agency ? ` for the ${agency}` : ""}, and we would like to support you as a subcontractor on current and upcoming work, including any rebids.`,
    "",
    p.yearsInBusiness ? `We have been in business ${p.yearsInBusiness} years.` : "[One line on your years in business and team size.]",
    p.pastPerformance?.trim() ? `Recent work: ${p.pastPerformance.trim().slice(0, 300)}` : "[One or two recent jobs similar to this work.]",
    "",
    "Our capability statement is attached. Could you point us to your supplier registration and the right person to talk with about teaming?",
    "",
    "Thank you,",
    "[Your name, title, phone]",
    biz,
  ];
  return { subject: `${biz}: ${certs[0] ? `${certs[0].split(" (")[0]} ` : ""}subcontractor for ${tradeLabel.toLowerCase()} in ${stateName}`, body: lines.join("\n") };
}
