import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { WINNERS_FORMAT_NOTE, WINNERS_SESSION_RE, winnersDownloadHref } from "~/lib/state-winners";

/**
 * /winners-list — where Stripe returns a buyer of the state winners list (owner 2026-11-19), and
 * where the emailed link points. It shows nothing private: the download itself checks the Stripe
 * session, so this page is safe to open without an order.
 */
export const Route = createFileRoute("/winners-list")({
  validateSearch: (s: Record<string, unknown>): { session?: string } =>
    typeof s.session === "string" && WINNERS_SESSION_RE.test(s.session) ? { session: s.session } : {},
  head: () => ({ meta: [{ title: "Your winners list | Contrax" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: WinnersListPage,
});

function WinnersListPage() {
  const { session } = Route.useSearch();
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        {session ? (
          <>
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Payment received</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Your list is ready</h1>
            <p className="mt-3 text-slate-700">
              The file is built from the latest federal records when you click, so it can take up to half a minute for a large state.
            </p>
            <a
              href={winnersDownloadHref(session)}
              className="mt-6 inline-block rounded-xl bg-slate-900 px-6 py-3 font-bold text-white no-underline hover:bg-slate-800"
            >
              Download my list →
            </a>
            <p className="mt-4 text-sm text-slate-600">{WINNERS_FORMAT_NOTE}</p>
            <p className="mt-2 text-sm text-slate-600">
              We also emailed you this link, and it keeps working. Something wrong with the file? Write to{" "}
              <a href="mailto:contrax.companyllc@gmail.com" className="text-blue-700">contrax.companyllc@gmail.com</a>.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-extrabold tracking-tight">State winners list</h1>
            <p className="mt-3 text-slate-700">
              This page opens from the link in your order email. To buy a list, choose your state on the{" "}
              <a href="/federal-construction-by-state#list" className="text-blue-700">federal construction by state</a> page.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
