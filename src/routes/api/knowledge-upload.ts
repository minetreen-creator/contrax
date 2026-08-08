import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import {
  ensureTable,
  saveEmbedding,
  KNOWLEDGE_DOC_TYPES,
  type KnowledgeDocType,
  mapDoc,
} from "~/lib/knowledge";

/** Upload a new document (logged-in users only). Content truncated to 50K chars. */
async function handler({ request }: { request: Request }): Promise<Response> {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const d = body ?? {};
  const title = String(d.title ?? "").trim().slice(0, 200);
  if (!title) return Response.json({ error: "Title is required" }, { status: 400 });
  const docType = String(d.doc_type ?? "");
  if (!(KNOWLEDGE_DOC_TYPES as readonly string[]).includes(docType)) {
    return Response.json({ error: "Invalid document type" }, { status: 400 });
  }
  const content = String(d.content ?? "").trim().slice(0, 50000);
  if (!content) return Response.json({ error: "Document content is required" }, { status: 400 });
  const description = String(d.description ?? "").trim().slice(0, 1000) || null;
  const tags = Array.isArray(d.tags)
    ? (d.tags as unknown[]).map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 20)
    : [];
  const isPublic = Boolean(d.is_public);

  await ensureTable();
  const rows = await sql()`
    INSERT INTO knowledge_documents (user_id, title, doc_type, content, description, is_public, tags, updated_at)
    VALUES (${user.id}, ${title}, ${docType}, ${content}, ${description}, ${isPublic}, ${tags}, NOW())
    RETURNING id, user_id, title, doc_type, content, description, is_public, tags, created_at, updated_at`;
  const doc = mapDoc(rows[0] as Record<string, unknown>);
  // Embedding generation should not delay a successful document save.
  void saveEmbedding(Number(doc.id), doc.content).catch(() => {});
  return Response.json(doc);
}

export const Route = createFileRoute("/api/knowledge-upload")({
  server: { handlers: { POST: handler } },
});
