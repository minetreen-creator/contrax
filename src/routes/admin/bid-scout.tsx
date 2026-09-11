import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getCurrentUser } from "~/lib/auth";
import {
  AdminHeader,
  AdminTabs,
  MrrScoreboard,
  SectionError,
  SectionLoading,
  timeFmt,
} from "~/components/AdminShared";

/**
 * /admin/bid-scout — Bid Scout fulfillment view (owner 2026-09-11, Phase B).
 *
 * Bid Scout is the $99/mo assisted-service product: five handpicked
 * opportunities every Friday. This tab is the fulfillment surface — every
 * bid_scout_subscriptions row, oldest active first (created_at ASC) so the
 * team works the oldest commitments first. Status filter defaults to 'active';
 * QA/admin/test rows are excluded server-side by the endpoint.
 *
 * Deliberately OUTSIDE every funnel tab: Bid Scout purchases never enter the
 * canonical unified funnel or the Radar Conversion / Autopsy funnels.
 */
const STATUS_OPTIONS = ["active", "pending", "past_due", "cancelled"] as const;
type StatusOption = (typeof STATUS_OPTIONS)[number];

interface BidScoutSubscriptionRow {
  id: string;
  user_id: string | null;
  email: string | null;
  company_name: string | null;
  website: string | null;
  capabilities: string | null;
  naics_codes: string | null;
  certifications: string | null;
  target_states: string | null;
  notes: string | null;
  source: string | null;
  status: string | null;
  stripe_subscription_id: string | null;
  created_at: string | null;
}
interface SubscriptionsResult {
  status: string;
  subscriptions: BidScoutSubscriptionRow[];
}
async function fetchSubscriptions(status: string): Promise<SubscriptionsResult> {
  const res = await fetch(`/api/admin/bid-scout-subscriptions?status=${encodeURIComponent(status)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load Bid Scout subscriptions" }));
    throw new Error(err.error || "Failed to load Bid Scout subscriptions");
  }
  return res.json();
}

// ── Phase B.1 acquisition funnel (owner 2026-09-11) ─────────────────────────
interface AcquisitionStage {
  key: string;
  label: string;
  count: number;
}
interface AcquisitionSource {
  bucket: string;
  label: string;
  landing: number;
  checkout_started: number;
  purchased: number;
}
interface AcquisitionFunnel {
  range: "30d";
  stages: AcquisitionStage[];
  conversionRatePct: number | null;
  sources: AcquisitionSource[];
}
async function fetchAcquisitionFunnel(): Promise<AcquisitionFunnel> {
  const res = await fetch("/api/admin/bid-scout-acquisition-funnel");
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load Bid Scout acquisition funnel" }));
    throw new Error(err.error || "Failed to load Bid Scout acquisition funnel");
  }
  return res.json();
}

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-800",
  past_due: "bg-rose-100 text-rose-700",
  cancelled: "bg-slate-100 text-slate-500",
};

// ── Founders first-five offer (owner spec 2026-09-11 §6) ─────────────────────
interface FoundersReport {
  promo: {
    promotionCodeId: string;
    maxRedemptions: number;
    timesRedeemed: number;
    remaining: number;
    available: boolean;
  } | null;
  foundersSubscriptions: number;
  firstMonthMrrCents: number;
  activeSubscriptions: number;
  contractedRecurringMrrCents: number;
}
async function fetchFoundersReport(): Promise<FoundersReport> {
  const res = await fetch("/api/admin/bid-scout-founders");
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load founders offer report" }));
    throw new Error(err.error || "Failed to load founders offer report");
  }
  return res.json();
}
const fmtUsd = (cents: number) =>
  `${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;

/**
 * §6 reporting — never changes subscription-table semantics:
 *  · Founders spots redeemed: Stripe times_redeemed / 5 (server-side retrieve)
 *  · Founders subscriptions: rows with offer_code='first_five_49'
 *  · First-month MRR-equivalent: $49 per founder sub's FIRST paid invoice only
 *  · Contracted recurring MRR: $99 for EVERY active subscription (a founder
 *    sub is never $49 MRR after its first invoice — run rate is $99)
 */
function FoundersOfferPanel({ report, error }: { report: FoundersReport | null; error: string }) {
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error}
      </div>
    );
  }
  if (!report) return <SectionLoading message="Loading founders offer…" />;
  const p = report.promo;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-bold text-slate-900">Founders offer — first five at $49</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          $50 off the first invoice via Stripe Promotion Code (max_redemptions=5 is the global
          concurrency authority). Stripe-side redemption state; QA / admin / test rows excluded.
        </p>
      </div>
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Founders spots redeemed
          </p>
          <p className="mt-1 text-base font-bold tabular-nums text-slate-900">
            {p ? `${p.timesRedeemed} / ${p.maxRedemptions}` : "—"}
          </p>
          <p className="text-[10px] text-slate-400">
            {p ? `${p.remaining} remaining · ${p.available ? "active" : "exhausted/off"}` : "promo not wired"}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Founders subscriptions
          </p>
          <p className="mt-1 text-base font-bold tabular-nums text-slate-900">
            {report.foundersSubscriptions}
          </p>
          <p className="text-[10px] text-slate-400">offer_code = first_five_49 (webhook-derived)</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            First-month MRR-equivalent
          </p>
          <p className="mt-1 text-base font-bold tabular-nums text-slate-900">
            {fmtUsd(report.firstMonthMrrCents)}
          </p>
          <p className="text-[10px] text-slate-400">first paid invoice only ($49 each)</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Contracted recurring MRR
          </p>
          <p className="mt-1 text-base font-bold tabular-nums text-slate-900">
            {fmtUsd(report.contractedRecurringMrrCents)}
          </p>
          <p className="text-[10px] text-slate-400">
            $99 × {report.activeSubscriptions} active sub(s) — run rate stays $99 after month 1
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Phase B.1 acquisition funnel panel — 4 stage rows (unique visitors) + a
 * Conversion line (Purchased ÷ Landing, 0-guarded) above the source
 * breakdown (unique landing visitors per source + per-source
 * checkout/purchased mini-columns). Read-only from the admin endpoint.
 */
