import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCurrentUser } from "~/lib/auth";
import { MARKETS, networkName } from "~/lib/markets";

/**
 * /admin/partners — partner results by market (owner 2026-11-10, item 3): clicks and calls Contrax
 * sends each partner since the partnership started, by source and by day. Counts only. Admins only.
 */
const LABELS: Record<string, string> = {
  partner_site: "Website (market page)",
  partner_phone: "Phone (market page)",
  casa_blue_collar: "Website (market page, before Nov 10)",
  casa_phone: "Phone (market page, before Nov 10)",
  home: "Website (homepage card)",
  home_phone: "Phone (homepage card)",
};

const getReport = createServerFn({ method: "GET" }).handler(async () => {
  const user = await getCurrentUser();
  if (!user?.is_admin) return null;
  const { partnerClicks } = await import("~/lib/markets.server");
  const out = [];
  for (const m of MARKETS) {
    if (!m.partner) continue;
    out.push({ slug: m.slug, network: networkName(m), partner: m.partner.name, since: m.partner.since, ...(await partnerClicks(m)) });
  }
  return out;
});

export const Route = createFileRoute("/admin/partners")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return getReport();
  },
  head: () => ({ meta: [{ title: "Partners | Admin | Contrax" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: PartnersReport,
});

function PartnersReport() {
  const rows = Route.useLoaderData() ?? [];
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 [color-scheme:light]">
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          <a href="/admin" className="hover:underline">Admin</a> · Partners
        </p>
        <h1 className="mt-1 text-2xl font-bold">Partner results</h1>
        <p className="mt-1 text-sm text-slate-600">Clicks and calls Contrax sent each market partner since the partnership started. Counts only.</p>
        {rows.length === 0 ? <p className="mt-6 text-sm">No partners yet.</p> : null}
        {rows.map((r) => (
          <section key={r.slug} className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-bold">{r.partner}</h2>
            <p className="text-sm text-slate-600">{r.network} · since {r.since}</p>
            <p className="mt-3 text-3xl font-extrabold">{r.total}</p>
            <p className="text-sm text-slate-600">clicks and calls, from {r.visitors} {r.visitors === 1 ? "person" : "different people"}</p>
            <ul className="mt-3 space-y-1 text-sm">
              {Object.entries(r.byLabel).map(([k, n]) => (
                <li key={k} className="flex justify-between border-b border-slate-100 py-1">
                  <span>{LABELS[k] ?? (k || "Other")}</span>
                  <span className="tabular-nums font-semibold">{n}</span>
                </li>
              ))}
            </ul>
            {r.byDay.length ? (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-semibold text-blue-700">By day</summary>
                <ul className="mt-2 space-y-0.5">
                  {r.byDay.map((d) => (
                    <li key={d.day} className="flex justify-between">
                      <span>{d.day}</span>
                      <span className="tabular-nums">{d.n}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        ))}
      </main>
    </div>
  );
}
