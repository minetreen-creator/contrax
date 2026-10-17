import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getCurrentUser } from "~/lib/auth";
import {
  AdminHeader,
  AdminTabs,
  MrrScoreboard,
  SectionError,
  SectionLoading,
  timeFmt as sharedTimeFmt,
} from "~/components/AdminShared";

/**
 * /admin/radar-leads — Radar Leads funnel + masked lead table (owner
 * 2026-09-06/07). The anonymous-lead match-alert channel's own admin surface:
 *
 *   Capture → Confirmed → Alert sent → Click → Signup → Radar used → Paid
 *
 * Stage 1–4 counts read the radar-leads channel events; stages 5–7 reuse the
 * existing signup/radar/paid signals attributed to radar-funnel visitors only
 * (organic signups never count). QA/admin/bot/test traffic is excluded the
 * same way as every admin surface. The lead table shows a MASKED email
 * (first char + domain — never the full address) plus trade/cert/size,
 * confirmation/unsubscribe/last-alert/last-click timestamps and click counts.
 */

interface RadarLeadsFunnelStage {
  stage: string;
  label: string;
  count: number;
  dropOffPct: number | null;
}
interface RadarLeadRow {
  id: number;
  maskedEmail: string;
  trade: string | null;
  cert: string | null;
  sizePref: string | null;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  lastAlertedAt: string | null;
  clickCount: number;
  lastClickedAt: string | null;
  createdAt: string;
}
interface RadarLeadsResult {
  rangeDays: number;
  from: string;
  to: string;
  totalLeads: number;
  funnel: RadarLeadsFunnelStage[];
  leads: RadarLeadRow[];
}

const DAYS_OPTIONS = [7, 30, 90];

