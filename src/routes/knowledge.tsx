import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  deleteDocument,
  getDocument,
  listDocuments,
  uploadDocument,
  type KnowledgeDocType,
  type KnowledgeDocument,
  type KnowledgeListItem,
} from "~/lib/knowledge";
import { getCurrentUser, type AuthUser } from "~/lib/auth";

// ── Type display helpers ────────────────────────────────────────────────────
const TYPE_META: Record<KnowledgeDocType, { label: string; badge: string }> = {
  capability_statement: { label: "Capability Statement", badge: "bg-blue-100 text-blue-700" },
  proposal_template: { label: "Proposal", badge: "bg-green-100 text-green-700" },
  compliance_checklist: { label: "Checklist", badge: "bg-purple-100 text-purple-700" },
  solicitation: { label: "Solicitation", badge: "bg-amber-100 text-amber-700" },
  faq: { label: "FAQ", badge: "bg-cyan-100 text-cyan-700" },
  other: { label: "Other", badge: "bg-slate-100 text-slate-600" },
};

const TABS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Capability Statements", value: "capability_statement" },
  { label: "Proposals", value: "proposal_template" },
  { label: "Checklists", value: "compliance_checklist" },
  { label: "Solicitations", value: "solicitation" },
  { label: "FAQs", value: "faq" },
];

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Route ────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/knowledge")({
  loader: async (): Promise<AuthUser> => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    return user;
  },
  component: KnowledgePage,
  head: () => ({
    meta: [
      { title: "Knowledge Base | Contrax" },
      { name: "description", content: "Store capability statements, proposal templates, compliance checklists, and FAQs. The AI uses your knowledge base to write smarter proposals and score bids." },
      { name: "robots", content: "noindex, nofollow" },
      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://contrax.company/knowledge" },
      { property: "og:title", content: "Knowledge Base | Contrax" },
      { property: "og:description", content: "Store capability statements, proposal templates, compliance checklists, and FAQs. The AI uses your knowledge base to write smarter proposals and score bids." },
      { property: "og:image", content: "https://contrax.company/og-image.svg" },
      { property: "og:image:type", content: "image/svg+xml" },
      { property: "og:image:alt", content: "Contrax — AI-powered government contract bidding platform" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Knowledge Base | Contrax" },
      { name: "twitter:description", content: "Store capability statements, proposal templates, compliance checklists, and FAQs. The AI uses your knowledge base to write smarter proposals and score bids." },
      { name: "twitter:image", content: "https://contrax.company/og-image.svg" },
      { name: "twitter:image:alt", content: "Contrax — AI-powered government contract bidding platform" },
    ],
    links: [{ rel: "canonical", href: "https://contrax.company/knowledge" }],
  }),
});

// ── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl">
      <span className="text-green-400">✓</span>
      <span>{message}</span>
      <button onClick={onClose} className="ml-2 text-slate-400 hover:text-white" aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

