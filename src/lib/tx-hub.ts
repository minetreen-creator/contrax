/**
 * Texas HUB-certified firms for Sub Finder (owner 2026-11-10, "3": state certification directories).
 * Source: the Texas Comptroller's public downloads (comptroller.texas.gov/purchasing/downloads/,
 * refreshed nightly; robots.txt allows /auto-data/): web_name.csv (active CMBL and HUB vendors) and
 * vnr_clas.csv (their NIGP class codes). Only active HUBs (status "A") are kept.
 *
 * Privacy (decided 2026-11-10): the Texas vendor ID can be built from a tax ID or Social Security
 * number, so it is never stored; rows are keyed by a one-way hash of it. Phone numbers, emails and
 * contact names are not stored either (nor the file's SDV flag, which reads "Y" on every HUB row, so it
 * says nothing about veteran ownership); the page links to the official HUB directory for contact.
 * Contrax contacts no one. Virginia's directory sits behind reCAPTCHA (left alone, per the bot rule)
 * and Florida's FDOT directory did not answer (2026-11-10). PURE.
 */
import { createHash } from "node:crypto";

export { TX_HUB_DIRECTORY_URL, TX_HUB_NOTE } from "~/lib/tx-hub-public";

export interface TxHubFirm {
  key: string;
  name: string;
  city: string;
  county: string;
  description: string;
  trades: string[];
  expires: string | null;
}

/** One-way key for a vendor ID (never stored or shown). PURE. */
export const hubKey = (vid: string) => `txhub-${createHash("sha256").update(`contrax-txhub:${vid.trim()}`).digest("hex").slice(0, 24)}`;

/** NIGP classes that are construction work (909 building, 912 general, 913 heavy, 914 trade). */
const CONSTRUCTION_CLASSES = new Set(["909", "912", "913", "914"]);
const LANDSCAPING_CLASSES = new Set(["988"]);

/** Trade words in a firm's own business description (the same trades Sub Finder uses). */
const TRADE_WORDS: [string, RegExp][] = [
  ["construction", /construct|contractor|remodel|roofing|\broof|concrete|paving|demolition|carpent|drywall|framing|masonry|excavat|renovat/i],
  ["hvac", /hvac|air condition|heating|mechanical|plumb|refriger/i],
  ["electrical", /electric/i],
  ["janitorial", /janitor|custodial|cleaning/i],
  ["landscaping", /landscap|lawn|mowing|tree (?:service|trimming|removal)|irrigation/i],
  ["security-guard", /security guard|security officer|security service|patrol/i],
  ["trucking", /trucking|hauling|freight|dump truck/i],
  ["waste-hauling", /waste|trash|refuse|recycl/i],
  ["it-services", /software|\bit services|information technology|computer|network/i],
  ["cybersecurity", /cyber/i],
];

/** Trades for a firm from its NIGP classes and its own description. PURE. */
export function hubTrades(description: string, classes: readonly string[]): string[] {
  const out = new Set<string>();
  for (const c of classes) {
    if (CONSTRUCTION_CLASSES.has(c)) out.add("construction");
    if (LANDSCAPING_CLASSES.has(c)) out.add("landscaping");
  }
  for (const [t, re] of TRADE_WORDS) if (re.test(description)) out.add(t);
  return [...out];
}

/** "ACME BUILDERS LLC" → "Acme Builders LLC". PURE. */
export function hubName(raw: string): string {
  const keep = /^(LLC|LLP|LP|PC|PLLC|USA|II|III|IV|JV|HVAC|DBA|[A-Z]{1,3}&[A-Z]{1,3})$/;
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

/** "31-DEC-2027" → "2027-12-31". PURE. */
export function hubDate(raw: string): string | null {
  const m = raw.trim().toUpperCase().match(/^(\d{2})-([A-Z]{3})-(\d{4})$/);
  if (!m) return null;
  const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(m[2]) + 1;
  return mon ? `${m[3]}-${String(mon).padStart(2, "0")}-${m[1]}` : null;
}

/**
 * One web_name.csv row (as an object keyed by its header) → a firm, or null when it is not an active
 * Texas HUB. Only the public business fields are kept. PURE.
 */
export function parseHubRow(r: Record<string, string | undefined>, classes: readonly string[]): TxHubFirm | null {
  if ((r.WEB_HUB_STATUS ?? "").trim() !== "A") return null;
  if ((r.WEB_STATE ?? "").trim() !== "TX") return null;
  const vid = (r.WEB_VID ?? "").trim();
  const name = (r.WEB_NAME_VENDOR_NAME ?? "").trim();
  if (!vid || !name) return null;
  const description = (r.WEB_DESC ?? "").replace(/\s+/g, " ").trim();
  return {
    key: hubKey(vid),
    name: hubName(name),
    city: hubName((r.WEB_CITY ?? "").trim()),
    county: hubName((r.WEB_COUNTY ?? "").trim()),
    description: description.slice(0, 254),
    trades: hubTrades(description, classes),
    expires: hubDate(r.WEB_HUB_EXPIRE_DATE ?? ""),
  };
}
