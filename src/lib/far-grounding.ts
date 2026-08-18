/**
 * FAR-Grounded Drafting — clause retrieval + citation extraction.
 *
 * Grounds AI-generated proposal drafts in the REAL FAR clause library
 * (`far_clauses` table, synced from acquisition.gov). Honesty is the point:
 * every citation that survives `extractCitations` resolves to an actual row in
 * `far_clauses` — the model is never allowed to invent clause numbers.
 *
 * - `retrieveRelevantClauses(bid)` — extracts meaningful bid tokens
 *   (≥3 chars, stopword-filtered), OR-matches them with ILIKE against clause
 *   title + full_text, prioritizes title matches, capped at 12. Fail-open:
 *   no matches → [] (an ungrounded draft is honest; inventing is not).
 * - `extractCitations(draftText, clauseLibrary)` — regex-scans the draft for
 *   FAR/DFARS clause numbers ([FAR 52.212-4], bare 52.212-4 / 252.204-7012 /
 *   5.xxx-style), resolves each against the provided library, and DB-validates
 *   any number not in the library via exact clause_number lookup — a cited
 *   number is included ONLY if the row exists. Returns deduped clauses in
 *   first-cited order.
 *
 * Uses only global fetch + neon — safe inside TanStack Start API routes.
 */
import { sql } from "~/db";
import { ensureFarClausesSeeded, getClauseByNumber } from "./far-dfars";

export interface GroundedClause {
  clause_number: string;
  title: string;
  full_text: string;
}

/** Bid fields used for clause retrieval. */
export interface BidForGrounding {
  title?: string | null;
  description?: string | null;
  category?: string | null;
  agency?: string | null;
  keywords?: string[] | null;
}

const MAX_RETRIEVED_CLAUSES = 12;
/**
 * Tokens matching more than this fraction of the clause library are
 * boilerplate (e.g. "agency", "provide", "services" — and substring noise
 * like "ess") and would drown out discriminative tokens; drop them so the
 * returned clauses are actually about the bid.
 */
const MAX_TOKEN_DOC_FREQUENCY = 0.2;

/** Standard English stopwords (shorter than 3 chars are dropped anyway). */
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can",
  "had", "her", "was", "one", "our", "out", "day", "get", "has", "him",
  "his", "how", "man", "new", "now", "old", "see", "two", "way", "who",
  "boy", "did", "its", "let", "put", "say", "she", "too", "use", "that",
  "with", "have", "this", "will", "your", "from", "they", "know", "want",
  "been", "good", "much", "some", "time", "very", "when", "come", "here",
  "just", "like", "long", "make", "many", "more", "only", "over", "such",
  "take", "than", "them", "well", "were", "what", "would", "about",
  "after", "again", "could", "ever", "every", "first", "great", "must",
  "right", "still", "think", "where", "world", "never", "other", "there",
  "these", "their", "which", "while", "those", "through", "because",
  "before", "between", "during", "without", "under", "above", "below",
  "into", "onto", "upon", "also", "else", "even", "though", "although",
  "however", "therefore", "thus", "hence", "shall",
]);

/** Extract meaningful search tokens (≥3 chars, stopword-filtered, deduped). */
function extractTokens(...fields: Array<string | null | undefined>): string[] {
  const tokens = new Set<string>();
  for (const field of fields) {
    if (!field) continue;
    for (const raw of field.toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length >= 3 && !STOPWORDS.has(raw)) tokens.add(raw);
    }
  }
  return [...tokens];
}

/**
 * Retrieve up to 12 real FAR/DFARS clauses relevant to a bid.
 * Tokens are stopword-filtered and pruned by document frequency (boilerplate
 * tokens matching >20% of the library are dropped), then OR-matched at the
 * WORD level (Postgres full-text: `to_tsvector @@ to_tsquery`) against clause
 * title + full_text — the same search path as `searchFARClauses`, backed by
 * the `idx_far_clauses_search_tsv` GIN index over the stored `search_tsv`
 * tsvector. Word-level matching avoids the substring noise of ILIKE (e.g. the
 * token "ess" matching "process"), including when a token never occurs as a
 * standalone word. Title matches rank first — `search_tsv` stores title
 * lexemes at weight A and full-text lexemes at weight B, so `ts_rank` with
 * weights {0.1,0.1,0.333,1} weighs title hits 3× full-text hits. Fail-open:
 * any error or empty match returns [] — an ungrounded draft is honest;
 * fabricating clause numbers is not.
 */
