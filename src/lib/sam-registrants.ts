/**
 * SAM.gov registered small businesses for Sub Finder (owner 2026-11-09, growth item 5; SAM API key
 * added the same day). Source: the PUBLIC monthly entity extract (api.sam.gov data-services, public
 * sensitivity), parsed with the official Public V2 layout (1-based columns below).
 *
 * Terms (sam.gov/about/terms-of-use, read 2026-11-09):
 *  - public data from the public API/extract may be shown;
 *  - Dun & Bradstreet data has limits, so records whose source is D&B, or whose name/address are
 *    flagged D&B Open Data, are left out entirely;
 *  - a business that chose "no public display" (NPDY) is left out.
 * Contrax never contacts these businesses (owner rule: no cold outreach). Primes see them on Sub
 * Finder and reach out themselves; counts appear on the search pages. PURE.
 */
import { FEDERAL_TRADE_NAICS } from "~/lib/federal-trade-data";

export interface SamRegistrant {
  uei: string;
  name: string;
  city: string;
  state: string;
  zip: string;
  url: string | null;
  trades: string[];
  certs: string[];
  naics: string[];
  expires: string | null;
}

/** NAICS prefixes per Sub Finder trade. Construction takes all of 236/237/238; cybersecurity is left out (same codes as IT). */
export const SAM_TRADE_NAICS: Record<string, string[]> = Object.fromEntries(
  Object.entries(FEDERAL_TRADE_NAICS)
    .filter(([slug]) => slug !== "cybersecurity")
    .map(([slug, codes]) => [slug, slug === "construction" ? ["236", "237", "238"] : [...codes]]),
);

/** SAM business type codes (BUS TYPE STRING / SBA BUSINESS TYPES STRING) → Sub Finder certification values. */
const BUS_CERTS: [string, string][] = [
  ["QF", "sdvosb"],
  ["QF", "vosb"],
  ["A5", "vosb"],
  ["8W", "wosb"],
  ["8E", "wosb"],
  ["23", "minority_owned"],
  ["27", "disadvantaged"],
];
const SBA_CERTS: [string, string][] = [
  ["A6", "8a"],
  ["JT", "8a"],
  ["XX", "hubzone"],
];

/** "www.acme.com" → "https://www.acme.com"; anything that isn't a plain web address → null. PURE. */
export function cleanUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v || /\s/.test(v)) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return /\.[a-z]{2,}$/i.test(u.hostname) ? u.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

/** "ACME BUILDERS LLC" → "Acme Builders LLC" (keeps LLC, INC and short acronyms). PURE. */
export function niceName(raw: string): string {
  const keep = /^(LLC|LLP|LP|PC|PLLC|USA|US|II|III|IV|JV|HVAC|DBA|[A-Z]{1,3}&[A-Z]{1,3}|[A-Z]\.?)$/;
  const fixed: Record<string, string> = { INC: "Inc", CORP: "Corp", CO: "Co", LTD: "Ltd" };
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => {
      const bare = w.replace(/[.,]/g, "");
      if (fixed[bare]) return w.replace(bare, fixed[bare]);
      return keep.test(bare) ? w : w.charAt(0) + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * One line of the public extract → a registrant, or null when it is left out (inactive, not for
 * contracts, outside the US, no public display, D&B-sourced, or not small in any Sub Finder trade). PURE.
 */
export function parseSamLine(line: string): SamRegistrant | null {
  const p = line.split("|");
  if (p.length < 122) return null;
  const g = (i: number) => (p[i - 1] ?? "").trim();
  if (g(6) !== "A") return null; // active records only
  if (g(7) !== "Z2") return null; // registered for all awards (contracts), not grants only
  if (g(22) !== "USA") return null;
  if (g(119).toUpperCase() === "NPDY") return null; // the business chose no public display
  if (/D&B/i.test(g(122)) || g(24).toUpperCase() === "Y") return null; // D&B data: left out (terms)
  const naicsEntries = g(35).split("~").filter(Boolean);
  const smallNaics = naicsEntries.filter((x) => /^\d{6}[YE]/.test(x)).map((x) => x.slice(0, 6));
  const trades = Object.entries(SAM_TRADE_NAICS)
    .filter(([, prefixes]) => smallNaics.some((n) => prefixes.some((pre) => n.startsWith(pre))))
    .map(([slug]) => slug);
  if (!trades.length) return null;
  const bus = new Set(g(32).split("~").filter(Boolean));
  const sba = new Set(g(118).split("~").filter(Boolean).map((x) => x.slice(0, 2)));
  const certs = [...new Set([...BUS_CERTS.filter(([c]) => bus.has(c)), ...SBA_CERTS.filter(([c]) => sba.has(c))].map(([, v]) => v))];
  const exp = g(9);
  return {
    uei: g(1),
    name: niceName(g(13) || g(12)),
    city: niceName(g(18)),
    state: g(19),
    zip: g(20).slice(0, 5),
    url: cleanUrl(g(27)),
    trades,
    certs,
    naics: smallNaics.slice(0, 20),
    expires: /^\d{8}$/.test(exp) ? `${exp.slice(0, 4)}-${exp.slice(4, 6)}-${exp.slice(6, 8)}` : null,
  };
}

export const SAM_SOURCE_NOTE = "From SAM.gov public registration data. Business types are as each business reported them in SAM.gov; 8(a) and HUBZone are SBA certifications.";

/**
 * Whether a signed-in member's email domain matches the business website on its SAM.gov
 * registration ("bob@acmemech.com" and "https://www.acmemech.com"). Free mail never matches. PURE.
 */
export function emailMatchesSite(email: string, url: string | null): boolean {
  if (!url) return false;
  const domain = email.split("@")[1]?.toLowerCase().trim() ?? "";
  if (!domain || /^(gmail|yahoo|hotmail|outlook|aol|icloud|live|msn|me|comcast|att|verizon|protonmail|proton)\./.test(domain)) return false;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`);
}

/** Merge two lists without duplicates, keeping order. PURE. */
export const mergeList = (a: unknown, b: string[]): string[] => [...new Set([...(Array.isArray(a) ? a.map(String) : []), ...b])];
