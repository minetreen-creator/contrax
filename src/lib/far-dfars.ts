/**
 * FAR/DFARS Knowledge Base — fetcher, parser, and search.
 *
 * Live regulatory data source (public, no API key):
 *   https://www.acquisition.gov/far      → FAR compiled HTML per part
 *   https://www.acquisition.gov/dfars    → DFARS compiled HTML per part
 *
 * Both regulations are published as one HTML file per part at
 *   https://www.acquisition.gov/sites/default/files/current/{far|dfars}/compiled_html/part_{N}.html
 *
 * The HTML is DITA-rendered with one <article class="topic concept"> per
 * section/clause; each article carries a heading like
 *     <span class="ph autonumber">52.212-1</span> Instructions to Offerors...
 * and a <div class="body conbody clause|provision"> holding the full text.
 *
 * Design:
 * - `syncFarDfars()` fetches every part, parses it, and idempotently upserts
 *   into the `far_clauses` table (ON CONFLICT clause_number DO UPDATE), so it
 *   is safe to run repeatedly (admin button, /api/sync-far, daily cron).
 * - `searchFARClauses()` / `getClauseByNumber()` power the AI context. On the
 *   first query an empty table is bootstrapped from the bundled seed
 *   (src/data/far-clauses-seed.json — the most-cited FAR 52.2 and DFARS 252
 *   clauses), so the Copilot and Compliance Checker have exact clause text
 *   even before the first live sync runs.
 * - The library uses only global `fetch` + neon — no node builtins — so it is
 *   safe inside TanStack Start API routes and server functions.
 */
import { sql } from "~/db";
import seed from "../data/far-clauses-seed.json";

export type FARSource = "far" | "dfars";

export interface FARClause {
  clause_number: string;
  title: string;
  part: string | null;
  subpart: string | null;
  section: string | null;
  full_text: string;
  source: FARSource;
  last_updated?: string;
}

export interface FARClauseStats {
  total: number;
  far: number;
  dfars: number;
  lastUpdated: string | null;
}

export interface FarDfarsSyncResult {
  sources: FARSource[];
  requestedParts: number;
  fetchedParts: number;
  failedParts: string[];
  clausesIndexed: number;
  seeded: boolean;
  duration: string;
}

/** FAR parts 1–53 (53 parts). */
export const FAR_PART_NUMBERS: number[] = Array.from({ length: 53 }, (_, i) => i + 1);
/** DFARS parts 201–253 plus part 270 (54 parts). */
export const DFARS_PART_NUMBERS: number[] = [
  ...Array.from({ length: 53 }, (_, i) => 201 + i),
  270,
];

const ACQ_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const PART_HTML_URL =
  "https://www.acquisition.gov/sites/default/files/current/{source}/compiled_html/part_{part}.html";

// ── Seed (bundled fallback / bootstrap) ─────────────────────────────────────
const SEED_CLAUSES = seed as unknown as FARClause[];

// ── HTML parsing ────────────────────────────────────────────────────────────
const SECTION_NUMBER_RE = /^\d+(\.\d+)+(-\d+)?$/;

function stripTags(input: string): string {
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parses one compiled_html part into structured clauses. Handles the nested
 * article layout (part → subpart → section → clause) by slicing each <article>
 * block up to the next <article> start, so an article's own heading and body
 * never bleed into its children.
 */
export function parsePartHtml(htmlText: string, source: FARSource): FARClause[] {
  const out: FARClause[] = [];
  const starts: number[] = [];
  const re = /<article\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(htmlText))) starts.push(m.index);

  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : htmlText.length;
    const block = htmlText.slice(starts[i], end);

    const headingMatch = block.match(/<h[1-6][^>]*class="title[^"]*"[^>]*>([\s\S]*?)<\/h[1-6]>/);
    if (!headingMatch) continue;
    const heading = headingMatch[1];

    const spanMatch = heading.match(/<span class="ph autonumber">([^<]*)<\/span>/);
    if (!spanMatch) continue;
    const number = spanMatch[1].trim();
    if (!SECTION_NUMBER_RE.test(number)) continue; // skips "Part 52", "Subpart 52.2", paragraph (a)/(b)

    const title = stripTags(heading.replace(spanMatch[0], ""));
    const bodyMatch = block.match(/<div class="body conbody[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const fullText = bodyMatch ? stripTags(bodyMatch[1]) : "";

    // Skip empty shells (e.g. "52.212 [Reserved]") — nothing to cite or search.
    if (!fullText) continue;

    const segments = number.split(".");
    const part = segments[0] || null;
    const subpart = segments.length >= 2 ? segments.slice(0, 2).join(".") : part;
    out.push({
      clause_number: number,
      title,
      part,
      subpart,
      section: number,
      full_text: fullText,
      source,
    });
  }
  return out;
}

