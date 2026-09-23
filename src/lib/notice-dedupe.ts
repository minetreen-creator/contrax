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
 * FIX ① (owner-locked nationwide correctness fix, 2026-09-23): the key also
 * carries `notice_type`, because a solicitation number identifies a
 * SOLICITATION, not every notice DOCUMENT filed under it. SAM publishes an
 * Award Notice and a Justification (or a Presolicitation and the Solicitation
 * that follows it) under the SAME number, and collapsing them loses a public
 * notice from Radar. Measured in production (read-only, 2026-09-23):
 *   - 139010 (Award Notice) / 139012 (Justification) — same solicitation
 *     `140FS126P0240`, same title, same agency, same psc: today ONE match;
 *   - three OPEN pairs likewise (N0010425QNE53, N0010426QBF90, N0010426RUC01 —
 *     each a Presolicitation + its Solicitation), so the live product-surface
 *     bug is not limited to the expired pair the audit cited;
 *   - among all open rows, ZERO (title, agency) groups carry more than one
 *     notice_type, so widening the key splits nothing that should stay merged
 *     (no re-inflation: 3,290 → 3,293 distinct open notices, i.e. exactly the
 *     three pairs this fixes).
 *
 * This mirrors the stored 5-dim natural key of migration 048
 * (`lower(btrim(title)), lower(btrim(agency)), COALESCE(notice_type,''),
 * due_date, COALESCE(psc,'')`) in the one dimension that separates the
 * live amendment pairs. A missing / NULL notice_type normalizes to the empty
 * string — ONE key value, never a wildcard (same rule as the ingest key: two
 * rows that both lack it stay collapsible).
 *
 * Honesty notes: the FIRST occurrence in input order is kept (deterministic, so
 * a caller's ordering (due-date/score) decides which representative wins rather
 * than this module guessing); the input array is never mutated.
 */

/** The fields the dedupe key reads. Extra fields are ignored and preserved. */
export interface NoticeKeyRow {
  solicitation_number?: string | null;
  /** The 5-dim natural key's amendment dimension (migration 047 / 048). */
  notice_type?: string | null;
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
 * else the (title, agency) natural key — each carrying notice_type, so an Award
 * Notice and a Justification filed under one solicitation number stay SEPARATE
 * (FIX ①). Exported so a surface can group rows, and so the key itself is
 * testable in isolation.
 */
export function noticeDedupeKey(row: NoticeKeyRow): string {
  const noticeType = norm(row?.notice_type);
  const sol = norm(row?.solicitation_number);
  if (sol) return `sol:${sol}|nt:${noticeType}`;
  return `nat:${norm(row?.title)}|${norm(row?.agency)}|nt:${noticeType}`;
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

/**
 * S2 NOTICE IDENTITY — the SQL twin of `noticeDedupeKey`, for the surfaces that
 * collapse rows in SQL (`DISTINCT ON`) instead of in JS.
 *
 * Before this, the SQL surfaces collapsed on a 2-dim key, `(title, agency)`,
 * while Radar collapsed on `sol + notice_type` / `title + agency + notice_type`
 * (D11). The same notice could therefore be ONE match in Radar and TWICE on a
 * listing surface, and an amendment pair (Award Notice + Justification under one
 * solicitation number) was collapsed on one surface and split on another.
 *
 * This returns the canonical key's TWO dimensions as a comma-joined SQL
 * expression list, so a caller writes BOTH clauses from ONE source of truth:
 *
 *   SELECT DISTINCT ON (${sql().unsafe(noticeKeySql("bids"))}) …
 *   FROM bids
 *   ORDER BY ${sql().unsafe(noticeKeySql("bids"))}, created_at DESC NULLS LAST
 *
 * Dimension 1 is the source's own solicitation number when present, else
 * `title|agency`; dimension 2 is the notice type (NULL normalizes to the empty
 * string — ONE key value, never a wildcard, exactly like the JS key). Postgres
 * requires the ORDER BY prefix to be the same expressions, which is why both
 * halves come from this one helper.
 *
 * `solicitation_number` is NULL on 98 % of the corpus, in which case this
 * degenerates to the historical `(title, agency, notice_type)` key; it differs
 * from today's SQL surfaces exactly where a solicitation number exists and the
 * titles differ, which is precisely the amendment case Radar already splits.
 *
 * NOTE: the ingest-side keys (`batchInsertNaturalKey`, migration 048's partial
 * UNIQUE index, the cross-source `WHERE NOT EXISTS` guard) are deliberately NOT
 * touched — they answer a different question (is this row already stored?).
 */
export function noticeKeySql(alias: string = "bids"): string {
  return (
    `COALESCE(NULLIF(btrim(${alias}.solicitation_number), ''), ` +
    `lower(btrim(${alias}.title)) || '|' || lower(btrim(${alias}.agency))), ` +
    `COALESCE(lower(btrim(${alias}.notice_type)), '')`
  );
}
