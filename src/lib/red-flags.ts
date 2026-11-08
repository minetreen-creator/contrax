/**
 * Clause & requirement red-flag scanner (owner 2026-11-08: "highlights hidden dealbreakers, such as
 * liquidated damages, security clearance needs, prevailing wage rules, or strict bonding thresholds,
 * so estimators save hours of reading").
 *
 * Plain rules, no AI: each rule is a pattern for wording solicitations use, and every flag quotes the
 * sentence it came from (with its page when the text came from a PDF), so the estimator checks the
 * real words, not a guess. A flag means "read this part", never "this bid is bad". PURE, browser-safe.
 */
export interface RedFlagRule {
  id: string;
  label: string;
  /** Why an estimator wants to see it. */
  why: string;
  pattern: RegExp;
}

export const RED_FLAG_RULES: readonly RedFlagRule[] = [
  {
    id: "liquidated-damages",
    label: "Liquidated damages",
    why: "A set amount you pay for each day you finish late. Price the schedule risk.",
    pattern: /liquidated damages/i,
  },
  {
    id: "security-clearance",
    label: "Security clearance",
    why: "Staff (or the company) may need a clearance before work starts, which can take months.",
    pattern: /security clearance|secret clearance|top secret|\bts\/sci\b|facility (security )?clearance/i,
  },
  {
    id: "prevailing-wage",
    label: "Prevailing wage / wage determination",
    why: "Minimum pay rates are set for the job. Your labor rates must meet them, with certified payroll.",
    pattern: /prevailing wage|davis[- ]bacon|wage determination|service contract (act|labor standards)|certified payroll/i,
  },
  {
    id: "bonding",
    label: "Bonds required",
    why: "Bid, performance or payment bonds. Check the amount and that your surety will write it.",
    pattern: /bid bond|bid security|performance bond|payment bond|surety bond/i,
  },
  {
    id: "mandatory-meeting",
    label: "Mandatory pre-bid meeting or site visit",
    why: "Miss it and your bid can be rejected. Note the date.",
    pattern: /mandatory (pre-?bid|pre-?proposal|site (visit|walk)|walk-?through|conference|meeting)|attendance (at|is) (the )?(pre-?bid|site visit)[^.]{0,40}(mandatory|required)/i,
  },
  {
    id: "insurance-limits",
    label: "High insurance limits",
    why: "Coverage in the millions. Confirm your policy (or umbrella) reaches it before you bid.",
    pattern: /(general liability|umbrella|excess liability|professional liability|auto(mobile)? liability)[^.]{0,160}(\$\s?\d{1,3}(,\d{3}){2,}|\$?\s?\d+(\.\d+)? million)/i,
  },
  {
    id: "experience",
    label: "Minimum experience",
    why: "A set number of years or similar past jobs. Have the references ready.",
    pattern: /(minimum of|at least|no (less|fewer) than) (\d+|two|three|four|five|six|seven|eight|nine|ten) \(?\d*\)? ?(years?|similar (projects|contracts)|projects)[^.]{0,60}(experience|similar|comparable|size)/i,
  },
  {
    id: "retainage",
    label: "Retainage",
    why: "Part of each payment is held back until the end. Plan your cash flow.",
    pattern: /retainage|retain(ed)? \d+ ?(%|percent)/i,
  },
  {
    id: "participation-goals",
    label: "DBE / MBE / small business goals",
    why: "A share of the work must go to certified firms, with forms due at bid time.",
    pattern: /\b(dbe|mbe|wbe|sbe|dvbe|hub|hubzone|small business)\b[^.]{0,40}(goal|participation|subcontracting plan)/i,
  },
  {
    id: "background-checks",
    label: "Background checks / E-Verify",
    why: "Staff screening or E-Verify enrollment before work starts.",
    pattern: /background (check|investigation)|e-verify|fingerprint/i,
  },
  {
    id: "long-warranty",
    label: "Long warranty",
    why: "Warranty beyond the usual one year. Price the call-backs.",
    pattern: /\bwarrant(y|ies|s)?\b[^.]{0,60}\b(two|three|four|five|ten|[2-9]|1\d)\s*(\(\d+\)\s*)?years?/i,
  },
];

export interface RedFlagSnippet {
  /** 1-based page when the text came with page markers, else null. */
  page: number | null;
  text: string;
}

export interface RedFlag {
  id: string;
  label: string;
  why: string;
  count: number;
  snippets: RedFlagSnippet[];
}

/** Page marker the PDF reader puts between pages. */
export const PAGE_MARK = "\n=====PAGE=====\n";
const MAX_SNIPPETS = 3;

function sentenceAround(text: string, at: number, len: number): string {
  const before = text.lastIndexOf(".", at);
  const startCut = Math.max(before + 1, at - 160);
  const afterDot = text.indexOf(".", at + len);
  const endCut = Math.min(afterDot === -1 ? text.length : afterDot + 1, at + len + 200);
  return text.slice(startCut, endCut).replace(/\s+/g, " ").trim();
}

/** Scan text (optionally with PAGE_MARK between pages) for every rule. PURE. */
export function scanRedFlags(text: string): RedFlag[] {
  const pages = String(text ?? "").split(PAGE_MARK);
  const paged = pages.length > 1;
  const out: RedFlag[] = [];
  for (const rule of RED_FLAG_RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    let count = 0;
    const snippets: RedFlagSnippet[] = [];
    const seen = new Set<string>();
    pages.forEach((page, i) => {
      for (const m of page.matchAll(re)) {
        count++;
        if (snippets.length >= MAX_SNIPPETS) continue;
        const s = sentenceAround(page, m.index ?? 0, m[0].length);
        if (!s || seen.has(s)) continue;
        seen.add(s);
        snippets.push({ page: paged ? i + 1 : null, text: s.length > 360 ? `${s.slice(0, 357)}…` : s });
      }
    });
    if (count) out.push({ id: rule.id, label: rule.label, why: rule.why, count, snippets });
  }
  return out;
}
