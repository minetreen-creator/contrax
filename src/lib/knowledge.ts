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
  "guide",
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
    doc_type TEXT NOT NULL CHECK (doc_type IN ('capability_statement', 'proposal_template', 'compliance_checklist', 'solicitation', 'faq', 'guide', 'other')),
    content TEXT NOT NULL,
    description TEXT,
    is_public BOOLEAN NOT NULL DEFAULT false,
    tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  // Keep the type constraint in sync for installations created before guide was added.
  try {
    await sql()`ALTER TABLE knowledge_documents DROP CONSTRAINT IF EXISTS knowledge_documents_doc_type_check`;
    await sql()`ALTER TABLE knowledge_documents ADD CONSTRAINT knowledge_documents_doc_type_check CHECK (doc_type IN ('capability_statement', 'proposal_template', 'compliance_checklist', 'solicitation', 'faq', 'guide', 'other'))`;
  } catch { /* existing data may contain a legacy type; don't block reads */ }
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
      isPublic: Boolean(d.isPublic),
    };
  })
  .handler(async ({ data }): Promise<{ docs: KnowledgeListItem[]; total: number; page: number; pageSize: number; hasMore: boolean }> => {
    const user = await getCurrentUser();
    if (!user && !data.isPublic) throw new Error("Not authenticated");
    await ensureTable();
    const keywords = tokenize(data.query);
    const patterns = likePatterns(keywords);
    const offset = (data.page - 1) * PAGE_SIZE;
    const db = sql();
    const rows = (await db`
      SELECT kd.id, kd.user_id, kd.title, kd.doc_type, kd.content, kd.description, kd.is_public, kd.tags, kd.created_at, kd.updated_at, u.email AS creator_email
      FROM knowledge_documents kd
      LEFT JOIN users u ON u.id = kd.user_id
      WHERE ((${data.isPublic} = true AND kd.is_public = true) OR (${data.isPublic} = false AND (kd.is_public = true OR kd.user_id = ${user?.id ?? -1})))
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
      WHERE ((${data.isPublic} = true AND kd.is_public = true) OR (${data.isPublic} = false AND (kd.is_public = true OR kd.user_id = ${user?.id ?? -1})))
        AND (${data.docType ? data.docType : null}::text IS NULL OR kd.doc_type = ${data.docType ? data.docType : null})
        AND (${patterns.length > 0 ? patterns : null}::text[] IS NULL
             OR kd.title ILIKE ANY(${patterns.length > 0 ? patterns : null})
             OR kd.content ILIKE ANY(${patterns.length > 0 ? patterns : null})
             OR array_to_string(COALESCE(kd.tags, '{}'), ' ') ILIKE ANY(${patterns.length > 0 ? patterns : null}))
    `) as Record<string, unknown>[];
    const total = Number(countRows[0]?.count ?? 0);
    return {
      docs: rows.map((r) => toListItem(r, user?.id ?? -1, keywords)),
      total,
      page: data.page,
      pageSize: PAGE_SIZE,
      hasMore: offset + rows.length < total,
    };
  });

