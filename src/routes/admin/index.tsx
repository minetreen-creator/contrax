import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getCurrentUser } from "~/lib/auth";
import type { RadarConversionFunnelResult } from "~/lib/radar-conversion-funnel";
import { countryLabel, isUsVisitor, visitorCountry } from "~/lib/visitor-geo";
import {
  AdminHeader,
  AdminTabs,
  MrrScoreboard,
  SectionError,
  SectionLoading,
  moneyWhole,
  timeFmt,
} from "~/components/AdminShared";

/**
 * /admin/ — Overview tab (owner 2026-10-06 redesign: "This week" numbers vs the
 * week before, Leads worth a look, and an Ad check by country up top; the older
 * 30-day sections below sit under a collapsed "More numbers").
 *
 * Earlier layout (owner 2026-09-07), kept below the fold:
 *
 *   CONTRAX TODAY — the owner-exact 8-card scoreboard, in order: Qualified
 *   Visitors / Radar Completed / Radar Leads / Autopsy Started / Signups /
 *   Activated / Customers / MRR. Every number is live from the EXISTING
 *   endpoints the merged dashboard already calls (unified-funnel,
 *   radar-leads-funnel, autopsy-funnel, metrics, finance) — NO analytics
 *   rewrite, NO new dependencies, NO schema changes. Bot/QA/admin rows are
 *   excluded server-side by those endpoints; cards carry honest hints.
 *
 *   🔥 PEOPLE TO ACT ON — HIGH-VALUE ONLY: rows whose existing board-side lead
 *   score is "Very High" or "High" (Medium/Low dropped), capped at top 10,
 *   ranked by score. 4-part card per row: what-did (acquisition path) /
 *   why-important (intent badge + score + reasons) / where-in-funnel
 *   (signup/radar/radar-lead stage marker) / Recommended-Next (best_next +
 *   Try: cta from the Conversion Opportunity mapping, PII-masked exactly like
 *   the board).
 *
 *   REVENUE FUNNEL — the CEO health section: Radar → Lead → Confirmed →
 *   Alert → Click → Signup → Activated → Paid, aggregated from EXISTING funnel
 *   events (unified radar-completed, radar-leads capture/confirmed/alert/click/
 *   signup, unified activated, live Stripe customers). Honest counts + drop-off
 *   %; zero funnel → honest empty state, never fabricated.
 *
 * The deep surfaces stay on the tabs (Radar Leads, Autopsy, Visitors, Signups,
 * Customers).
 */

// ── Endpoint shapes (all pre-filtered server-side: bot/QA/admin excluded) ───
interface UnifiedStage { stage: string; label: string; count: number; stepConversionPct: number | null; }
interface UnifiedResult { rangeDays: number; stages: UnifiedStage[]; }
interface SimpleFunnel { rangeDays: number; funnel: { stage: string; label: string; count: number; dropOffPct: number | null }[]; }

/** Radar scan diagnostics (owner 2026-09-28) — the four scan cohorts, in the
 *  owner's order, keyed by the short keys of RADAR_DIAGNOSTIC_EVENTS. */
const RADAR_SCAN_COHORTS: { key: string; label: string }[] = [
  { key: "anonymousMatches", label: "Anonymous · matches" },
  { key: "anonymousZero", label: "Anonymous · zero matches" },
  { key: "signedInMatches", label: "Signed in · matches" },
  { key: "signedInZero", label: "Signed in · zero matches" },
];
interface FinanceShape { mrrCents: number; customerCount: number; source: "stripe-live" | "app-db"; }
interface BidScoutFunnelStageShape { key: "viewed" | "checkout_started" | "purchased"; label: string; count: number; }
interface BidScoutFunnelShape { range: "30d"; stages: BidScoutFunnelStageShape[]; }

type RadarLeadStage = "captured" | "confirmed" | "alerted" | "clicked";
type SignupStatus = "Not started" | "Viewed" | "Started" | "Abandoned" | "Success";