export async function retrieveRelevantClauses(bid: BidForGrounding): Promise<GroundedClause[]> {
  try {
    const keywords =
      Array.isArray(bid.keywords) && bid.keywords.length > 0 ? bid.keywords.join(" ") : null;
    const tokens = extractTokens(bid.title, bid.description, bid.category, bid.agency, keywords);
    if (tokens.length === 0) return [];
    await ensureFarClausesSeeded();
    // Prune boilerplate tokens by document frequency (one round-trip).
    const dfRows = await sql()`
      SELECT t.pat,
        (SELECT COUNT(*) FROM far_clauses fc
         WHERE to_tsvector('english', fc.title || ' ' || fc.full_text)
               @@ plainto_tsquery('english', t.pat)) AS c,
        (SELECT COUNT(*) FROM far_clauses) AS total
      FROM unnest(${tokens}::text[]) AS t(pat)
    `;
    const kept = (dfRows as Array<Record<string, unknown>>)
      .filter((r) => Number(r.c) / Number(r.total) <= MAX_TOKEN_DOC_FREQUENCY)
      .map((r) => String(r.pat));
    if (kept.length === 0) return [];
    const query = kept.join(" | ");
    // Rank candidates with ts_rank over the STORED weighted tsvector
    // (search_tsv — see ensureFarClausesTable). This replaces the old ORDER BY,
    // whose two correlated subqueries unnest()-ed every kept token and rebuilt
    // to_tsvector(title)/to_tsvector(full_text) per token per matching row —
    // with 92-94% of the 4,630-clause library matching a realistic bid, that
    // was ~1M+ tsvector constructions per retrieval (measured >20s–minutes).
    // search_tsv carries title lexemes at weight A and full-text lexemes at
    // weight B, and the weights array {D,C,B,A} = {0.1,0.1,0.333,1} gives title
    // matches 3× the weight of full-text matches, mirroring the historical
    // 3*title + 1*full_text ranking intent. Deterministic: equal ranks tie on
    // clause_number ASC. The WHERE candidate set is unchanged (search_tsv is
    // the same expression, stored; @@ ignores weights unless the tsquery
    // restricts them) — the document-frequency prune above still bounds it.
    const rows = await sql()`
      SELECT clause_number, title, full_text
      FROM far_clauses
      WHERE search_tsv @@ to_tsquery('english', ${query})
      ORDER BY
        ts_rank('{0.1,0.1,0.333,1}'::float4[], search_tsv, to_tsquery('english', ${query})) DESC,
        clause_number ASC
      LIMIT ${MAX_RETRIEVED_CLAUSES}
    `;
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      clause_number: String(r.clause_number),
      title: String(r.title ?? ""),
      full_text: String(r.full_text ?? ""),
    }));
  } catch {
    return [];
  }
}

/** Normalize dash variants (en/em/hyphen-minus) so "52.212–4" ≡ "52.212-4". */
function normalizeDashes(text: string): string {
  return text.replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-");
}

/** Explicit "FAR 52.212-4" / "DFARS 252.204-7012" citations. */
const PREFIXED_CLAUSE_RE =
  /\b(?:FAR|DFARS)\s*(52\.\d{3,4}(?:-\d{1,4})?|252\.\d{3,4}(?:-\d{1,4})?)/gi;
/** Bare clause numbers (52.212-4, 252.204-7012, 5.xxx-style) where unambiguous. */
const BARE_CLAUSE_RE =
  /(?<![\w.])(52\.\d{3,4}(?:-\d{1,4})?|252\.\d{3,4}(?:-\d{1,4})?|5\.\d{3,4}(?:-\d{1,4})?)(?![\w.-])/g;
const CLAUSE_NUMBER_RE = /^\d{1,3}\.\d{3,4}(?:-\d{1,4})?$/;

/**
 * Scan draft text for FAR/DFARS clause numbers and resolve each against the
 * provided clause library. Any cited number NOT in the library is looked up
 * in `far_clauses` by exact clause_number and included ONLY if the row exists
 * — fabricated clause numbers never survive. Returns deduped clauses in the
 * order they first appear in the draft.
 */
export async function extractCitations(
  draftText: string,
  clauseLibrary: GroundedClause[],
): Promise<GroundedClause[]> {
  const text = normalizeDashes(String(draftText ?? ""));
  if (!text) return [];
  const library = new Map<string, GroundedClause>();
  for (const c of clauseLibrary) library.set(String(c.clause_number).toUpperCase(), c);
  const seen = new Set<string>();
  const citations: GroundedClause[] = [];
  for (const re of [PREFIXED_CLAUSE_RE, BARE_CLAUSE_RE]) {
    for (const match of text.matchAll(re)) {
      const raw = String(match[1] ?? match[0]).trim();
      const key = raw.toUpperCase();
      if (!CLAUSE_NUMBER_RE.test(key) || seen.has(key)) continue;
      seen.add(key);
      const libHit = library.get(key);
      if (libHit) {
        citations.push(libHit);
        continue;
      }
      // Not in the retrieved library — DB-validate before accepting.
      const row = await getClauseByNumber(raw);
      if (row) {
        citations.push({
          clause_number: row.clause_number,
          title: row.title,
          full_text: row.full_text,
        });
      }
    }
  }
  return citations;
}
