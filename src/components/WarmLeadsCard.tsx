import { useEffect, useState } from "react";
import { warmLeadMailto, type WarmLead } from "~/lib/warm-leads";

/**
 * Warm leads on /admin/outreach (owner 2026-11-15, "go"): accounts that have looked at the plans
 * and not bought. "Write to them" opens the owner's own mail with a personal note already written
 * (src/lib/warm-leads.ts), so it goes out from him, one at a time.
 */
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");

export function WarmLeadsCard() {
  const [leads, setLeads] = useState<WarmLead[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/admin/warm-leads", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { leads: WarmLead[] }) => setLeads(d.leads))
      .catch(() => setFailed(true));
  }, []);
  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
      <h2 className="text-lg font-bold text-slate-900">Warm leads: looked at the plans, did not buy</h2>
      <p className="mt-1 text-sm text-slate-700">
        These accounts are the closest to buying. A short personal note from you does more than any automated email. Most recent look first.
      </p>
      {failed && <p className="mt-3 text-sm text-red-700">This list did not load. Reload the page to try again.</p>}
      {!failed && !leads && <p className="mt-3 text-sm text-slate-600">Loading…</p>}
      {leads && leads.length === 0 && <p className="mt-3 text-sm text-slate-600">No account has looked at the plans without buying yet.</p>}
      {leads && leads.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-sm text-slate-700">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-2">Account</th><th className="px-3 py-2">Signed up</th><th className="px-3 py-2">Looked at plans</th><th className="px-3 py-2">Last look</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <span className="block font-semibold text-slate-900">{l.company || l.email}</span>
                    {l.company && <span className="block text-xs text-slate-500">{l.email}</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{day(l.signedUp)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{l.looks} {l.looks === 1 ? "visit" : "visits"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{day(l.lastLook)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <a href={warmLeadMailto(l)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700">Write to them</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
