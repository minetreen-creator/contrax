/**
 * Knowledge Base — searchable document library + RAG retrieval.
 *
 * Users upload capability statements, proposal templates, compliance checklists,
 * solicitations, FAQs, and other documents. The AI (scoreBid, generateProposal,
 * scoreSolicitation) pulls the most relevant excerpts back via getRelevantContext
 * and injects them into prompts as a "RELEVANT KNOWLEDGE BASE:" block.
 *
 * MVP retrieval is ILIKE full-text search with lightweight keyword ranking —
 * no vector search required. If pgvector becomes available on the database the
 * `embedding VECTOR(1536)` column is added lazily (see schema.sql) for future use.
 */
import { createServerFn } from "@tanstack/react-start";
import { getCurrentUser } from "~/lib/auth";
import { sql } from "~/db";

// ── Types ─────────────────────────────────────────────────────────────────────
export const KNOWLEDGE_DOC_TYPES = [
  "capability_statement",
  "proposal_template",
  "compliance_checklist",
  "solicitation",
  "faq",
  "other",
] as const;
export type KnowledgeDocType = (typeof KNOWLEDGE_DOC_TYPES)[number];

export interface KnowledgeDocument {
  id: number;
  user_id: number;
  title: string;
  doc_type: KnowledgeDocType;
  content: string;
  description: string | null;
  is_public: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
  creator_email?: string | null;
}

/** Card-level view: content is replaced by a short preview snippet. */
export interface KnowledgeListItem {
  id: number;
  title: string;
  doc_type: KnowledgeDocType;
  preview: string;
  description: string | null;
  is_public: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
  creator_email?: string | null;
  is_owner: boolean;
}