// ── Table bootstrap ─────────────────────────────────────────────────────────
/** Idempotent CREATE TABLE + indexes for far_clauses. Safe on every request. */
export async function ensureFarClausesTable(): Promise<void> {
  await sql()`CREATE TABLE IF NOT EXISTS far_clauses (
    id SERIAL PRIMARY KEY,
    clause_number TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    part TEXT,
    subpart TEXT,
    section TEXT,
    full_text TEXT NOT NULL,
    source TEXT DEFAULT 'far',
    last_updated TIMESTAMPTZ DEFAULT NOW()
  )`;
  try {
    await sql()`CREATE INDEX IF NOT EXISTS idx_far_clauses_search ON far_clauses USING gin(to_tsvector('english', title || ' ' || full_text))`;
  } catch { /* GIN index is an optimization — full-text search still works without it */ }
  try { await sql()`CREATE INDEX IF NOT EXISTS idx_far_clauses_source ON far_clauses (source)`; } catch {}
  try { await sql()`CREATE INDEX IF NOT EXISTS idx_far_clauses_part ON far_clauses (part)`; } catch {}
}

function mapClause(r: Record<string, unknown>): FARClause {
  return {
    clause_number: String(r.clause_number),
    title: String(r.title ?? ""),
    part: r.part != null ? String(r.part) : null,
    subpart: r.subpart != null ? String(r.subpart) : null,
    section: r.section != null ? String(r.section) : null,
    full_text: String(r.full_text ?? ""),
    source: (r.source === "dfars" ? "dfars" : "far") as FARSource,
    last_updated: r.last_updated != null ? String(r.last_updated) : undefined,
  };
}

// ── Upsert ──────────────────────────────────────────────────────────────────
const UPSERT_CHUNK = 200;

/**
 * Batch upsert via UNNEST — idempotent (ON CONFLICT clause_number DO UPDATE),
 * so re-syncing parts refreshes text without duplicates. Uses one static query
 * with array params; no dynamic SQL.
 */
export async function upsertClauses(clauses: FARClause[]): Promise<number> {
  if (clauses.length === 0) return 0;
  const db = sql();
  for (let i = 0; i < clauses.length; i += UPSERT_CHUNK) {
    const chunk = clauses.slice(i, i + UPSERT_CHUNK);
    const numbers = chunk.map((c) => c.clause_number);
    const titles = chunk.map((c) => c.title);
    const parts = chunk.map((c) => c.part);
    const subparts = chunk.map((c) => c.subpart);
    const sections = chunk.map((c) => c.section);
    const texts = chunk.map((c) => c.full_text);
    const sources = chunk.map((c) => c.source);
    await db`
      INSERT INTO far_clauses (clause_number, title, part, subpart, section, full_text, source)
      SELECT clause_number, title, part, subpart, section, full_text, source
      FROM UNNEST(
        ${numbers}::text[],
        ${titles}::text[],
        ${parts}::text[],
        ${subparts}::text[],
        ${sections}::text[],
        ${texts}::text[],
        ${sources}::text[]
      ) AS t(clause_number, title, part, subpart, section, full_text, source)
      ON CONFLICT (clause_number) DO UPDATE SET
        title = EXCLUDED.title,
        part = EXCLUDED.part,
        subpart = EXCLUDED.subpart,
        section = EXCLUDED.section,
        full_text = EXCLUDED.full_text,
        source = EXCLUDED.source,
        last_updated = NOW()
    `;
  }
  return clauses.length;
}

/**
 * Bootstrap: if the table is empty, load the bundled seed of most-cited
 * clauses (FAR subpart 52.2 + DFARS 252) so search works immediately.
 * Returns true when seeding ran. Never throws.
 */
export async function ensureFarClausesSeeded(): Promise<boolean> {
  try {
    await ensureFarClausesTable();
    const rows = await sql()`SELECT COUNT(*) AS count FROM far_clauses`;
    if (Number(rows[0]?.count ?? 0) > 0) return false;
    await upsertClauses(SEED_CLAUSES);
    return true;
  } catch {
    return false;
  }
}

