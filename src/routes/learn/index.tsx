import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { listDocuments, searchDocuments, getDocument, seedLearnContent, type KnowledgeListItem, type KnowledgeDocument } from "~/lib/knowledge";
import { CERT_GUIDES } from "~/components/CertGuideLayout";

const TITLE = "Free Government Contracting Resources & Guides | Contrax";
const DESC = "Free government contracting guides for small businesses — including 8(a), WOSB/EDWOSB, SDVOSB, and HUBZone certification guides, proposal templates, capability statement examples, compliance checklists, and more.";
const filters = [
  ["", "All resources"], ["capability_statement", "Capability Statements"], ["proposal_template", "Proposal Templates"],
  ["compliance_checklist", "Compliance Checklists"], ["solicitation", "Solicitations"], ["faq", "FAQs"], ["guide", "Guides"],
] as const;

export const Route = createFileRoute("/learn/")({
  head: () => ({
    meta: [
      { title: TITLE }, { name: "description", content: DESC }, { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" }, { property: "og:url", content: "https://contrax.company/learn" },
      { property: "og:title", content: TITLE }, { property: "og:description", content: DESC },
      { property: "og:image", content: "https://contrax.company/logo-square.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" }, { property: "og:site_name", content: "Contrax" },
      { name: "twitter:card", content: "summary_large_image" }, { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC }, { name: "twitter:image", content: "https://contrax.company/logo-square.png" },
    ], links: [{ rel: "canonical", href: "https://contrax.company/learn" }],
  }),
  loader: async () => {
    try { await seedLearnContent(); } catch {}
    try { return listDocuments({ data: { isPublic: true, page: 1, query: "", docType: "" } }); }
    catch { return { docs: [], total: 0, hasMore: false }; }
  },
  component: LearnPage,
});

function LearnPage() {
  const initial = Route.useLoaderData() as { docs: KnowledgeListItem[]; total: number; hasMore: boolean } | null;
  const [docs, setDocs] = useState<KnowledgeListItem[]>((initial?.docs ?? []).filter(Boolean));
  const [active, setActive] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<KnowledgeDocument | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDocs((initial?.docs ?? []).filter(Boolean)); }, [initial?.docs]);
  async function refresh(type = active, q = query) {
    setBusy(true);
    try {
      if (q.trim()) setDocs((await searchDocuments({ data: { query: q, isPublic: true } })).results.filter(d => !type || d.doc_type === type));
      else setDocs((await listDocuments({ data: { isPublic: true, page: 1, query: "", docType: type } })).docs);
    } finally { setBusy(false); }
  }
  return <main className="min-h-screen bg-slate-50">
    <section className="bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 px-6 py-20 text-center text-white">
      <p className="text-sm font-semibold uppercase tracking-[.2em] text-amber-400">The Contrax Resource Hub</p>
      <h1 className="mx-auto mt-4 max-w-4xl text-4xl font-extrabold tracking-tight sm:text-6xl">Government Contracting Resources</h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-blue-100">Free, practical guides and templates to help small businesses register, find opportunities, and submit stronger federal proposals.</p>
    </section>
    <section className="bg-white py-14">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-amber-600">Certification guides</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Get certified, then win set-asides</h2>
            <p className="mt-3 max-w-2xl text-gray-600">8(a), WOSB/EDWOSB, SDVOSB, and HUBZone certifications unlock billions in federal set-aside contracts — but only if you qualify, certify, and bid. Start with the guide for your business.</p>
          </div>
          <a href="/learn/8a-certification-guide" className="shrink-0 rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-amber-400 hover:text-amber-700">Browse all guides →</a>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {CERT_GUIDES.map(g => <a key={g.href} href={g.href} className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-amber-300 hover:shadow-lg">
            <span className="self-start rounded-full bg-amber-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-700">{g.badge}</span>
            <h3 className="mt-4 text-lg font-bold leading-snug text-slate-900 group-hover:text-blue-700">{g.title}</h3>
            <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-600">{g.blurb}</p>
            <span className="mt-5 text-sm font-semibold text-blue-600 group-hover:text-blue-800">Read the guide →</span>
          </a>)}
        </div>
      </div>
    </section>
    <section className="mx-auto max-w-7xl px-6 py-12">
      <h2 className="sr-only">Browse resources</h2>
      <div className="flex flex-col gap-4 sm:flex-row"><label className="flex-1"><span className="sr-only">Search resources</span><input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && refresh()} placeholder="Search guides, templates, NAICS, SAM.gov…" className="w-full rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label><button onClick={() => refresh()} className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700">Search</button></div>
      <div className="mt-8 flex flex-wrap gap-2" role="tablist">{filters.map(([value, label]) => <button key={value} onClick={() => { setActive(value); refresh(value); }} className={`rounded-full px-4 py-2 text-sm font-medium ${active === value ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-blue-300"}`} role="tab" aria-selected={active === value}>{label}</button>)}</div>
      <h2 className="mt-12 text-2xl font-bold text-slate-900">Free guides and tools</h2>
      {busy ? <p className="py-16 text-center text-slate-500">Loading resources…</p> : <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">{docs.map(doc => <article key={doc.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg"><div className="flex items-center justify-between gap-3"><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-blue-700">{(doc.doc_type || "").replace(/_/g, " ")}</span>{doc.created_at ? <time className="text-xs text-slate-400" dateTime={doc.created_at}>{new Date(doc.created_at).toLocaleDateString()}</time> : null}</div><h3 className="mt-4 text-xl font-bold text-slate-900">{doc.title}</h3><p className="mt-3 line-clamp-3 text-sm leading-relaxed text-slate-600">{doc.description || doc.preview || ""}</p><div className="mt-4 flex flex-wrap gap-1.5">{(doc.tags || []).map(tag => <span key={tag} className="text-xs text-slate-500">#{tag}</span>)}</div><button onClick={async () => setSelected(await getDocument({ data: { id: doc.id } }))} className="mt-6 text-left text-sm font-semibold text-blue-600 hover:text-blue-800">Read resource →</button></article>)}</div>}
      {!busy && docs.length === 0 && <p className="py-16 text-center text-slate-500">No resources match that search.</p>}
    </section>
    {selected && <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-950/60 p-4" onClick={() => setSelected(null)}><article className="mx-auto my-10 max-w-3xl rounded-2xl bg-white p-7 shadow-2xl sm:p-10" onClick={e => e.stopPropagation()}><div className="flex justify-between gap-4"><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold uppercase text-blue-700">{(selected.doc_type || "").replace(/_/g, " ")}</span><button onClick={() => setSelected(null)} aria-label="Close">✕</button></div><h2 className="mt-5 text-3xl font-bold text-slate-900">{selected.title || ""}</h2><p className="mt-2 text-slate-600">{selected.description || ""}</p><div className="mt-8 whitespace-pre-line text-base leading-8 text-slate-700">{selected.content || ""}</div></article></div>}
  </main>;
}
