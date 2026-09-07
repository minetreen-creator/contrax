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
  source: "stripe-live" | "app-db";
  truncated: boolean;
  tiers: { tier: string; customers: number; mrrCents: number }[];
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
export type AdminTab = "overview" | "radar-leads" | "autopsy" | "visitors" | "signups" | "customers";

export const ADMIN_TABS: { key: AdminTab; label: string; href: string }[] = [
  { key: "overview", label: "Overview", href: "/admin" },
  { key: "radar-leads", label: "Radar Leads", href: "/admin/radar-leads" },
  { key: "autopsy", label: "Autopsy", href: "/admin/autopsy" },
  { key: "visitors", label: "Visitors", href: "/admin/journeys" },
  { key: "signups", label: "Signups", href: "/admin/signups" },
  { key: "customers", label: "Customers", href: "/admin/customers" },
];

export function AdminTabs({ active }: { active: AdminTab }) {
  return (
    <nav aria-label="Admin sections" className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
      {ADMIN_TABS.map((t) => (
        <a
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            active === t.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {t.label}
        </a>
      ))}
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
