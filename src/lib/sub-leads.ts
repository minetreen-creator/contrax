/**
 * Homepage "Subcontracting leads" (owner 2026-10-30: "for the subs, can we
 * make a list on the homepage?"). Companies that just won a federal service
 * contract outside their home state, the same awards the prime outreach uses
 * (award_leads, USAspending). A local contractor in that state can offer to
 * do the work. PURE and client-safe.
 */
import { PRIME_TRADES } from "~/lib/outreach";

export interface SubLead {
  recipient: string;
  recipientCity: string | null;
  recipientState: string;
  workState: string;
  amount: number;
  agency: string | null;
  naics: string;
  awardedOn: string;
}

/** Trade word for a NAICS code ("janitorial"). */
export function subLeadTrade(naics: string): string {
  return PRIME_TRADES[naics]?.label ?? "service";
}

const KEEP_UPPER = new Set(["LLC", "LLP", "LP", "INC", "JV", "USA", "US", "II", "III", "IV", "PC", "DBA", "HVAC"]);

/** "EXCELSIOR DEFENSE, INC" → "Excelsior Defense, INC"; mixed-case names are left alone. PURE. */
export function companyDisplayName(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (n !== n.toUpperCase()) return n;
  return n
    .split(" ")
    .map((w) =>
      // Each part of a hyphenated name on its own ("CBG-PEGASUS" → "CBG-Pegasus").
      w
        .split("-")
        .map((part) => {
          const core = part.replace(/[^A-Z0-9&]/g, "");
          if (KEEP_UPPER.has(core) || (core.length <= 3 && !/[AEIOU]/.test(core))) return part;
          return part.charAt(0) + part.slice(1).toLowerCase();
        })
        .join("-"),
    )
    .join(" ");
}

/** "$2.9M", "$353K". PURE. */
export function shortAmount(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  return `$${Math.round(n / 1e3)}K`;
}

/** The visitor's state first (newest first within it), then everyone else. PURE. */
export function orderForState(leads: SubLead[], state: string | null | undefined): SubLead[] {
  if (!state) return leads;
  const mine = leads.filter((l) => l.workState === state);
  return [...mine, ...leads.filter((l) => l.workState !== state)];
}