const PAGE_SIZE = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────
/** Idempotent table + index bootstrap. Safe to call on every request. */
async function ensureTable() {
  await sql()`CREATE TABLE IF NOT EXISTS knowledge_documents (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    title TEXT NOT NULL,
    doc_type TEXT NOT NULL CHECK (doc_type IN ('capability_statement', 'proposal_template', 'compliance_checklist', 'solicitation', 'faq', 'other')),
    content TEXT NOT NULL,
    description TEXT,
    is_public BOOLEAN NOT NULL DEFAULT false,
    tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  try { await sql()`CREATE INDEX IF NOT EXISTS idx_knowledge_content ON knowledge_documents USING GIN (to_tsvector('english', content))`; } catch { /* GIN index is an optimization — ignore if unavailable */ }
  try { await sql()`CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge_documents (doc_type)`; } catch {}
  // pgvector is optional — try to enable it, but never fail if unavailable.
  try { await sql()`CREATE EXTENSION IF NOT EXISTS vector`; } catch {}
  try { await sql()`ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS embedding VECTOR(1536)`; } catch {}
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "your", "are", "you",
  "will", "our", "has", "have", "was", "not", "all", "per", "its", "who",
  "what", "when", "how", "why", "can", "any", "but", "than", "they", "them",
  "been", "were", "into", "over", "also", "out", "one", "two", "may",
]);

/** Splits a query into deduplicated lowercase keywords (>= 3 chars, no stopwords). */
function tokenize(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
    ),
  ];
}

/** Builds a context window around the first keyword hit, or the doc start. */
function makeSnippet(content: string, keywords: string[], maxLen = 300): string {
  const lower = content.toLowerCase();
  let idx = -1;
  for (const kw of keywords) {
    const i = lower.indexOf(kw);
    if (i !== -1) { idx = i; break; }
  }
  if (idx === -1) idx = 0;
  const start = Math.max(0, idx - 100);
  const end = Math.min(content.length, start + maxLen);
  let snippet = content.slice(start, end);
  if (start > 0) snippet = "…" + snippet;
  if (end < content.length) snippet = snippet + "…";
  return snippet.trim();
}

/** Keyword-hit scoring: title hits count 3x, tags 2x, content counts occurrences. */
function scoreDoc(row: Record<string, unknown>, keywords: string[]): number {
  const title = String(row.title ?? "").toLowerCase();
  const tags = (Array.isArray(row.tags) ? (row.tags as string[]).join(" ") : "").toLowerCase();
  const content = String(row.content ?? "").toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (title.includes(kw)) score += 3;
    if (tags.includes(kw)) score += 2;
    const occurrences = content.split(kw).length - 1;
    if (occurrences > 0) score += Math.min(occurrences, 5);
  }
  return score;
}

/** ILIKE patterns array for a set of keywords (used with `ILIKE ANY($n)`). */
function likePatterns(keywords: string[]): string[] {
  return keywords.map((k) => `%${k}%`);
}

function mapDoc(r: Record<string, unknown>): KnowledgeDocument {
  return {
    id: Number(r.id),
    user_id: Number(r.user_id),
    title: String(r.title),
    doc_type: r.doc_type as KnowledgeDocType,
    content: String(r.content ?? ""),
    description: r.description != null ? String(r.description) : null,
    is_public: Boolean(r.is_public),
    tags: Array.isArray(r.tags) ? (r.tags as string[]).map(String) : [],
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    creator_email: r.creator_email != null ? String(r.creator_email) : null,
  };
}

function toListItem(r: Record<string, unknown>, userId: number, keywords: string[]): KnowledgeListItem {
  return {
    id: Number(r.id),
    title: String(r.title),
    doc_type: r.doc_type as KnowledgeDocType,
    preview: makeSnippet(String(r.content ?? ""), keywords, 300),
    description: r.description != null ? String(r.description) : null,
    is_public: Boolean(r.is_public),
    tags: Array.isArray(r.tags) ? (r.tags as string[]).map(String) : [],
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    creator_email: r.creator_email != null ? String(r.creator_email) : null,
    is_owner: Number(r.user_id) === userId,
  };
}

// ── Server Functions ──────────────────────────────────────────────────────────
/** Upload a new document (logged-in users only). Content truncated to 50K chars. */
export const uploadDocument = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = (data ?? {}) as Record<string, unknown>;
    const title = String(d.title ?? "").trim().slice(0, 200);
    if (!title) throw new Error("Title is required");
    const docType = String(d.doc_type ?? "");
    if (!(KNOWLEDGE_DOC_TYPES as readonly string[]).includes(docType)) throw new Error("Invalid document type");
    const content = String(d.content ?? "").trim().slice(0, 50000);
    if (!content) throw new Error("Document content is required");
    const description = String(d.description ?? "").trim().slice(0, 1000) || null;
    const tags = Array.isArray(d.tags)
      ? (d.tags as unknown[]).map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 20)
      : [];
    const isPublic = Boolean(d.is_public);
    return { title, docType: docType as KnowledgeDocType, content, description, tags, isPublic };
  })
  .handler(async ({ data }): Promise<KnowledgeDocument> => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");
    await ensureTable();
    const rows = await sql()`
      INSERT INTO knowledge_documents (user_id, title, doc_type, content, description, is_public, tags, updated_at)
      VALUES (${user.id}, ${data.title}, ${data.docType}, ${data.content}, ${data.description}, ${data.isPublic}, ${data.tags}, NOW())
      RETURNING id, user_id, title, doc_type, content, description, is_public, tags, created_at, updated_at`;
    return mapDoc(rows[0] as Record<string, unknown>);
  });

/**
 * Browse the library: public docs + the user's own, filtered by type and/or
 * search query, paginated (20 per page). Cards get a preview snippet, not the
 * full content — call getDocument for the full text.
 */
export const listDocuments = createServerFn({ method: "GET" })
  .validator((data: unknown) => {
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      docType: String(d.docType ?? ""),
      query: String(d.query ?? "").trim(),
      page: Math.max(1, Math.floor(Number(d.page) || 1)),
    };
  })
  .handler(async ({ data }): Promise<{ docs: KnowledgeListItem[]; total: number; page: number; pageSize: number; hasMore: boolean }> => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");
    await ensureTable();
    const keywords = tokenize(data.query);
    const patterns = likePatterns(keywords);
    const offset = (data.page - 1) * PAGE_SIZE;
    const db = sql();
    const rows = (await db`
      SELECT kd.id, kd.user_id, kd.title, kd.doc_type, kd.content, kd.description, kd.is_public, kd.tags, kd.created_at, kd.updated_at, u.email AS creator_email
      FROM knowledge_documents kd
      LEFT JOIN users u ON u.id = kd.user_id
      WHERE (kd.is_public = true OR kd.user_id = ${user.id})
        AND (${data.docType ? data.docType : null}::text IS NULL OR kd.doc_type = ${data.docType ? data.docType : null})
        AND (${patterns.length > 0 ? patterns : null}::text[] IS NULL
             OR kd.title ILIKE ANY(${patterns.length > 0 ? patterns : null})
             OR kd.content ILIKE ANY(${patterns.length > 0 ? patterns : null})
             OR array_to_string(COALESCE(kd.tags, '{}'), ' ') ILIKE ANY(${patterns.length > 0 ? patterns : null}))
      ORDER BY kd.updated_at DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `) as Record<string, unknown>[];
    const countRows = (await db`
      SELECT COUNT(*) AS count
      FROM knowledge_documents kd
      WHERE (kd.is_public = true OR kd.user_id = ${user.id})
        AND (${data.docType ? data.docType : null}::text IS NULL OR kd.doc_type = ${data.docType ? data.docType : null})
        AND (${patterns.length > 0 ? patterns : null}::text[] IS NULL
             OR kd.title ILIKE ANY(${patterns.length > 0 ? patterns : null})
             OR kd.content ILIKE ANY(${patterns.length > 0 ? patterns : null})
             OR array_to_string(COALESCE(kd.tags, '{}'), ' ') ILIKE ANY(${patterns.length > 0 ? patterns : null}))
    `) as Record<string, unknown>[];
    const total = Number(countRows[0]?.count ?? 0);
    return {
      docs: rows.map((r) => toListItem(r, user.id, keywords)),
      total,
      page: data.page,
      pageSize: PAGE_SIZE,
      hasMore: offset + rows.length < total,
    };
  });

/** Ranked ILIKE search across title, content, and tags with relevance snippets. */
export const searchDocuments = createServerFn({ method: "GET" })
  .validator((data: unknown) => ({ query: String((data as { query?: unknown })?.query ?? "").trim() }))
  .handler(async ({ data }): Promise<{ results: KnowledgeListItem[] }> => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");
    const keywords = tokenize(data.query);
    if (keywords.length === 0) return { results: [] };
    await ensureTable();
    const patterns = likePatterns(keywords);
    const rows = (await sql()`
      SELECT kd.id, kd.user_id, kd.title, kd.doc_type, kd.content, kd.description, kd.is_public, kd.tags, kd.created_at, kd.updated_at, u.email AS creator_email
      FROM knowledge_documents kd
      LEFT JOIN users u ON u.id = kd.user_id
      WHERE (kd.is_public = true OR kd.user_id = ${user.id})
        AND (kd.title ILIKE ANY(${patterns}) OR kd.content ILIKE ANY(${patterns}) OR array_to_string(COALESCE(kd.tags, '{}'), ' ') ILIKE ANY(${patterns}))
      LIMIT 100
    `) as Record<string, unknown>[];
    const ranked = rows
      .map((r) => ({ row: r, score: scoreDoc(r, keywords) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    return { results: ranked.map(({ row }) => toListItem(row, user.id, keywords)) };
  });

/** Fetch one document's full content (public docs, or the owner's own). */
export const getDocument = createServerFn({ method: "GET" })
  .validator((data: unknown) => ({ id: Number((data as { id?: unknown })?.id) }))
  .handler(async ({ data }): Promise<KnowledgeDocument> => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");
    const rows = await sql()`
      SELECT kd.id, kd.user_id, kd.title, kd.doc_type, kd.content, kd.description, kd.is_public, kd.tags, kd.created_at, kd.updated_at, u.email AS creator_email
      FROM knowledge_documents kd
      LEFT JOIN users u ON u.id = kd.user_id
      WHERE kd.id = ${data.id} AND (kd.is_public = true OR kd.user_id = ${user.id})
      LIMIT 1`;
    if (rows.length === 0) throw new Error("Document not found");
    return mapDoc(rows[0] as Record<string, unknown>);
  });

/** Owner-only deletion. */
export const deleteDocument = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ id: Number((data as { id?: unknown })?.id) }))
  .handler(async ({ data }): Promise<{ success: boolean }> => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");
    const rows = await sql()`DELETE FROM knowledge_documents WHERE id = ${data.id} AND user_id = ${user.id} RETURNING id`;
    if (rows.length === 0) throw new Error("Document not found or you don't have permission to delete it");
    return { success: true };
  });

// ── RAG Retrieval ─────────────────────────────────────────────────────────────
/**
 * Given a query (e.g. a bid title + description), returns the top 3-5 most
 * relevant document excerpts formatted as a "RELEVANT KNOWLEDGE BASE:" block
 * for injection into AI prompts. Returns "" when nothing relevant is found.
 *
 * Deliberately defensive: a knowledge-base failure must never break scoring or
 * proposal generation, so every failure path returns an empty string.
 */
export async function getRelevantContext(query: string, limit = 5): Promise<string> {
  try {
    const keywords = tokenize(query);
    if (keywords.length === 0) return "";
    await ensureTable();
    const user = await getCurrentUser();
    const patterns = likePatterns(keywords);
    const db = sql();
    let rows: Record<string, unknown>[];
    if (user) {
      rows = (await db`
        SELECT kd.id, kd.title, kd.doc_type, kd.content, kd.tags
        FROM knowledge_documents kd
        WHERE (kd.is_public = true OR kd.user_id = ${user.id})
          AND (kd.title ILIKE ANY(${patterns}) OR kd.content ILIKE ANY(${patterns}) OR array_to_string(COALESCE(kd.tags, '{}'), ' ') ILIKE ANY(${patterns}))
        LIMIT 40`) as Record<string, unknown>[];
    } else {
      rows = (await db`
        SELECT kd.id, kd.title, kd.doc_type, kd.content, kd.tags
        FROM knowledge_documents kd
        WHERE kd.is_public = true
          AND (kd.title ILIKE ANY(${patterns}) OR kd.content ILIKE ANY(${patterns}) OR array_to_string(COALESCE(kd.tags, '{}'), ' ') ILIKE ANY(${patterns}))
        LIMIT 40`) as Record<string, unknown>[];
    }
    const scored = rows
      .map((r) => ({ row: r, score: scoreDoc(r, keywords) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    if (scored.length === 0) return "";
    const blocks = scored.map(({ row }) => {
      const type = String(row.doc_type).replace(/_/g, " ");
      const excerpt = makeSnippet(String(row.content ?? ""), keywords, 1000);
      return `- [${row.title}] (${type}): ${excerpt}`;
    });
    return `RELEVANT KNOWLEDGE BASE:\n${blocks.join("\n")}`;
  } catch {
    return ""; // never break the calling AI feature
  }
}
