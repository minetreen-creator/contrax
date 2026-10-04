/**
 * Readable bid titles (owner 2026-10-04: homepage and Radar titles read like
 * code — "Z2DA--Project: 459-27-004 ACC MOD 2 Renovation", "54-TJK-08-PR39943,
 * CUSTODIAL OPERATIONS AND MAINTENANCE OF REST AREAS"). DISPLAY ONLY: stored
 * titles never change, and the stripped reference stays available for small
 * print. PURE; unit-tested in bid-title.test.ts.
 */

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with", "via", "per"]);
const ACRONYMS = new Set([
  "VA", "VAMC", "HVAC", "IT", "US", "USA", "DOT", "ADA", "DOD", "DHS", "GSA", "NASA", "FAA", "EPA", "USDA", "NPS", "USACE",
  "IDIQ", "BPA", "SDVOSB", "WOSB", "EDWOSB", "HUBZONE", "8A", "AE", "A/E", "ACC", "MOD", "ATC", "CCTV", "LED", "UPS", "AED",
  "MRI", "CT", "EMS", "PPE", "FY", "II", "III", "IV", "NC", "SC", "VA", "MD", "DC", "TX", "FL", "GA", "CA", "NY", "PA", "OH",
]);

export interface CleanTitle {
  /** Readable title for display. */
  title: string;
  /** Leading code / reference number removed from the title, if any. */
  reference: string | null;
}

/** Strip a leading PSC/FSC code ("Z2DA--", "S201 --") and leading reference numbers ("54-TJK-08-PR39943,"). */
function stripLeadingCodes(raw: string): { rest: string; refs: string[] } {
  let rest = raw.trim();
  const refs: string[] = [];
  for (let i = 0; i < 4; i++) {
    let m = rest.match(/^([A-Z0-9]{2,4})\s*--+\s*/i); // PSC / FSC class code
    if (m) {
      rest = rest.slice(m[0].length);
      continue;
    }
    m = rest.match(/^([A-Z]\d{3})\s+(?=[A-Za-z])/); // "R606 Court Reporting"
    if (m) {
      rest = rest.slice(m[0].length);
      continue;
    }
    m = rest.match(/^(?:project|solicitation|sol\.?|rfp|rfq|ifb|itb|no\.?|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9./-]*\d[A-Z0-9./-]*)\s*[,:|–-]?\s*/i);
    if (m) {
      refs.push(m[1]);
      rest = rest.slice(m[0].length);
      continue;
    }
    m = rest.match(/^([A-Z0-9]+(?:[-/.][A-Z0-9]+){2,})\s*[,:|–-]?\s+/i); // 54-TJK-08-PR39943,
    if (m && /\d/.test(m[1])) {
      refs.push(m[1]);
      rest = rest.slice(m[0].length);
      continue;
    }
    break;
  }
  return { rest: rest.replace(/^[\s,:;|–-]+/, "").trim(), refs };
}

function isMostlyUpper(s: string): boolean {
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length < 6) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length > 0.8;
}

function titleCaseWord(word: string, first: boolean): string {
  const core = word.replace(/[^A-Za-z0-9/]/g, "");
  const upper = core.toUpperCase();
  if (ACRONYMS.has(upper) || /\d/.test(core)) return word.toUpperCase();
  const lower = word.toLowerCase();
  if (!first && SMALL_WORDS.has(lower.replace(/[^a-z]/g, ""))) return lower;
  return lower.replace(/[a-z]/, (c) => c.toUpperCase()).replace(/([/-])([a-z])/g, (_, s, c) => s + c.toUpperCase());
}

/** All-caps titles become title case; parenthesised short tokens ("(OR)") stay upper case. */
function fixCase(s: string): string {
  if (!isMostlyUpper(s)) return s;
  return s
    .split(/(\s+)/)
    .map((tok, i) => {
      if (/^\s+$/.test(tok)) return tok;
      if (/^\([A-Z0-9]{1,5}\)[.,;:]?$/.test(tok)) return tok;
      return titleCaseWord(tok, i === 0);
    })
    .join("");
}

export function cleanBidTitle(raw: string | null | undefined): CleanTitle {
  const original = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!original) return { title: "", reference: null };
  const { rest, refs } = stripLeadingCodes(original);
  // Never strip a title down to nothing useful.
  const base = /[A-Za-z]{3,}/.test(rest) ? rest : original;
  const title = fixCase(base);
  return { title, reference: refs.length && base !== original ? refs.join(" ") : null };
}

/**
 * True when a title is still mostly codes after cleaning (fewer than two real
 * words, or more digits than letters): such rows make poor homepage examples.
 */
export function isCodeHeavyTitle(raw: string | null | undefined): boolean {
  const { title } = cleanBidTitle(raw);
  const words = title.match(/[A-Za-z]{3,}/g) ?? [];
  const digits = (title.match(/\d/g) ?? []).length;
  const letters = (title.match(/[A-Za-z]/g) ?? []).length;
  return words.length < 2 || digits > letters * 0.4 || /\|/.test(title);
}
