import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { checklistBySlug, checklistHtml } from "~/lib/bid-checklists";
import { seoHead } from "~/lib/seo-landing";
import { trackEvent } from "~/lib/track";

// /checklists/{slug} — one printable, downloadable bid checklist (owner 2026-11-08).
export const Route = createFileRoute("/checklists_/$slug")({
  loader: ({ params }) => ({ checklist: checklistBySlug(params.slug) }),
  head: ({ loaderData }) => {
    const c = loaderData?.checklist;
    const head = seoHead({
      title: c ? `${c.title} (Printable) | Contrax` : "Bid Checklists | Contrax",
      description: c
        ? `${c.blurb} A one-page checklist of what to read, gather, price and submit. Print it or download it.`
        : "One-page bid checklists for small contractors.",
      canonical: c ? `https://www.contrax.company/checklists/${c.slug}` : "https://www.contrax.company/checklists",
    });
    if (!c) head.meta = head.meta.map((m) => ("name" in m && m.name === "robots" ? { name: "robots", content: "noindex, follow" } : m));
    return head;
  },
  component: ChecklistPage,
});

function ChecklistPage() {
  const { checklist: c } = Route.useLoaderData();
  if (!c) {
    return (
      <main className="min-h-screen bg-slate-50">
        <SiteHeader />
        <div className="mx-auto max-w-3xl px-4 py-16">
          <h1 className="text-2xl font-bold">Checklist not found</h1>
          <a href="/checklists" className="mt-4 inline-block font-semibold text-blue-700">See all bid checklists →</a>
        </div>
      </main>
    );
  }
  const download = () => {
    trackEvent("checklist_download", c.slug);
    const url = URL.createObjectURL(new Blob([checklistHtml(c)], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${c.slug}-checklist.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 print:min-h-0 print:bg-white">
      <div className="print:hidden">
        <SiteHeader />
      </div>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 print:max-w-none print:p-0">
        <a href="/checklists" className="text-sm font-semibold text-blue-700 print:hidden">← All bid checklists</a>
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none">
          <h1 className="text-2xl font-extrabold tracking-tight print:text-xl">{c.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{c.blurb}</p>
          <div className="mt-3 grid grid-cols-3 gap-4 text-xs text-slate-500">
            {["Bid / IFB #", "Buyer", "Due date & time"].map((f) => (
              <span key={f} className="border-b border-slate-300 pb-1">{f}</span>
            ))}
          </div>
          <div className="mt-4 gap-8 sm:columns-2 print:columns-2">
            {c.sections.map((s) => (
              <section key={s.heading} className="mb-4 break-inside-avoid-column">
                <h2 className="text-xs font-bold uppercase tracking-wider text-blue-900">{s.heading}</h2>
                <ul className="mt-1.5 space-y-1">
                  {s.items.map((item) => (
                    <li key={item}>
                      <label className="flex cursor-pointer items-start gap-2 text-sm leading-snug print:text-[11px]">
                        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500 print:h-3 print:w-3" />
                        <span>{item}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <p className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-500">
            A general checklist of what public buyers commonly ask for. The solicitation and its addenda are the rules for each bid: follow them where they differ.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-3 print:hidden">
          <button
            type="button"
            onClick={() => {
              trackEvent("checklist_print", c.slug);
              window.print();
            }}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-700"
          >
            Print or save as PDF
          </button>
          <button
            type="button"
            onClick={download}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-900 hover:border-slate-500"
          >
            Download (HTML file)
          </button>
        </div>

        <div className="mt-8 rounded-2xl bg-slate-950 p-6 text-white print:hidden">
          <h2 className="text-xl font-bold">Now find a {c.tradeLabel} bid to use it on</h2>
          <p className="mt-2 text-sm text-slate-300">Contract Radar shows open {c.tradeLabel} bids in your state from city, county, school, state and federal buyers.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href={`/radar?trade=${encodeURIComponent(c.trade)}`}
              onClick={() => trackEvent("checklist_radar", c.slug)}
              className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400"
            >
              See open {c.tradeLabel} bids →
            </a>
            <a
              href="/upgrade?plan=starter&source=checklist"
              onClick={() => trackEvent("checklist_starter", c.slug)}
              className="rounded-xl border border-emerald-500/60 px-4 py-2.5 text-sm font-semibold text-emerald-300 hover:border-emerald-400"
            >
              Daily bid email · $5 Starter
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