function AcquisitionFunnelPanel({
  funnel,
  error,
}: {
  funnel: AcquisitionFunnel | null;
  error: string;
}) {
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error}
      </div>
    );
  }
  if (!funnel) {
    return (
      <SectionLoading message="Loading acquisition funnel…" />
    );
  }
  const stageCount = (key: string) => funnel.stages.find((s) => s.key === key)?.count ?? 0;
  const landing = stageCount("landing");
  const purchased = stageCount("purchased");
  const conversion =
    funnel.conversionRatePct != null ? `${funnel.conversionRatePct.toFixed(1)}%` : "—";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-bold text-slate-900">Bid Scout acquisition funnel</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Unique visitors per stage · last 30 days · the success page never
          counts as a purchase (webhook-confirmed only). QA / admin / test excluded.
        </p>
      </div>
      <div className="grid gap-6 px-5 py-4 lg:grid-cols-2">
        <div>
          <table className="w-full text-sm">
            <tbody>
              {funnel.stages.map((s) => (
                <tr key={s.key} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 pr-3 text-slate-600">{s.label}</td>
                  <td className="py-2 text-right text-base font-bold tabular-nums text-slate-900">
                    {s.count}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="py-2 pr-3 font-semibold text-slate-700">
                  Conversion <span className="font-normal text-slate-400">(Purchased ÷ Landing)</span>
                </td>
                <td className="py-2 text-right text-base font-bold tabular-nums text-blue-700">
                  {conversion}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
            Purchased counts Stripe-webhook-confirmed purchases (exactly-once
            <span className="mx-0.5">·</span>
            webhook rows carry no visitor id, so the row counts purchases, not
            visitors). Landing = {landing} unique visitor(s) in window.
          </p>
        </div>
        <div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                <th className="pb-1.5 font-medium">Traffic source</th>
                <th className="pb-1.5 text-right font-medium">Landing</th>
                <th className="pb-1.5 text-right font-medium">Checkout</th>
                <th className="pb-1.5 text-right font-medium">Purchased</th>
              </tr>
            </thead>
            <tbody>
              {funnel.sources.map((s) => (
                <tr key={s.bucket} className="border-b border-slate-50 last:border-0">
                  <td className="py-1.5 pr-3 text-slate-600">{s.label}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-900">{s.landing}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-900">{s.checkout_started}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-900">{s.purchased}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
            Bucketing: facebook (source/fbclid) · email/outreach (utm_source
            email-style or ESP referrer) · dashboard/homepage (first-party
            referrer path or the CTA placement) · everything else =
            other/direct. Refreshes never inflate (unique visitors).
          </p>
        </div>
      </div>
    </div>
  );
}

function BidScoutAdminPage() {
  const [status, setStatus] = useState<StatusOption>("active");
  const [data, setData] = useState<SubscriptionsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Founders offer report (non-blocking — the fulfillment table must render
  // even when the report fetch fails).
  const [founders, setFounders] = useState<FoundersReport | null>(null);
  const [foundersError, setFoundersError] = useState("");
  // Phase B.1 acquisition funnel (non-blocking — the fulfillment table must
  // render even when the funnel fetch fails).
  const [funnel, setFunnel] = useState<AcquisitionFunnel | null>(null);
  const [funnelError, setFunnelError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setFunnelError("");
    setFoundersError("");
    fetchSubscriptions(status)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load subscriptions"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    fetchAcquisitionFunnel()
      .then((f) => { if (!cancelled) setFunnel(f); })
      .catch((err) => { if (!cancelled) setFunnelError(err instanceof Error ? err.message : "Failed to load acquisition funnel"); });
    fetchFoundersReport()
      .then((r) => { if (!cancelled) setFounders(r); })
      .catch((err) => { if (!cancelled) setFoundersError(err instanceof Error ? err.message : "Failed to load founders offer"); });
    return () => { cancelled = true; };
  }, [status]);

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader scoreboard={<MrrScoreboard />} />
      <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Bid Scout</h1>
            <p className="mt-1 text-xs text-slate-500">
              Fulfillment — $99/mo assisted-service subscriptions (separate from the self-serve funnel). QA/admin/test
              rows excluded.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="bs-status" className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Status
            </label>
            <select
              id="bs-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusOption)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <AdminTabs active="bid-scout" />

        <FoundersOfferPanel report={founders} error={foundersError} />

        <AcquisitionFunnelPanel funnel={funnel} error={funnelError} />

        {error ? (
          <SectionError message={error} />
        ) : loading || !data ? (
          <SectionLoading message="Loading Bid Scout subscriptions…" />
        ) : data.subscriptions.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-700">No {data.status} Bid Scout subscriptions right now.</p>
            <p className="mt-1 text-xs text-slate-400">
              The first {data.status === "active" ? "paying" : data.status} row appears here as soon as one exists —
              oldest first.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Capabilities</th>
                  <th className="px-4 py-3 font-medium">NAICS</th>
                  <th className="px-4 py-3 font-medium">Certs</th>
                  <th className="px-4 py-3 font-medium">Target states</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Stripe sub</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.subscriptions.map((s) => (
                  <tr key={s.id} className="border-t border-slate-50 align-top hover:bg-blue-50/30">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{s.company_name ?? "—"}</p>
                      {s.website && (
                        <p className="mt-0.5 text-[11px] text-blue-600">{s.website}</p>
                      )}
                      <p className="mt-0.5 text-[10px] text-slate-400" title={s.id}>id {s.id.slice(0, 8)}…</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-700">{s.email ?? "—"}</p>
                      {s.user_id && <p className="mt-0.5 text-[10px] text-slate-400">user {s.user_id}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="max-w-[260px] text-xs leading-relaxed text-slate-600">{s.capabilities ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">{s.naics_codes ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">{s.certifications ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">{s.target_states ?? "—"}</td>
                    <td className="px-4 py-3">
                      <p className="max-w-[200px] text-xs leading-relaxed text-slate-600">{s.notes ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[s.status ?? ""] ?? "bg-slate-100 text-slate-600"}`}>
                        {s.status ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{s.source ?? "—"}</td>
                    <td className="px-4 py-3 text-xs font-mono text-slate-500">{s.stripe_subscription_id ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{timeFmt(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-slate-100 px-4 py-2.5 text-[10px] text-slate-400">
              {data.subscriptions.length} row(s) · sorted oldest first (created_at ASC) · status filter default = active ·
              every row read live from bid_scout_subscriptions (QA/admin/test emails excluded).
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export const Route = createFileRoute("/admin/bid-scout")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: BidScoutAdminPage,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Bid Scout | Admin | Contrax" }] }),
});