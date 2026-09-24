/**
 * Shared admin-dashboard primitives (owner 2026-09-07 redesign).
 *
 * Pure UI components + fetch helpers reused across the tabbed /admin/ surface
 * and its tab pages. NO business logic, NO scoring, NO exclusions here — every
 * number arrives pre-filtered from the existing server endpoints (journeys,
 * autopsy-funnel, radar-leads-funnel, unified-funnel, finance), which already
 * apply the bot/QA/admin exclusions and PII-masking rules.
 */

import { useState, useEffect, type ReactNode } from "react";

// ── Admin page header (shared) ───────────────────────────────────────────────
export function AdminHeader({ scoreboard }: { scoreboard?: ReactNode }) {
  return (
    <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-3">
        <a href="/" className="inline-flex items-center gap-2">
          <img src="/logo.png" alt="Contrax" className="h-8 w-auto" />
        </a>
        <div className="flex items-center gap-3 sm:gap-4">
          {scoreboard}
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">Admin</span>
          <a href="/dashboard" className="text-sm font-medium text-slate-500 hover:text-slate-700">
            Dashboard &rarr;
          </a>
        </div>
      </div>
    </header>
  );
}

// ── MRR scoreboard (top-right, live from /api/admin/finance) ─────────────────
export interface FinanceResult {
  mrrCents: number;
  customerCount: number;
  /** MRR of existing Contrax plans ONLY (Bid Scout excluded — never
   *  double-counted; owner 2026-09-11). */
  existingPlanMrr: number;
  /** MRR of Bid Scout subscriptions ONLY (separate assisted-service line). */
  bidScoutMrr: number;
  /** existingPlanMrr + bidScoutMrr — equals mrrCents (the true total). */
  totalMrr: number;
  /** Distinct Bid Scout customers (reported separately from customerCount). */
  bidScoutCustomers: number;
  source: "stripe-live" | "app-db";
  truncated: boolean;
  tiers: { tier: string; customers: number; mrrCents: number }[];
  /** Separately displayed finance lines (e.g. "Bid Scout MRR"). */
  display: { label: string; amount: number; product: string }[];
  customers: { email: string; planTier: string | null; since: string | null }[];
  fetchedAt: string;
}

export async function fetchFinance(): Promise<FinanceResult> {
  const res = await fetch("/api/admin/finance");
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load finance" }));
    throw new Error(err.error || "Failed to load finance");
  }
  return res.json();
}

export function moneyWhole(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** The number we're trying to change — live MRR + customers, honestly labeled. */
export function MrrScoreboard() {
  const [fin, setFin] = useState<FinanceResult | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchFinance()
      .then((d) => { if (!cancelled) setFin(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);
  if (failed) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-400" title="Live revenue read unavailable">
        MRR: — · Customers: —
      </span>
    );
  }
  if (!fin) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-400">
        MRR: … · Customers: …
      </span>
    );
  }
  const grew = fin.customerCount > 0;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold ${grew ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}
      title={fin.source === "stripe-live" ? `Live Stripe read (${fin.fetchedAt ? new Date(fin.fetchedAt).toLocaleString() : "just now"})${fin.truncated ? " — over 100 active subscriptions, totals capped" : ""}` : "Live app-database read (Stripe unreachable — subscription rows the webhook maintains)"}
    >
      <span className="text-emerald-600">●</span>
      MRR: {moneyWhole(fin.mrrCents)}{grew ? " ↑" : ""} · Customers: {fin.customerCount}
    </span>
  );
}

// ── Tab bar ──────────────────────────────────────────────────────────────────
export type AdminTab = "overview" | "radar-leads" | "autopsy" | "visitors" | "signups" | "customers" | "bid-scout" | "nonprofits";

export const ADMIN_TABS: { key: AdminTab; label: string; href: string; group: "Command" | "Growth" | "Operations" }[] = [
  { key: "overview", label: "Overview", href: "/admin", group: "Command" },
  { key: "visitors", label: "Visitors", href: "/admin/journeys", group: "Command" },
  { key: "radar-leads", label: "Radar Leads", href: "/admin/radar-leads", group: "Growth" },
  { key: "autopsy", label: "Autopsy", href: "/admin/autopsy", group: "Growth" },
  { key: "signups", label: "Signups", href: "/admin/signups", group: "Growth" },
  { key: "customers", label: "Customers", href: "/admin/customers", group: "Growth" },
  { key: "bid-scout", label: "Bid Scout", href: "/admin/bid-scout", group: "Growth" },
  // Nonprofit Free phase 2 unit B — the human review queue. A review surface nobody can
  // navigate to is not a review surface (owner lock: manual reviews with a 3-business-day
  // SLA), so the queue is reachable from every admin page.
  { key: "nonprofits", label: "Nonprofit Reviews", href: "/admin/nonprofits", group: "Operations" },
];

export function AdminTabs({ active }: { active: AdminTab }) {
  return (
    <nav aria-label="Admin sections" className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
      <div className="flex min-w-max items-end gap-4">
        {(["Command", "Growth", "Operations"] as const).map((group) => (
          <div key={group} className="space-y-1">
            <p className="px-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{group}</p>
            <div className="flex items-center gap-1">
              {ADMIN_TABS.filter((tab) => tab.group === group).map((t) => (
                <a
                  key={t.key}
                  href={t.href}
                  aria-current={active === t.key ? "page" : undefined}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    active === t.key ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {t.label}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}

// ── Shared small components ──────────────────────────────────────────────────
export function timeFmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function dayFmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function SectionError({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{message}</div>
  );
}

export function SectionLoading({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-400">{message}</div>
  );
}