/** Ranked ILIKE search across title, content, and tags with relevance snippets. */
export const searchDocuments = createServerFn({ method: "GET" })
  .validator((data: unknown) => ({
    query: String((data as { query?: unknown })?.query ?? "").trim(),
    isPublic: Boolean((data as { isPublic?: unknown })?.isPublic),
  }))
  .handler(async ({ data }): Promise<{ results: KnowledgeListItem[] }> => {
    const user = await getCurrentUser();
    if (!user && !data.isPublic) throw new Error("Not authenticated");
    const keywords = tokenize(data.query);
    if (keywords.length === 0) return { results: [] };
    await ensureTable();
    const patterns = likePatterns(keywords);
    const rows = (await sql()`
      SELECT kd.id, kd.user_id, kd.title, kd.doc_type, kd.content, kd.description, kd.is_public, kd.tags, kd.created_at, kd.updated_at, u.email AS creator_email
      FROM knowledge_documents kd
      LEFT JOIN users u ON u.id = kd.user_id
      WHERE ((${data.isPublic} = true AND kd.is_public = true) OR (${data.isPublic} = false AND (kd.is_public = true OR kd.user_id = ${user?.id ?? -1})))
        AND (kd.title ILIKE ANY(${patterns}) OR kd.content ILIKE ANY(${patterns}) OR array_to_string(COALESCE(kd.tags, '{}'), ' ') ILIKE ANY(${patterns}))
      LIMIT 100
    `) as Record<string, unknown>[];
    const ranked = rows
      .map((r) => ({ row: r, score: scoreDoc(r, keywords) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    return { results: ranked.map(({ row }) => toListItem(row, user?.id ?? -1, keywords)) };
  });

/** Fetch one document's full content (public docs, or the owner's own). */
export const getDocument = createServerFn({ method: "GET" })
  .validator((data: unknown) => ({ id: Number((data as { id?: unknown })?.id) }))
  .handler(async ({ data }): Promise<KnowledgeDocument> => {
    const user = await getCurrentUser();
    const rows = await sql()`
      SELECT kd.id, kd.user_id, kd.title, kd.doc_type, kd.content, kd.description, kd.is_public, kd.tags, kd.created_at, kd.updated_at, u.email AS creator_email
      FROM knowledge_documents kd
      LEFT JOIN users u ON u.id = kd.user_id
      WHERE kd.id = ${data.id} AND (kd.is_public = true OR kd.user_id = ${user?.id ?? -1})
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

/** Idempotently create the public resources used by the /learn SEO hub. */
export const seedLearnContent = createServerFn({ method: "GET" }).handler(async () => {
  await ensureTable();
  const resources: Array<[string, KnowledgeDocType, string, string, string[]]> = [
    ["How to Write a Capability Statement", "capability_statement", "A practical guide to creating a one-page capability statement that buyers can scan and remember.", `A capability statement is your business's government-contracting resume. Keep it to one page, use your logo and contact details, and lead with a clear core competency statement.\n\nStart with a concise company overview: what you do, where you operate, and the outcomes you deliver. Follow with core capabilities written in buyer language rather than internal jargon. Include differentiators such as years of experience, quality systems, response time, and relevant technology.\n\nPast performance is the proof section. List two to four relevant projects with the customer, contract value or scope, dates, and measurable results. If you are new to federal work, include commercial, state, or nonprofit work that demonstrates the same capability. Add your NAICS codes, UEI, CAGE code, socioeconomic certifications, and bonding or clearance information where relevant.\n\nMake the document useful to a contracting officer: use headings, bullets, and plenty of white space. Save a PDF with a professional filename, check that links work, and update it whenever you win work or add a certification. Never claim experience your team cannot document.`, ["capability statement", "past performance", "small business"]],
    ["Government Contracting 101: A Guide for Small Businesses", "faq", "Understand the federal buying process, from registration through award, in plain language.", `Government contracting is a structured process: an agency identifies a need, publishes a solicitation, evaluates offers under stated criteria, and makes an award. Small businesses can compete successfully by focusing on a narrow set of services and learning the rules before chasing opportunities.\n\nFirst, register in SAM.gov and maintain an active registration. Obtain a Unique Entity ID, select accurate NAICS codes, and complete representations and certifications. Registration is free; beware of companies charging for basic SAM registration.\n\nFind opportunities on SAM.gov using NAICS codes, set-aside status, place of performance, and response deadline. Read the entire solicitation, including attachments and amendments. A proposal usually includes technical approach, past performance, staffing, and price. Follow the page limits, file naming, and submission instructions exactly.\n\nAfter submission, the agency evaluates against the solicitation's factors. Ask questions only through the stated channel and acknowledge every amendment. If you lose, request a debriefing when available. Track what evaluators say and improve the next bid. Start with realistic opportunities, build relationships through legitimate industry days, and protect your cash flow because government payment takes time.`, ["contracting 101", "SAM.gov", "beginner guide"]],
    ["Federal Proposal Template", "proposal_template", "A reusable structure for organizing a compliant, persuasive federal proposal.", `Use this outline as a starting point, then tailor every section to the solicitation's instructions and evaluation factors.\n\n1. Cover letter and table of contents: identify the solicitation, offeror, point of contact, and any required signature.\n\n2. Executive summary: state your understanding of the agency mission, your solution, and the outcomes you will deliver. Keep it specific to this buyer.\n\n3. Technical approach: map each requirement to a method, deliverable, owner, timeline, and quality control. Quote requirement numbers so evaluators can find your answer quickly. Explain assumptions without hiding risks.\n\n4. Management and staffing: show an accountable program manager, organization chart, key personnel qualifications, recruiting plan, and escalation path.\n\n5. Past performance: provide relevant customer, scope, dates, results, and references.\n\n6. Transition and risk: describe the first 30/60/90 days and mitigation for schedule, security, staffing, and supply risks.\n\n7. Price and certifications: use the requested format and reconcile every total. Before delivery, run a compliance matrix against every shall, page limit, font rule, attachment, and amendment. Have an independent reviewer check the final files and submit early enough to resolve portal issues.`, ["proposal", "RFP response", "compliance"]],
    ["SAM.gov Registration Checklist", "compliance_checklist", "A practical checklist for becoming eligible to pursue federal opportunities.", `Complete these steps before submitting a federal offer. Create a Login.gov account with a monitored business email. Gather legal business name, physical and mailing addresses, incorporation details, tax identification number, bank information, and points of contact.\n\nStart or renew the entity registration at SAM.gov. Obtain or verify your Unique Entity ID, enter accurate legal and electronic business points of contact, and select the NAICS codes that genuinely describe your primary services. Complete the size metrics and representations and certifications, including ownership and socioeconomic information. Enter EFT details carefully and authorize the required assertions.\n\nReview exclusions and ensure no required disclosure is missing. Submit the registration and monitor its status; activation can take time. Save the confirmation and calendar the renewal date. Check the registration before each proposal because an inactive record can make an otherwise strong offer ineligible. SAM.gov registration and UEI assignment are free. Treat unsolicited renewal invoices as marketing, not government bills. Keep your profile, contacts, NAICS codes, and certifications current throughout the year.`, ["SAM.gov", "registration", "checklist"]],
    ["Understanding NAICS Codes for Government Contractors", "guide", "Learn how NAICS codes define industries, size standards, and small-business eligibility.", `The North American Industry Classification System (NAICS) code tells the government what economic activity a solicitation covers. Each federal opportunity normally has a primary NAICS code and a corresponding size standard, expressed in employees or average annual receipts. Your business can qualify as small for one code and not another.\n\nChoose codes based on the work you actually perform, not simply the largest market. Read the NAICS definition and size standard, review the solicitation's statement of work, and compare the code with your capabilities and past performance. Maintain a focused list of relevant codes in SAM.gov.\n\nNAICS codes affect set-aside eligibility, market research, filters on SAM.gov, and how buyers find vendors. They do not by themselves prove technical qualification. A strong opportunity review asks: can we meet every requirement, are we small under this exact standard, and can our past performance support the scope? For a joint venture or subcontracting team, check each party's eligibility and the applicable affiliation rules. When a code appears wrong, use the solicitation's question process or file a timely NAICS appeal where permitted.`, ["NAICS", "size standards", "eligibility"]],
    ["WOSB/8(a) Certification Guide", "guide", "A plain-language overview of two federal small-business contracting programs.", `The Women-Owned Small Business (WOSB) Federal Contract Program helps agencies meet goals through eligible women-owned firms, including economically disadvantaged women-owned small businesses (EDWOSB). The 8(a) Business Development Program supports eligible socially and economically disadvantaged small businesses with mentoring, business-development help, and contracting opportunities.\n\nEligibility is specific. A WOSB generally must be at least 51 percent unconditionally owned and controlled by women who are U.S. citizens; EDWOSB adds economic eligibility. The 8(a) program has requirements covering ownership, control, size, good character, potential for success, and personal social and economic disadvantage. Review current SBA rules because requirements and application procedures can change.\n\nUse SBA's official certification portals and keep ownership, tax, financial, and governance records consistent. Certification does not guarantee an award: you still need relevant capabilities, competitive pricing, and a compliant proposal. Put your certification status in SAM.gov, capability statements, and proposal cover pages only when accurate. Track annual reviews, recertification events, joint-venture requirements, and limitations on subcontracting.`, ["WOSB", "8(a)", "SBA certification"]],
  ];
  for (const [title, docType, description, content, tags] of resources) {
    const existing = await sql()`SELECT id FROM knowledge_documents WHERE title = ${title} AND is_public = true LIMIT 1`;
    if (existing.length === 0) await sql()`INSERT INTO knowledge_documents (user_id,title,doc_type,content,description,is_public,tags) VALUES (NULL,${title},${docType},${content},${description},true,${tags})`;
  }
  return { seeded: resources.length };
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
