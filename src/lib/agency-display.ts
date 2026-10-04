/**
 * READABLE AGENCY NAMES for bid cards (owner 2026-10-04: the homepage showed
 * "256-NETWORK CONTRACT OFFICE 16 (36C256)", which never says it is the VA).
 *
 * SAM.gov stores the deepest contracting office, in capitals, with an internal
 * number in front and the office code (AAC) in brackets. The code's prefix
 * names the department, so it is turned into a short label in front:
 *   "256-NETWORK CONTRACT OFFICE 16 (36C256)" → "VA Network Contract Office 16"
 * Only prefixes that belong to one department are used; anything else keeps
 * its own words exactly (minus the number and code), never a guessed department.
 *
 * PURE; unit-tested in agency-display.test.ts.
 */

/** Office-code prefixes that identify one department. */
const DEPARTMENT_BY_CODE: [RegExp, string][] = [
  [/^36C/i, "VA"],
  [/^FA\d/i, "Air Force"],
  [/^SP[0-9EMR]/i, "DLA"],
  [/^70Z/i, "Coast Guard"],
  [/^47/i, "GSA"],
];

/** Common office words, title-cased; anything else (ACC, AMIC, WY, FA4890) keeps its capitals. */
const OFFICE_WORDS = new Set([
  "network", "contract", "contracting", "contracts", "office", "offices", "strategic", "acquisition", "acquisitions",
  "center", "centre", "land", "maritime", "medical", "health", "care", "system", "systems", "regional", "region",
  "procurement", "service", "services", "logistics", "support", "division", "district", "command", "base",
  "squadron", "wing", "group", "national", "cemetery", "administration", "facilities", "facility", "supply",
  "aviation", "troop", "energy", "distribution", "operations", "activity", "headquarters", "field", "sector",
  "station", "yard", "east", "west", "north", "south", "central", "pacific", "atlantic",
]);
const SMALL = new Set(["of", "and", "for", "the", "to", "on", "in", "at"]);

function officeCase(s: string): string {
  if (s !== s.toUpperCase()) return s; // already mixed case: leave it as the source wrote it
  return s
    .split(/(\s+|-|\/)/)
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && SMALL.has(lower)) return lower;
      if (OFFICE_WORDS.has(lower)) return lower.charAt(0).toUpperCase() + lower.slice(1);
      return w;
    })
    .join("");
}

/** A short, readable agency label for a bid card. Empty/null input → null. */
export function displayAgency(agency: string | null | undefined): string | null {
  let s = String(agency ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  let dept: string | null = null;
  const code = /\s*\(([A-Z0-9]{4,8})\)\s*$/i.exec(s);
  if (code) {
    dept = DEPARTMENT_BY_CODE.find(([re]) => re.test(code[1]))?.[1] ?? null;
    s = s.slice(0, code.index).trim();
  }
  s = s.replace(/^\d{2,4}\s*-\s*/, ""); // "256-NETWORK …" internal office number
  if (!s) return dept;
  if (!dept) return s; // unrecognized office: its own words, as written
  const name = officeCase(s);
  return new RegExp(`\\b${dept}\\b`, "i").test(name) ? name : `${dept} ${name}`;
}

/** A location worth showing on a card: "United States" alone says nothing. */
export function displayLocation(location: string | null | undefined): string | null {
  const s = String(location ?? "").replace(/\s+/g, " ").trim();
  if (!s || /^(united states|usa?|u\.s\.a?\.?|nationwide)$/i.test(s)) return null;
  return s;
}