// ── Upload Modal ─────────────────────────────────────────────────────────────
function UploadModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: (doc: KnowledgeDocument) => void }) {
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<KnowledgeDocType>("capability_statement");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const doc = await uploadDocument({
        data: {
          title,
          doc_type: docType,
          description,
          content,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          is_public: isPublic,
        },
      });
      onUploaded(doc);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="mt-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-900">Upload document</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Documents are searchable instantly and the AI pulls relevant excerpts into your proposals and bid scores.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-slate-700">Title *</label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Acme Construction Capability Statement"
              className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Type *</label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value as KnowledgeDocType)}
              className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
            >
              <option value="capability_statement">Capability Statement</option>
              <option value="proposal_template">Proposal Template</option>
              <option value="compliance_checklist">Compliance Checklist</option>
              <option value="solicitation">Solicitation</option>
              <option value="faq">FAQ</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Tags</label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="janitorial, VA, NAICS 561720"
              className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
            />
            <p className="mt-1 text-xs text-slate-400">Comma-separated — makes documents easier to find.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-slate-700">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short summary shown on the card (optional)"
              className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-slate-700">Content *</label>
            <textarea
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              placeholder="Paste the full document text here..."
              className="mt-1 w-full rounded-xl border border-slate-300 p-3 font-mono text-xs leading-relaxed outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
            />
            <p className="mt-1 text-xs text-slate-400">Up to 50,000 characters.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500" />
            Share with all Contrax users
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button disabled={busy} className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50">
            {busy ? "Uploading…" : "Upload document"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Detail Modal ─────────────────────────────────────────────────────────────
function DetailModal({ docId, onClose }: { docId: number; onClose: () => void }) {
  const [doc, setDoc] = useState<KnowledgeDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getDocument({ data: { id: docId } })
      .then((d) => { if (!cancelled) setDoc(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load document"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [docId]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="mt-8 w-full max-w-3xl rounded-2xl bg-white shadow-2xl">
        {loading ? (
          <div className="flex items-center justify-center p-16 text-slate-400">
            <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-amber-500" />
            Loading document…
          </div>
        ) : error ? (
          <div className="p-10 text-center text-sm text-red-600">{error}</div>
        ) : doc ? (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-6">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TYPE_META[doc.doc_type].badge}`}>
                    {TYPE_META[doc.doc_type].label}
                  </span>
                  {doc.is_public && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">Public</span>}
                  {doc.tags.map((t) => (
                    <span key={t} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">#{t}</span>
                  ))}
                </div>
                <h2 className="mt-3 text-xl font-bold text-slate-900">{doc.title}</h2>
                <p className="mt-1 text-xs text-slate-400">
                  {doc.creator_email ?? "You"} · Added {fmtDate(doc.created_at)}
                </p>
              </div>
              <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
                ✕
              </button>
            </div>
            {doc.description && <p className="px-6 pt-4 text-sm text-slate-600">{doc.description}</p>}
            <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap p-6 pt-4 font-mono text-xs leading-relaxed text-slate-700">
              {doc.content}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
function KnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [docType, setDocType] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState("");

  const pageSize = 20;

  const load = async (type: string, q: string, p: number, silent = false) => {
    if (!silent) setLoading(true);
    setLoadError("");
    try {
      const res = await listDocuments({ data: { docType: type, query: q, page: p } });
      setDocs(res.docs);
      setTotal(res.total);
      setPage(res.page);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  };

  // Debounced search on query changes; immediate reload on tab/page changes.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearch = (value: string) => {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(docType, value, 1), 350);
  };
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  const switchTab = (value: string) => {
    setDocType(value);
    load(value, query, 1);
  };

  const handleDelete = async () => {
    if (deleteId === null) return;
    setDeleting(true);
    try {
      await deleteDocument({ data: { id: deleteId } });
      setDocs((d) => d.filter((x) => x.id !== deleteId));
      setTotal((t) => Math.max(0, t - 1));
      setDeleteId(null);
      setToast("Document deleted");
      setTimeout(() => setToast(""), 3000);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a href="/dashboard" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-amber-400">✦</span>
            <b className="text-lg text-slate-900">Contrax</b>
          </a>
          <div className="flex items-center gap-4 text-sm">
            <a href="/dashboard" className="text-slate-500 hover:text-slate-900">Dashboard</a>
            <a href="/score" className="text-slate-500 hover:text-slate-900">🎯 Score</a>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">📚 Knowledge Base</h1>
            <p className="mt-2 max-w-xl text-slate-500">
              Store capability statements, proposal templates, compliance checklists, and FAQs. The AI pulls relevant
              excerpts from here to write sharper proposals and score bids more accurately.
            </p>
          </div>
          <button
            onClick={() => setShowUpload(true)}
            className="shrink-0 rounded-xl bg-amber-500 px-5 py-2.5 font-semibold text-slate-900 hover:bg-amber-400"
          >
            + Upload document
          </button>
        </div>

        {/* Search */}
        <div className="mt-6">
          <input
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search titles, content, and tags…"
            className="w-full rounded-xl border border-slate-300 bg-white p-3.5 pl-10 text-sm shadow-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
            style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%2394a3b8'%3E%3Cpath fill-rule='evenodd' d='M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z' clip-rule='evenodd'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "12px center", backgroundSize: "18px" }}
          />
        </div>

        {/* Tabs */}
        <div className="mt-4 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => switchTab(t.value)}
              className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
                docType === t.value ? "bg-slate-900 text-white" : "bg-white text-slate-500 shadow-sm hover:bg-slate-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <p className="mt-4 text-sm text-slate-400">{total} document{total === 1 ? "" : "s"}</p>

        {loadError && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">{loadError}</p>}

        {/* Loading */}
        {loading && (
          <div className="mt-8 flex items-center justify-center py-16 text-slate-400">
            <span className="mr-2 inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-amber-500" />
            Loading documents…
          </div>
        )}

        {/* Grid */}
        {!loading && !loadError && docs.length === 0 && (
          <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-14 text-center">
            <p className="text-4xl">📄</p>
            <p className="mt-3 font-semibold text-slate-700">
              {query || docType ? "No documents match your search" : "Your knowledge base is empty"}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {query || docType
                ? "Try a different search or filter."
                : "Upload your first capability statement or proposal template to give the AI better context."}
            </p>
            {!query && !docType && (
              <button onClick={() => setShowUpload(true)} className="mt-5 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-amber-400">
                + Upload your first document
              </button>
            )}
          </div>
        )}

        {/* Cards */}
        {!loading && docs.length > 0 && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {docs.map((doc) => (
              <div key={doc.id} className="group flex flex-col rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
                <div className="flex items-center justify-between gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TYPE_META[doc.doc_type].badge}`}>
                    {TYPE_META[doc.doc_type].label}
                  </span>
                  <div className="flex items-center gap-1">
                    {doc.is_public && <span title="Shared with all Contrax users" className="text-xs text-emerald-600">🌐</span>}
                    {doc.is_owner && (
                      <button
                        onClick={() => setDeleteId(doc.id)}
                        className="rounded-md p-1 text-slate-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                        title="Delete document"
                        aria-label={`Delete ${doc.title}`}
                      >
                        🗑
                      </button>
                    )}
                  </div>
                </div>
                <button onClick={() => setDetailId(doc.id)} className="mt-3 text-left">
                  <h3 className="font-bold text-slate-900 hover:text-amber-600">{doc.title}</h3>
                  {doc.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{doc.description}</p>}
                  <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-500">{doc.preview}</p>
                </button>
                {doc.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {doc.tags.slice(0, 4).map((t) => (
                      <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">#{t}</span>
                    ))}
                    {doc.tags.length > 4 && <span className="text-xs text-slate-400">+{doc.tags.length - 4}</span>}
                  </div>
                )}
                <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
                  {doc.creator_email ?? "You"} · {fmtDate(doc.created_at)}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {!loading && total > pageSize && (
          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              disabled={page <= 1}
              onClick={() => load(docType, query, page - 1, true)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="text-sm text-slate-500">
              Page {page} of {Math.ceil(total / pageSize)}
            </span>
            <button
              disabled={page >= Math.ceil(total / pageSize)}
              onClick={() => load(docType, query, page + 1, true)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}
      </main>

      {/* Modals */}
      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onUploaded={(doc) => {
            setShowUpload(false);
            setToast(`"${doc.title}" uploaded — the AI can now use it`);
            setTimeout(() => setToast(""), 4000);
            load(docType, query, 1, true);
          }}
        />
      )}
      {detailId !== null && (
        <DetailModal docId={detailId} onClose={() => setDetailId(null)} />
      )}
      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">Delete document?</h3>
            <p className="mt-2 text-sm text-slate-500">
              This permanently removes the document from your knowledge base and the AI will no longer use it.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setDeleteId(null)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
    </div>
  );
}
