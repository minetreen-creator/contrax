/**
 * Rule-based plain-English meta descriptions for clause pages, generated at
 * SSR time from the loaded clause (never a build-time pass, never a DB
 * column — no staleness).
 *
 * HONESTY GUARDRAILS (non-negotiable):
 *  - Every token comes from DB fields (number/title/part/source) or the
 *    VERBATIM lead sentence of full_text (public-domain regulatory text).
 *  - No invented interpretations, no claims about what a clause "requires".
 *  - If the text is empty/short, fall back to the safe template — never
 *    fabricate a paraphrase.
 */

interface ClauseMetaInput {
  clause_number: string;
  title: string;
  part?: string | null;
  source?: string | null;
  full_text?: string | null;
}

const sourceLabel = (source?: string | null) => (source === "dfars" ? "DFARS" : "FAR");

/** Collapse whitespace, strip leading "("…")" markers and an "As prescribed
 * in …" preamble up to the first sentence end. */
function extractLead(fullText: string): string {
  let t = fullText.replace(/\s+/g, " ").trim();
  if (!t) return "";
  // Strip leading parenthetical markers: "(a) ..." or "(1) ..."
  while (/^\(\d+[a-z]?\)\s+/.test(t)) t = t.replace(/^\(\d+[a-z]?\)\s+/, "");
  // Strip "As prescribed in ..." preamble (up to first ". " followed by uppercase).
  if (/^As prescribed in/i.test(t)) {
    const m = t.match(/\.\s+[A-Z]/);
    if (m && m.index !== undefined) t = t.slice(m.index + 1).trim();
    else t = "";
  }
  if (!t) return "";
  // First sentence end: ". " followed by uppercase, or end of string.
  const m = t.match(/\.\s+[A-Z]/);
  if (m && m.index !== undefined) {
    t = t.slice(0, m.index + 1).trim();
  } else {
    // No clean sentence end — keep whole string (caller caps length).
    t = t.trim();
  }
  return t;
}

/** Truncate at a word boundary to at most `max` chars, appending "…". */
function truncateAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(" ");
  const end = lastSpace > 0 ? lastSpace : max;
  return s.slice(0, end).trimEnd() + "…";
}

export function buildClauseMetaDescription({
  clause_number,
  title,
  part,
  source,
  full_text,
}: ClauseMetaInput): string {
  const label = sourceLabel(source);
  const number = String(clause_number);
  const cleanTitle = String(title || "").trim();
  const lead = extractLead(String(full_text || "").trim());

  let description: string;
  if (lead.length >= 40) {
    description = `${label} ${number} — ${cleanTitle}. ${lead} Full text from acquisition.gov.`;
  } else {
    description = `Read the full text of ${label} ${number} — ${cleanTitle}. Exact regulatory text from acquisition.gov, free.`;
  }

  // Final trim to 158 chars at a word boundary.
  if (description.length > 158) {
    const titlePart = `${label} ${number} — ${cleanTitle}`;
    if (titlePart.length >= 158) {
      description = truncateAtWord(titlePart, 158);
    } else {
      const leadPart = description.slice(titlePart.length + 1);
      const remaining = 158 - titlePart.length - 1;
      const trimmedLead = truncateAtWord(leadPart, remaining);
      description = `${titlePart}. ${trimmedLead}`;
    }
  }
  return description;
}
