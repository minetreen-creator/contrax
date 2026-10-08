import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { courseTitle } from "~/lib/course-catalog";

/**
 * /learn/certificate/$token — printable completion certificate for the free
 * construction course (owner 2026-10-07). Addressed by an unguessable token;
 * not indexed.
 */
const loadCertificate = createServerFn({ method: "GET" })
  .validator((d: unknown) => ({ token: String((d as { token?: unknown })?.token ?? "") }))
  .handler(async ({ data }) => {
    const { getCompletion } = await import("~/lib/course.server");
    return getCompletion(data.token);
  });

export const Route = createFileRoute("/learn/certificate/$token")({
  loader: async ({ params }) => {
    const c = await loadCertificate({ data: { token: params.token } });
    if (!c) throw notFound();
    const title = courseTitle(c.course);
    if (!title) throw notFound();
    return { ...c, title };
  },
  component: CertificatePage,
  head: () => ({ meta: [{ title: "Certificate of Completion | Contrax" }, { name: "robots", content: "noindex, nofollow" }] }),
});

function CertificatePage() {
  const c = Route.useLoaderData();
  const date = new Date(c.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl rounded-2xl border-4 border-double border-slate-800 bg-white px-8 py-12 text-center shadow-sm print:shadow-none">
        <img src="/logo-square.png" alt="Contrax" className="mx-auto h-24 w-24" />
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">Certificate of Completion</p>
        <p className="mt-6 text-slate-600">This certifies that</p>
        <p className="mt-2 text-3xl font-extrabold text-slate-900 sm:text-4xl">{c.name}</p>
        <p className="mt-4 text-slate-600">has completed the free course</p>
        <p className="mt-2 text-xl font-bold text-slate-900">{c.title}</p>
        <p className="mt-6 text-sm text-slate-500">{date}</p>
        <p className="mt-8 text-sm text-slate-700">
          Nathaniel Minetree
          <br />
          Owner and CEO, Contrax LLC
        </p>
        <p className="mt-6 text-xs text-slate-400">contrax.company · An educational course; not an SBA or government certification.</p>
      </div>
      <div className="mx-auto mt-6 max-w-3xl text-center print:hidden">
        <button type="button" onClick={() => window.print()} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white">
          Print or save as PDF
        </button>
      </div>
    </main>
  );
}