// ── Fetching ────────────────────────────────────────────────────────────────
async function fetchPartHtml(source: FARSource, part: number): Promise<string> {
  const url = PART_HTML_URL.replace("{source}", source).replace("{part}", String(part));
  const res = await fetch(url, { headers: ACQ_HEADERS, signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/**
 * Full sync: fetch + parse + upsert every FAR/DFARS part (or a subset).
 * Idempotent and concurrency-limited (default 4) to stay polite to the source.
 */
export async function syncFarDfars(
  opts: { sources?: FARSource[]; parts?: number[]; concurrency?: number } = {},
): Promise<FarDfarsSyncResult> {
  await ensureFarClausesTable();
  const sources: FARSource[] = opts.sources?.length ? opts.sources : ["far", "dfars"];
  const concurrency = Math.max(1, Math.min(6, opts.concurrency ?? 4));
  const startTime = Date.now();

  const jobs: { source: FARSource; part: number }[] = [];
  for (const source of sources) {
    const partList = opts.parts?.length
      ? opts.parts
      : source === "far"
        ? FAR_PART_NUMBERS
        : DFARS_PART_NUMBERS;
    for (const part of partList) jobs.push({ source, part });
  }

  let cursor = 0;
  let clausesIndexed = 0;
  let fetchedParts = 0;
  const failedParts: string[] = [];

  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      try {
        const htmlText = await fetchPartHtml(job.source, job.part);
        const clauses = parsePartHtml(htmlText, job.source);
        if (clauses.length > 0) {
          clausesIndexed += await upsertClauses(clauses);
        }
        fetchedParts++;
        console.log(`[sync-far] ${job.source} part ${job.part}: ${clauses.length} clauses`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failedParts.push(`${job.source}:${job.part} (${msg})`);
        console.error(`[sync-far] failed ${job.source} part ${job.part}: ${msg}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // Log to sync_logs (same table as the bid pipeline) so ops has a paper trail.
  try {
    await sql()`
      INSERT INTO sync_logs (source, fetched, new, errors, created_at)
      VALUES ('far_dfars', ${clausesIndexed}, 0, ${failedParts.join("; ") || null}, NOW())
    `;
  } catch { /* logging must never break the sync */ }

  return {
    sources,
    requestedParts: jobs.length,
    fetchedParts,
    failedParts,
    clausesIndexed,
    seeded: false,
    duration: ((Date.now() - startTime) / 1000).toFixed(1),
  };
}

// ── Search API ──────────────────────────────────────────────────────────────
/**
 * Full-text search across clause title + body. Primary path uses the GIN
 * tsvector index; falls back to ILIKE keyword matching when tsquery is
 * unavailable or the index failed to build. Seeds an empty table first.
 */
export async function searchFARClauses(query: string, limit = 5): Promise<FARClause[]> {
  const q = String(query ?? "").trim();
  if (!q) return [];
  await ensureFarClausesSeeded();

  const words = q
    .split(/[^a-zA-Z0-9]+/)
    .filter((w) => w.length >= 2)
    .slice(0, 8);
  if (words.length === 0) return [];

  const cap = Math.max(1, Math.min(20, Number(limit) || 5));
  try {
    const rows = await sql()`
      SELECT clause_number, title, part, subpart, section, full_text, source, last_updated,
             ts_rank(to_tsvector('english', title || ' ' || full_text), plainto_tsquery('english', ${q})) AS rank
      FROM far_clauses
      WHERE to_tsvector('english', title || ' ' || full_text) @@ plainto_tsquery('english', ${q})
      ORDER BY rank DESC, clause_number ASC
      LIMIT ${cap}
    `;
    if (rows.length > 0) return (rows as Record<string, unknown>[]).map(mapClause);
  } catch {
    // Fall through to the ILIKE path below.
  }

  const patterns = words.map((w) => `%${w}%`);
  const rows = await sql()`
    SELECT clause_number, title, part, subpart, section, full_text, source, last_updated
    FROM far_clauses
    WHERE (${patterns}::text[] IS NULL
           OR title ILIKE ANY(${patterns})
           OR full_text ILIKE ANY(${patterns}))
    ORDER BY clause_number ASC
    LIMIT ${cap}
  `;
  return (rows as Record<string, unknown>[]).map(mapClause);
}

/** Exact clause lookup. Accepts "52.212-1", "FAR 52.212-1", "DFARS 252.204-7012". */
export async function getClauseByNumber(number: string): Promise<FARClause | null> {
  const n = String(number ?? "").trim().replace(/^(FAR|DFARS)\s*/i, "").toUpperCase();
  if (!n) return null;
  await ensureFarClausesSeeded();
  try {
    const rows = await sql()`
      SELECT clause_number, title, part, subpart, section, full_text, source, last_updated
      FROM far_clauses
      WHERE clause_number = ${n}
      LIMIT 1`;
    return rows.length > 0 ? mapClause(rows[0] as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Aggregate stats for the admin card. Never throws. */
export async function getFarClauseStats(): Promise<FARClauseStats> {
  try {
    await ensureFarClausesTable();
    const rows = await sql()`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE source = 'far') AS far,
             COUNT(*) FILTER (WHERE source = 'dfars') AS dfars,
             MAX(last_updated) AS last_updated
      FROM far_clauses`;
    const r = rows[0] as Record<string, unknown>;
    return {
      total: Number(r.total ?? 0),
      far: Number(r.far ?? 0),
      dfars: Number(r.dfars ?? 0),
      lastUpdated: r.last_updated != null ? String(r.last_updated) : null,
    };
  } catch {
    return { total: 0, far: 0, dfars: 0, lastUpdated: null };
  }
}

/**
 * RAG block for AI prompts: the most relevant FAR/DFARS clauses for a query,
 * formatted so the model can cite exact clause numbers. Returns "" when nothing
 * relevant is found or the DB is unreachable — never throws.
 */
export async function getRegulatoryContext(query: string, limit = 6): Promise<string> {
  try {
    const clauses = await searchFARClauses(query, limit);
    if (clauses.length === 0) return "";
    const lines = clauses.map((c) => {
      const src = c.source === "dfars" ? "DFARS" : "FAR";
      const snippet =
        c.full_text.length > 600 ? `${c.full_text.slice(0, 600)}…` : c.full_text;
      return `- ${src} ${c.clause_number} — ${c.title}: ${snippet}`;
    });
    return `RELEVANT FAR/DFARS REGULATIONS (cite exact clause numbers, e.g. "per FAR 52.212-1"):\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}
