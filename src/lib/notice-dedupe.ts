/**
 * Cross-source notice dedupe, READ TIME ONLY (owner PRIORITY 09-21, R5).
 *
 * THE PROBLEM (audit §2.5): `UNIQUE (source, external_id)` is PER SOURCE, and
 * every state-door collector re-ingests the SAME federal notice under its own
 * prefix (`oh-<noticeId>`, `va-<noticeId>`, …). Measured in production: 3,652
 * title groups (12,546 rows — 36.9% of the corpus) share one title across ≥2
 * sources; `F108--Mobile Firing Range Cleaning` alone is counted 11×. Any
 * "we now have N janitorial opportunities" number is therefore inflated ~3×
 * unless the same notice is collapsed.
 *
 * THE RULE HERE: collapse at READ time, NEVER delete a row. The database keeps
 * every row (provenance), and a caller that displays or counts a result set
 * collapses it through this module first, so it can report honest "distinct
 * notices" alongside rows.
 *
 * THE KEY: SAM's own solicitation number (`bids.solicitation_number`, stored by
 * migration 047 / R2) is the authority — it is the same string on every
 * re-ingestion of one notice. Rows whose source supplied no solicitation number
 * fall back to the natural key the ingest path already dedupes on:
 * `lower(btrim(title)) + lower(btrim(agency))`.
 *
 * Honesty notes: the FIRST occurrence in input order is kept (deterministic, so
 * a caller's ordering (due-date/score) decides which representative wins rather
 * than this module guessing); the input array is never mutated.
 */

/** The fields the dedupe key reads. Extra fields are ignored and preserved. */
export interface NoticeKeyRow {
  solicitation_number?: string | null;
  title?: string | null;
  agency?: string | null;
}

function norm(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * The dedupe key for one row: the source's own solicitation number when present,
 * else the (title, agency) natural key. Exported so a surface can group rows, and
 * so the key itself is testable in isolation.
 */
export function noticeDedupeKey(row: NoticeKeyRow): string {
  const sol = norm(row?.solicitation_number);
  if (sol) return `sol:${sol}`;
  return `nat:${norm(row?.title)}|${norm(row?.agency)}`;
}

/**
 * Collapse rows that represent the SAME notice. Keeps the first row per key in
 * input order; returns a NEW array plus how many duplicate rows were collapsed
 * (so a caller can report "N rows / M distinct notices" honestly).
 */
export function collapseDuplicateNotices<T extends NoticeKeyRow>(
  rows: readonly T[],
): { rows: T[]; collapsed: number } {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = noticeDedupeKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return { rows: out, collapsed: rows.length - out.length };
}