interface OppReason { points: number; reason: string; }
interface JourneysShape {
  journeys: {
    visitor_id: string;
    label: string;
    visitor_hash: string | null;
    source: string | null;
    city: string | null;
    region: string | null;
    device_type: string | null;
    browser_label: string | null;
    radar: boolean;
    signup: SignupStatus;
    radar_lead_stage?: RadarLeadStage | null;
    last_activity: string | null;
    country?: string | null;
    paid_click?: boolean;
    source_label?: string | null;
    steps?: number;
    lead_score?: { score: number; level: "Very High" | "High" | "Medium" | "Low"; reasons: OppReason[]; automated?: string | null };
    conversion_opportunity?: { best_next: string; obstacle: string; cta: string; channel: "outreach" | "onsite" };
  }[];
  watched_returned?: { visitor_id: string }[];
}
interface NonprofitQueueShape { count: number; }

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Failed to load ${url}` }));
    throw new Error(err.error || `Failed to load ${url}`);
  }
  return res.json();
}

/** Drop-off % to the NEXT stage (null when the current count is 0). */
function dropPct(next: number, prev: number): number | null {
  if (prev <= 0) return null;
  const p = Math.round((1 - next / prev) * 100);
  return p > 0 ? p : 0;
}

type JourneyRow = JourneysShape["journeys"][number];

const DAY_MS = 24 * 60 * 60 * 1000;

function withinDays(iso: string | null, days: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t <= days * DAY_MS;
}

function place(r: { city: string | null; region: string | null }): string {
  return [r.city, r.region].filter(Boolean).join(", ") || "Unknown place";
}

function whatTheyDid(r: JourneyRow): string {
  if (r.signup === "Success") return "Signed up";
  if (r.signup === "Started" || r.signup === "Abandoned") return "Started signup";
  if (r.radar) return "Ran a Radar scan";
  if (r.signup === "Viewed") return "Looked at signup";
  return `${r.steps ?? 0} page${(r.steps ?? 0) === 1 ? "" : "s"}`;
}

/** One number for this week with the change from the 7 days before. */
function WeekCard({ label, now, before, href }: { label: string; now: number | null; before: number | null; href: string }) {
  const diff = now != null && before != null ? now - before : null;
  return (
    <a href={href} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-bold text-slate-900">{now ?? "…"}</p>
      <p className={`mt-0.5 text-xs font-medium ${diff == null || diff === 0 ? "text-slate-400" : diff > 0 ? "text-emerald-700" : "text-rose-600"}`}>
        {diff == null ? "\u00a0" : diff === 0 ? "same as last week" : `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff)} vs last week`}
      </p>
    </a>
  );
}

/** Real US visitors who did something worth a follow-up (owner 2026-10-06). */
function LeadsWorthALook({ rows }: { rows: JourneyRow[] | null }) {
  if (!rows) return <SectionLoading message="Loading…" />;
  if (rows.length === 0) {
    return <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">No one to follow up with in the last 14 days.</p>;
  }
  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
      {rows.map((r) => (
        <li key={r.visitor_id}>
          <a href={`/admin/journeys?visitor=${encodeURIComponent(r.visitor_id)}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-slate-50">
            <span className="font-semibold text-slate-900">{r.label && !r.label.includes("·") && !r.label.startsWith("Direct Lead") ? r.label : place(r)}</span>
            <span className="text-slate-500">{r.source_label || r.source || "direct"}</span>
            <span className="text-slate-700">{whatTheyDid(r)}</span>
            <span className="ml-auto text-xs text-slate-400">{timeFmt(r.last_activity)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Paid clicks this week by country, and how many left after one page. */
function AdCheck({ rows }: { rows: JourneyRow[] | null }) {
  if (!rows) return <SectionLoading message="Loading…" />;
  const paid = rows.filter((r) => r.paid_click && withinDays(r.last_activity, 7));
  if (paid.length === 0) {
    return <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">No paid ad clicks in the last 7 days.</p>;
  }
  const groups = new Map<string, { clicks: number; bounced: number; us: boolean }>();
  for (const r of paid) {
    const c = visitorCountry(r.country, r.region, r.city);
    const key = countryLabel(c);
    const g = groups.get(key) ?? { clicks: 0, bounced: 0, us: c?.code === "US" };
    g.clicks += 1;
    if ((r.steps ?? 0) <= 1) g.bounced += 1;
    groups.set(key, g);
  }
  const list = [...groups.entries()].sort((a, b) => b[1].clicks - a[1].clicks);
  const outside = list.filter(([, g]) => !g.us).reduce((n, [, g]) => n + g.clicks, 0);
  const bounced = list.reduce((n, [, g]) => n + g.bounced, 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      {outside > 0 && (
        <p className="border-b border-rose-100 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
          <span className="font-semibold">{outside} of {paid.length} paid clicks came from outside the US.</span> In Google Ads, set Locations to
          the United States with &ldquo;Presence: people in or regularly in your targeted locations&rdquo;.
        </p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400">
            <th className="px-4 py-2 font-medium">Country</th>
            <th className="px-4 py-2 font-medium">Clicks</th>
            <th className="px-4 py-2 font-medium">Left after 1 page</th>
          </tr>
        </thead>
        <tbody>
          {list.map(([name, g]) => (
            <tr key={name} className="border-t border-slate-100">
              <td className={`px-4 py-2 font-medium ${g.us ? "text-slate-800" : "text-rose-700"}`}>{name}</td>
              <td className="px-4 py-2 text-slate-700">{g.clicks}</td>
              <td className="px-4 py-2 text-slate-700">{g.bounced}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
        {bounced} of {paid.length} left after one page. Countries marked (est.) are guessed from the region code; exact countries are recorded from Oct 6, 2026.
      </p>
    </div>
  );
}

/** Revenue funnel bar (owner 2026-09-07 CEO health section). Every stage
 *  aggregates EXISTING funnel events; Paid is the live Stripe customer count.
 *  No fabricated numbers: a stage with no data renders "0" and 0% drop-off,
 *  and a zero funnel shows the honest empty state. */
function RevenueFunnel({ unified, radarLeads, fin, loading, error }: {
  unified: UnifiedResult | null;
  radarLeads: SimpleFunnel | null;
  fin: FinanceShape | null;
  loading: boolean;
  error: string;
}) {
  if (error) return <SectionError message={error} />;
  if (loading) return <SectionLoading message="Loading revenue funnel…" />;
  const stage = (list: { stage: string; count: number }[] | undefined, name: string): number =>
    list?.find((s) => s.stage === name)?.count ?? 0;
  const radar = unified ? stage(unified.stages, "radar") : null;
  const lead = radarLeads ? stage(radarLeads.funnel, "capture") : null;
  const confirmed = radarLeads ? stage(radarLeads.funnel, "confirmed") : null;
  const alertSent = radarLeads ? stage(radarLeads.funnel, "alert_sent") : null;
  const click = radarLeads ? stage(radarLeads.funnel, "click") : null;
  const signup = radarLeads ? stage(radarLeads.funnel, "signup") : null;
  const activated = unified ? stage(unified.stages, "activated") : null;
  const paid = fin ? fin.customerCount : null;
  const stages: { label: string; value: number | null; hint: string }[] = [
    { label: "Radar", value: radar, hint: "radar completed · 30d" },
    { label: "Lead", value: lead, hint: "email captured · 30d" },
    { label: "Confirmed", value: confirmed, hint: "email confirmed · 30d" },
    { label: "Alert", value: alertSent, hint: "match alert sent · 30d" },
    { label: "Click", value: click, hint: "opportunity clicked · 30d" },
    { label: "Signup", value: signup, hint: "radar-funnel signups · 30d" },
    { label: "Activated", value: activated, hint: "activated visitors · 30d" },
    { label: "Paid", value: paid, hint: fin ? (fin.source === "stripe-live" ? "live Stripe customers" : "live app-DB customers") : "live" },
  ];
  const allZero = stages.every((s) => (s.value ?? 0) === 0);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {allZero ? (
        <>
          <p className="text-sm font-medium text-slate-700">No revenue-funnel traffic yet — honest zero state.</p>
          <p className="mt-1 text-xs text-slate-400">
            Radar completions flow through this funnel as real humans arrive; every stage reads live from the existing
            funnel events (bot/QA/admin excluded).
          </p>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-y-3">
          {stages.map((s, i) => {
            const prev = i === 0 ? null : stages[i - 1].value;
            const drop = prev != null && prev > 0 ? dropPct(s.value ?? 0, prev) : null;
            return (
              <div key={s.label} className="flex items-center">
                <div className="min-w-[104px] rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{s.label}</p>
                  <p className="text-xl font-bold text-slate-900">{s.value ?? "—"}</p>
                  <p className="mt-0.5 text-[9px] leading-tight text-slate-400">{s.hint}</p>
                </div>
                {i < stages.length - 1 && (
                  <span className="mx-1.5 w-10 text-center">
                    <span className="text-[10px] font-bold text-rose-500">{drop != null ? `−${drop}%` : "—"}</span>
                    <span className="block text-[9px] text-slate-300">→</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
        Radar → Lead → Confirmed → Alert → Click → Signup → Activated → Paid. Aggregated from existing funnel events
        (unified-funnel / radar-leads-funnel / finance) — no analytics rewrite. Drop-off % is lost vs. the previous
        stage; null when the previous stage is 0.
      </p>
    </div>
  );
}

export const Route = createFileRoute("/admin/")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: AdminOverviewPage,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Admin | Contrax" }] }),
});

function AdminOverviewPage() {
  const [unified, setUnified] = useState<UnifiedResult | null>(null);
  const [autopsy, setAutopsy] = useState<SimpleFunnel | null>(null);
  const [radarLeads, setRadarLeads] = useState<SimpleFunnel | null>(null);
  const [radarConv, setRadarConv] = useState<RadarConversionFunnelResult | null>(null);
  const [bidScoutFunnel, setBidScoutFunnel] = useState<BidScoutFunnelShape | null>(null);
  const [fin, setFin] = useState<(FinanceShape & { customers?: { since: string | null }[] }) | null>(null);
  const [nonprofitQueue, setNonprofitQueue] = useState<number | null>(null);
  const [thisWeek, setThisWeek] = useState<UnifiedResult | null>(null);
  const [lastWeek, setLastWeek] = useState<UnifiedResult | null>(null);
  const [visitors, setVisitors] = useState<JourneyRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getJson<UnifiedResult>("/api/admin/unified-funnel?days=30"),
      getJson<SimpleFunnel>("/api/admin/autopsy-funnel?days=30"),
      getJson<SimpleFunnel>("/api/admin/radar-leads-funnel?days=30"),
      getJson<RadarConversionFunnelResult>("/api/admin/radar-conversion-funnel?days=30"),
      getJson<BidScoutFunnelShape>("/api/admin/bid-scout-funnel"),
      getJson<FinanceShape & { customers?: { since: string | null }[] }>("/api/admin/finance"),
      getJson<NonprofitQueueShape>("/api/admin/nonprofit-applications?filter=queue&limit=100"),
    ])
      .then(([u, a, r, rc, bs, fn, np]) => {
        if (cancelled) return;
        setUnified(u);
        setAutopsy(a);
        setRadarLeads(r);
        setRadarConv(rc);
        setBidScoutFunnel(bs);
        setFin(fn);
        setNonprofitQueue(np.count);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load overview");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    getJson<UnifiedResult>("/api/admin/unified-funnel?days=7").then((d) => !cancelled && setThisWeek(d)).catch(() => {});
    getJson<UnifiedResult>("/api/admin/unified-funnel?days=7&offset=7").then((d) => !cancelled && setLastWeek(d)).catch(() => {});
    getJson<JourneysShape>("/api/admin/journeys?days=14")
      .then((d) => !cancelled && setVisitors(d.journeys ?? []))
      .catch(() => !cancelled && setVisitors([]));
    return () => { cancelled = true; };
  }, []);

  const stage = (name: string): number =>
    unified?.stages.find((s) => s.stage === name)?.count ?? 0;
  const funnelCount = (name: string): number =>
    radarLeads?.funnel.find((s) => s.stage === name)?.count ?? 0;
  const autopsyCount = (name: string): number =>
    autopsy?.funnel.find((s) => s.stage === name)?.count ?? 0;
  const week = (d: UnifiedResult | null, name: string): number | null =>
    d ? d.stages.find((s) => s.stage === name)?.count ?? 0 : null;
  const newCustomers = (fromDays: number, toDays: number): number | null => {
    if (!fin?.customers) return null;
    return fin.customers.filter((c) => {
      const t = c.since ? Date.parse(c.since) : NaN;
      const age = Date.now() - t;
      return Number.isFinite(t) && age >= toDays * DAY_MS && age < fromDays * DAY_MS;
    }).length;
  };

  // Leads worth a look: real (not likely automated), in the US, and did
  // something (Medium or higher lead score) in the last 14 days. Top 5.
  const leads = visitors
    ? visitors
        .filter((j) => !j.lead_score?.automated)
        .filter((j) => isUsVisitor(j.country, j.region, j.city))
        .filter((j) => j.lead_score && j.lead_score.level !== "Low")
        .sort((a, b) => (b.lead_score?.score ?? 0) - (a.lead_score?.score ?? 0) || (b.last_activity ?? "").localeCompare(a.last_activity ?? ""))
        .slice(0, 5)
    : null;

  // CONTRAX TODAY — the owner-exact 8 cards (30 days), now under "More numbers".
  const todayCards = [
    { label: "Qualified Visitors", value: unified ? stage("qualified") : null, hint: "qualified visits · 30d" },
    { label: "Radar Completed", value: unified ? stage("radar") : null, hint: "radar scans completed · 30d" },
    { label: "Radar Leads", value: radarLeads ? funnelCount("capture") : null, hint: "radar leads captured · 30d" },
    { label: "Autopsy Started", value: autopsy ? autopsyCount("autopsy_landing") : null, hint: "autopsies started · 30d" },
    { label: "Signups", value: unified ? stage("signup") : null, hint: "signups completed · 30d" },
    { label: "Activated", value: unified ? stage("activated") : null, hint: "activated visitors · 30d" },
    { label: "Customers", value: fin ? fin.customerCount : null, hint: fin ? (fin.source === "stripe-live" ? "live Stripe customers" : "live app-DB customers") : "live" },
    { label: "MRR", value: fin ? moneyWhole(fin.mrrCents) : null, hint: fin ? (fin.source === "stripe-live" ? "live Stripe MRR" : "live app-DB MRR") : "live" },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader scoreboard={<MrrScoreboard />} />
      <main className="mx-auto max-w-5xl px-4 py-6 space-y-8">
        <AdminTabs active="overview" />

        {nonprofitQueue != null && nonprofitQueue > 0 && (
          <a href="/admin/nonprofits" className="block rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-medium text-violet-800">
            {nonprofitQueue} nonprofit application{nonprofitQueue === 1 ? "" : "s"} waiting for review →
          </a>
        )}

        <section>
          <h2 className="mb-2 text-base font-semibold text-slate-900">This week</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <WeekCard label="Visitors" now={week(thisWeek, "qualified")} before={week(lastWeek, "qualified")} href="/admin/journeys" />
            <WeekCard label="Radar scans" now={week(thisWeek, "radar")} before={week(lastWeek, "radar")} href="/admin/journeys" />
            <WeekCard label="Signups" now={week(thisWeek, "signup")} before={week(lastWeek, "signup")} href="/admin/signups" />
            <WeekCard label="New paying customers" now={newCustomers(7, 0)} before={newCustomers(14, 7)} href="/admin/customers" />
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">Last 7 days vs the 7 days before. Bots, test and admin traffic excluded.</p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-slate-900">Leads worth a look</h2>
          <LeadsWorthALook rows={leads} />
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-slate-900">Ad check · last 7 days</h2>
          <AdCheck rows={visitors} />
        </section>

        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">More numbers (30 days, funnels)</summary>
          <div className="mt-6 space-y-8">
        {/* CONTRAX TODAY — owner-exact 8-card scoreboard */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Business pulse (30 days)</h2>
          <p className="mb-3 text-xs text-slate-500">
            Qualified Visitors · Radar Completed · Radar Leads · Autopsy Started · Signups · Activated · Customers · MRR
            — live from the same endpoints as the tabs (30d). QA/admin/bot/test excluded.
          </p>
          {error ? (
            <SectionError message={error} />
          ) : loading ? (
            <SectionLoading message="Loading today's numbers…" />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {todayCards.map((c) => (
                <div key={c.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{c.label}</p>
                  <p className="mt-1 text-3xl font-bold text-slate-900">{c.value ?? "—"}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">{c.hint}</p>
                </div>
              ))}
            </div>
          )}
          {!loading && !error && fin && (
            <p className="mt-2 text-[11px] text-slate-400">
              MRR (live): <span className="font-bold text-slate-700">{moneyWhole(fin.mrrCents)}</span> ·{" "}
              {fin.source === "stripe-live" ? "live Stripe read" : "live app-database read (Stripe unreachable)"} — top-right scoreboard.
            </p>
          )}
        </section>

        {/* REVENUE FUNNEL — CEO health section */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">💰 Revenue Funnel</h2>
          <p className="mb-3 text-xs text-slate-500">
            Radar → Lead → Confirmed → Alert → Click → Signup → Activated → Paid — every stage aggregates existing
            funnel events (no analytics rewrite); Paid is the live Stripe customer count.
          </p>
          <RevenueFunnel unified={unified} radarLeads={radarLeads} fin={fin} loading={loading} error={error} />
        </section>
        {/* RADAR CONVERSION (09-07 sprint, PR2) — separate 9-stage funnel */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Radar Conversion (09-07 sprint)</h2>
          <p className="mb-3 text-xs text-slate-500">
            Qualified Visit → Radar Started → Radar Completed → Results Viewed → Unlock Shown → Unlock Clicked →
            Signup → Activated → Paid — separate from the 7-stage Radar-Leads funnel and the CEO Overview numbers
            above (untouched). Distinct visitors, consecutive drop-off, bot/QA/admin excluded.
          </p>
          {error ? (
            <SectionError message={error} />
          ) : loading || !radarConv ? (
            <SectionLoading message="Loading radar conversion funnel…" />
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-y-3">
                {radarConv.funnel.map((s, idx) => {
                  const prev = idx === 0 ? null : radarConv.funnel[idx - 1].count;
                  const drop = prev != null && prev > 0 ? dropPct(s.count, prev) : null;
                  return (
                    <div key={s.stage} className="flex items-center">
                      <div className="min-w-[104px] rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{s.label}</p>
                        <p className="text-xl font-bold text-slate-900">{s.count}</p>
                        <p className="mt-0.5 text-[9px] leading-tight text-slate-400">
                          {idx === 0 ? "base · 30d" : drop != null ? `−${drop}% vs prev` : "— vs prev"}
                        </p>
                      </div>
                      {idx < radarConv.funnel.length - 1 && (
                        <span className="mx-1.5 w-10 text-center">
                          <span className="text-[10px] font-bold text-rose-500">{drop != null ? `−${drop}%` : "—"}</span>
                          <span className="block text-[9px] text-slate-300">→</span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
                Drop-off % is lost vs. the previous stage; 0 when the previous stage is 0. Reads live from existing
                funnel events (no analytics rewrite).
              </p>
              <p className="mt-2 text-[11px] text-slate-500">
                Small sample — post-tracking baseline of 6 organic signup-page visitors, 0 signups; not statistically
                conclusive.
              </p>
            </div>
          )}
        </section>

        {/* RADAR SCAN DIAGNOSTICS (owner 2026-09-28) — below the funnel: WHY it
            leaks between Radar Completed and Signup. The four scan cohorts plus
            the three results-screen surfaces, same window + exclusions. */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Radar scan diagnostics · 30 days</h2>
          {error ? (
            <SectionError message={error} />
          ) : loading || !radarConv ? (
            <SectionLoading message="Loading radar scan diagnostics…" />
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {RADAR_SCAN_COHORTS.map((c) => (
                  <div key={c.key} className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{c.label}</p>
                    <p className="text-xl font-bold text-slate-900">{radarConv.diagnostics?.[c.key] ?? 0}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                <p>
                  Anonymous results viewed: <span className="font-semibold text-slate-700">{radarConv.diagnostics?.anonymousResultsViewed ?? 0}</span>
                </p>
                <p>
                  More than 3 matches · free signup card: <span className="font-semibold text-slate-700">{radarConv.diagnostics?.lockedShown ?? 0}</span> shown ·{" "}
                  <span className="font-semibold text-slate-700">{radarConv.diagnostics?.lockedClicked ?? 0}</span> clicked
                </p>
                <p>
                  1–3 matches · free signup CTA: <span className="font-semibold text-slate-700">{radarConv.diagnostics?.smallCtaShown ?? 0}</span> shown ·{" "}
                  <span className="font-semibold text-slate-700">{radarConv.diagnostics?.smallCtaClicked ?? 0}</span> clicked
                </p>
              </div>
              <p className="mt-2 text-[10px] text-slate-400">
                The four scan cohorts begin collecting with this release — they read 0 until the first completed scan
                arrives. Counts are distinct visitors per event and may overlap (one visitor can complete more than one
                scan, or one with matches and one without). The five results-screen counters are pre-existing events.
              </p>
            </div>
          )}
        </section>

        {/* BID SCOUT FUNNEL — separate assisted-service path (owner 2026-09-11,
            Phase B). Own card: NOT inside the Radar Conversion or Autopsy
            components, and NEVER part of the canonical unified funnel. */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Bid Scout Funnel</h2>
          <p className="mb-3 text-xs text-slate-500">Separate assisted-service path · last 30 days</p>
          {error ? (
            <SectionError message={error} />
          ) : loading || !bidScoutFunnel ? (
            <SectionLoading message="Loading bid scout funnel…" />
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-y-3">
                {bidScoutFunnel.stages.map((s, idx) => {
                  const prev = idx === 0 ? null : bidScoutFunnel.stages[idx - 1].count;
                  const drop = prev != null && prev > 0 ? dropPct(s.count, prev) : null;
                  return (
                    <div key={s.key} className="flex items-center">
                      <div className="min-w-[120px] rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2">
                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{s.label}</p>
                        <p className="text-xl font-bold text-slate-900">{s.count}</p>
                        <p className="mt-0.5 text-[9px] leading-tight text-slate-400">
                          {idx === 0 ? "base · 30d" : drop != null ? `−${drop}% vs prev` : "— vs prev"}
                        </p>
                      </div>
                      {idx < bidScoutFunnel.stages.length - 1 && (
                        <span className="mx-1.5 w-10 text-center">
                          <span className="text-[10px] font-bold text-rose-500">{drop != null ? `−${drop}%` : "—"}</span>
                          <span className="block text-[9px] text-slate-300">→</span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
                Bid Scout viewed → Checkout started → Purchased. Separate from the Radar Conversion and Autopsy
                funnels and OUTSIDE the canonical unified funnel — a Bid Scout purchase never synthesizes signup,
                activation, or paid-stage events. Purchased counts distinct bid_scout_subscriptions rows (status any)
                in the window. Bot/QA/admin/test excluded.
              </p>
            </div>
          )}
        </section>

          </div>
        </details>
      </main>
    </div>
  );
}
