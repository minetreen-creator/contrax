import partTitles from "~/data/far-part-titles.json";
import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";

/**
 * Shared helpers for FAR/DFARS part pages and clause internal links.
 *
 * Honesty rules (see /clauses SEO channel plan):
 *  - Part names come ONLY from src/data/far-part-titles.json (curated from
 *    acquisition.gov headings, public domain). Never invent a name: unknown
 *    parts fall back to "Part {N}".
 *  - The set of parts that get pages/sitemap entries is DB-driven
 *    (SELECT DISTINCT part FROM far_clauses WHERE part IS NOT NULL) — never a
 *    hardcoded count (QA-observed distinct is ~100; canonical set is 107).
 *  - Subpart labels are derived from real clause numbers only (strip the
 *    -NNNN suffix from the section segment). Subpart TITLES are not in the
 *    DB — we never invent them.
 */

export const PART_TITLES: Record<string, string> = partTitles as Record<string, string>;

/** "FAR" | "DFARS" — mirrors the clause-index grouping rule. */
export function partLabel(part: string, source?: string | null): string {
  if (source === "dfars" || Number(part) >= 200) return "DFARS";
  return "FAR";
}

/** Name from the acquisition.gov title map; null → caller falls back to "Part {N}". */
export function partName(part: string): string | null {
  return PART_TITLES[part] ?? null;
}

/**
 * Real subpart derived from a clause number: first two dot-segments, minus any
 * -NNNN suffix on the section segment (52.212-4 → "52.212", 52.101 → "52.101",
 * 252.204-7012 → "252.204"). Numeric-only label — never a title.
 */
export function subpartOfClause(clauseNumber: string): string {
  const segs = String(clauseNumber).split(".");
  if (segs.length < 2) return segs[0] ?? clauseNumber;
  return `${segs[0]}.${segs[1].split("-")[0]}`;
}

/**
 * Related parts for the "More parts" footer on clause pages and part pages.
 * Rules (all factual, DB-gated — caller passes the set of parts that exist):
 *  1. Same-regulation neighbors: previous/next numeric part, included only if
 *     it exists in the DB.
 *  2. Cross-regulation counterpart: DFARS mirrors FAR numbering (DFARS 252 ↔
 *     FAR 52, DFARS 225 ↔ FAR 25, …). FAR part P → 200+P; DFARS part 200+P → P.
 */
export function relatedParts(
  part: string,
  existingParts: Set<string>,
): { type: "prev" | "next" | "counterpart"; part: string }[] {
  const out: { type: "prev" | "next" | "counterpart"; part: string }[] = [];
  const n = Number(part);
  if (!Number.isFinite(n)) return out;
  const prev = String(n - 1);
  const next = String(n + 1);
  if (existingParts.has(prev)) out.push({ type: "prev", part: prev });
  if (existingParts.has(next)) out.push({ type: "next", part: next });
  const counterpart = n < 200 ? String(n + 200) : String(n - 200);
  if (counterpart !== part && existingParts.has(counterpart)) {
    out.push({ type: "counterpart", part: counterpart });
  }
  return out;
}

export interface RelatedPart {
  type: "prev" | "next" | "counterpart";
  part: string;
}

export interface PartPageData {
  kind: "part";
  notFound: boolean;
  failed: boolean; // DB error → honest "temporarily unavailable" (mirrors index)
  part: string; // requested part number
  label: "FAR" | "DFARS";
  name: string | null;
  count: number;
  clauses: string[];
  related: RelatedPart[];
}

/**
 * Server fn backing /clauses/{part} part pages. DB-driven: the part set comes
 * from DISTINCT far_clauses.part — never a hardcoded list.
 */
export const getPartPageData = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: string }): Promise<PartPageData> => {
    const part = String(data).trim();
    const empty: PartPageData = {
      kind: "part",
      notFound: false,
      failed: false,
      part,
      label: "FAR",
      name: null,
      count: 0,
      clauses: [],
      related: [],
    };
    if (!/^\d{1,3}$/.test(part)) return { ...empty, notFound: true };
    let rows;
    try {
      const db = sql();
      const [countRows, clauseRows, partRows] = await Promise.all([
        db`SELECT COUNT(*)::int AS count, MAX(source) AS source FROM far_clauses WHERE part = ${part}`,
        db`SELECT clause_number FROM far_clauses WHERE part = ${part} ORDER BY clause_number`,
        db`SELECT DISTINCT part FROM far_clauses WHERE part IS NOT NULL`,
      ]);
      const count = Number((countRows[0] as any)?.count || 0);
      if (count <= 0) return { ...empty, notFound: true };
      const source = (countRows[0] as any)?.source ?? null;
      const existingParts = new Set(
        (partRows as { part: string | null }[]).map((r) => String(r.part)),
      );
      return {
        kind: "part",
        notFound: false,
        failed: false,
        part,
        label: partLabel(part, source),
        name: partName(part),
        count,
        clauses: (clauseRows as { clause_number: string }[]).map((r) => String(r.clause_number)),
        related: relatedParts(part, existingParts),
      };
    } catch (err) {
      console.error("[clauses] failed to load part page:", err);
      return { ...empty, failed: true };
    }
  },
);