async function fetchRadarLeadsFunnel(days: number): Promise<RadarLeadsResult> {
  const res = await fetch(`/api/admin/radar-leads-funnel?days=${days}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load radar-leads funnel" }));
    throw new Error(err.error || "Failed to load radar-leads funnel");
  }
  return res.json();
}

const timeFmt = sharedTimeFmt;

/**
 * Owner 2026-10-15: re-send a pending lead's confirmation email (the same
 * email and link). The server refuses confirmed/unsubscribed leads and limits
 * it to once a day; the address never reaches the browser.
 */
function ResendConfirmButton({ id }: { id: number }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");
  if (state === "sent") return <span className="text-xs font-medium text-emerald-600">Resent ✓</span>;
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={state === "sending"}
        onClick={async () => {
          setState("sending");
          try {
            const res = await fetch("/api/admin/radar-lead-resend", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id }),
            });
            const body = await res.json().catch(() => ({}));
            if (res.ok) setState("sent");
            else { setState("error"); setMsg(body.error || "Could not resend."); }
          } catch {
            setState("error");
            setMsg("Could not resend.");
          }
        }}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : "Resend confirmation"}
      </button>
      {state === "error" && <span className="mt-1 text-[11px] text-red-600">{msg}</span>}
    </span>
  );
}

interface LaunchpadStatementRow {
  id: number;
  maskedEmail: string | null;
  company: string;
  trade: string | null;
  state: string | null;
  alerts: boolean;
  sent: boolean;
  createdAt: string;
}

/**
 * Owner 2026-10-17: who emailed themselves a Launchpad capability statement.
 * Masked email like the lead table above; alert opt-ins also appear there.
 */
function LaunchpadStatements({ days }: { days: number }) {
  const [rows, setRows] = useState<LaunchpadStatementRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError("");
    fetch(`/api/admin/launchpad-statements?days=${days}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Failed to load Launchpad statements");
        if (!cancelled) setRows(body.rows ?? []);
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Launchpad statements"); });
    return () => { cancelled = true; };
  }, [days]);

  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-800 mb-1">Launchpad statements ({rows?.length ?? 0} in range)</h2>
      <p className="mb-3 text-xs text-slate-500">
        Visitors who emailed themselves their capability statement from /launchpad. Emails are masked. "Bid alerts" means
        they also asked for weekly matches; those addresses join the lead table above once captured. Admin and test
        addresses excluded.
      </p>
      {error ? (
        <SectionError message={error} />
      ) : !rows ? (
        <SectionLoading message="Loading Launchpad statements…" />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-sm font-medium text-slate-700">No Launchpad statements emailed in this range.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                <th className="px-5 py-3 font-medium">Company</th>
                <th className="px-5 py-3 font-medium">Trade</th>
                <th className="px-5 py-3 font-medium">State</th>
                <th className="px-5 py-3 font-medium">Email (masked)</th>
                <th className="px-5 py-3 font-medium">Bid alerts</th>
                <th className="px-5 py-3 font-medium">Email sent</th>
                <th className="px-5 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 text-slate-700 hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-900">{r.company}</td>
                  <td className="px-5 py-3">{r.trade ?? "—"}</td>
                  <td className="px-5 py-3">{r.state ?? "—"}</td>
                  <td className="px-5 py-3">{r.maskedEmail ?? "—"}</td>
                  <td className="px-5 py-3">{r.alerts ? "Yes" : "No"}</td>
                  <td className="px-5 py-3">{r.sent ? "Yes" : <span className="text-red-600">Failed</span>}</td>
                  <td className="px-5 py-3 text-xs text-slate-500">{timeFmt(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RadarLeadsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<RadarLeadsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchRadarLeadsFunnel(days)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load radar-leads funnel"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  return (
    <div className="admin-console min-h-screen bg-slate-50">
      <AdminHeader scoreboard={<MrrScoreboard />} />
      <main className="mx-auto max-w-6xl px-4 py-8 space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
            {DAYS_OPTIONS.map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${days === d ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {d}d
              </button>
            ))}
          </div>
        </div>
        <AdminTabs active="radar-leads" />

        {/* Radars match-alert funnel (owner 2026-09-06/07 — 7 exact stages) */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Match-alert funnel</h2>
          <p className="mb-3 text-xs text-slate-500">
            Anonymous Radar visitor → email captured → confirmed → first alert sent → opportunity clicked → signup → radar
            used → paid. Stages 5–7 are attributed to radar-funnel visitors only (organic signups never count here);
            QA/admin/bot/test traffic excluded.
          </p>
          {error ? (
            <SectionError message={error} />
          ) : loading || !data ? (
            <SectionLoading message="Loading radar-leads funnel…" />
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                {data.funnel.map((s, i) => (
                  <div key={s.stage} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{i + 1}. {s.label}</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{s.count}</p>
                    {s.dropOffPct !== null && s.count < data.funnel[i - 1].count && (
                      <p className="mt-0.5 text-[10px] text-red-500">−{s.dropOffPct}% from previous step</p>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[10px] text-slate-400">
                Live counts + drop-off per consecutive stage. Stage 5 reuses the existing signup-complete event; stage 6
                reuses radar completion; stage 7 derives from live subscriptions on radar-funnel-involved accounts. The
                click stage counts only PII-safe redirect clicks on bids that were genuinely emailed (repeat clicks are
                absorbed by the click log's PK and never double-count).
              </p>
            </div>
          )}
        </section>

        {/* Masked lead table */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Leads ({data?.totalLeads ?? 0} in range, max 200 shown)</h2>
          <p className="mb-3 text-xs text-slate-500">
            Emails are masked to first character + domain — never the full address. Profile shows trade/cert/size only;
            unsubscribe_token is never read. Bot/QA/admin visitor traffic excluded.
          </p>
          {error ? (
            <SectionError message={error} />
          ) : loading || !data ? (
            <SectionLoading message="Loading leads…" />
          ) : data.leads.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <p className="text-sm font-medium text-slate-700">No radar leads captured in this range.</p>
              <p className="mt-1 text-xs text-slate-400">
                Once anonymous Radar visitors submit the "Send My Matches" capture and confirm, leads appear here — masked,
                with their funnel progress and click counts.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                    <th className="px-5 py-3 font-medium">#</th>
                    <th className="px-5 py-3 font-medium">Email (masked)</th>
                    <th className="px-5 py-3 font-medium">Cert</th>
                    <th className="px-5 py-3 font-medium">Trade</th>
                    <th className="px-5 py-3 font-medium">Size</th>
                    <th className="px-5 py-3 font-medium">Confirmed</th>
                    <th className="px-5 py-3 font-medium">Unsubscribed</th>
                    <th className="px-5 py-3 font-medium">Last alert</th>
                    <th className="px-5 py-3 font-medium"># clicks</th>
                    <th className="px-5 py-3 font-medium">Last click</th>
                  </tr>
                </thead>
                <tbody>
                  {data.leads.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100 text-slate-700 hover:bg-slate-50/60">
                      <td className="px-5 py-3 font-mono text-xs text-slate-400">{r.id}</td>
                      <td className="px-5 py-3 font-medium text-slate-900">{r.maskedEmail}</td>
                      <td className="px-5 py-3">{r.cert ?? "—"}</td>
                      <td className="px-5 py-3">{r.trade ?? "—"}</td>
                      <td className="px-5 py-3">{r.sizePref ?? "—"}</td>
                      <td className="px-5 py-3 text-xs text-slate-500">
                        {r.confirmedAt || r.unsubscribedAt ? timeFmt(r.confirmedAt) : <ResendConfirmButton id={r.id} />}
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500">{timeFmt(r.unsubscribedAt)}</td>
                      <td className="px-5 py-3 text-xs text-slate-500">{timeFmt(r.lastAlertedAt)}</td>
                      <td className="px-5 py-3">
                        {r.clickCount > 0 ? (
                          <span className="inline-flex rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">{r.clickCount}</span>
                        ) : (
                          <span className="text-slate-300">0</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500">{timeFmt(r.lastClickedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-5 py-3 text-[10px] text-slate-400 border-t border-slate-100">
                Click counts are per-lead totals across all emailed bids; repeat clicks on the same bid are absorbed by the
                click log PK (lead_id × bid_id) and never double-count. All data read from stored funnel events — nothing
                fabricated.
              </p>
            </div>
          )}
        </section>

        <LaunchpadStatements days={days} />
      </main>
    </div>
  );
}

export const Route = createFileRoute("/admin/radar-leads")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: RadarLeadsPage,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Radar Leads | Admin | Contrax" }] }),
});