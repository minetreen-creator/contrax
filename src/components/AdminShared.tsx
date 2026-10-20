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
import { LayoutDashboard, Users, Target, Wallet, Settings2, ArrowUpRight, ShieldCheck } from "lucide-react";

// ── Admin page header (shared) ───────────────────────────────────────────────
export function AdminHeader({ scoreboard }: { scoreboard?: ReactNode }) {
  return (
    <header className="admin-header sticky top-0 z-10">
      <div className="admin-header-inner">
        <a href="/" className="admin-brand">
          <span className="admin-logo"><img src="/logo.png" alt="Contrax" className="h-8 w-auto" /></span>
          <span className="admin-brand-copy">CONTRAX<span>OWNER CONSOLE</span></span>
        </a>
        <div className="admin-header-actions">
          {scoreboard}
          <span className="admin-access"><ShieldCheck size={14} aria-hidden="true" /> Admin</span>
          <a href="/dashboard" className="admin-dashboard-link">Dashboard <ArrowUpRight size={16} aria-hidden="true" /></a>
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
export type AdminTab = "overview" | "live" | "radar-leads" | "autopsy" | "visitors" | "signups" | "customers" | "payments" | "bid-scout" | "bid-fit-reviews" | "nonprofits" | "data-access" | "founding-businesses";

export type AdminSection = "Overview" | "Visitors" | "Leads & Signups" | "Revenue" | "Operations";

/** Every admin page, grouped into five sections (owner 2026-10-06: 11 tabs was too many). */
export const ADMIN_TABS: { key: AdminTab; label: string; href: string; group: AdminSection }[] = [
  { key: "overview", label: "Overview", href: "/admin", group: "Overview" },
  { key: "live", label: "Live", href: "/admin/live", group: "Overview" },
  { key: "visitors", label: "Visitors", href: "/admin/journeys", group: "Visitors" },
  { key: "signups", label: "Signups", href: "/admin/signups", group: "Leads & Signups" },
  { key: "radar-leads", label: "Radar Leads", href: "/admin/radar-leads", group: "Leads & Signups" },
  { key: "autopsy", label: "Autopsy", href: "/admin/autopsy", group: "Leads & Signups" },
  { key: "customers", label: "Customers", href: "/admin/customers", group: "Revenue" },
  { key: "payments", label: "Contrax Payments", href: "/admin/payments", group: "Revenue" },
  { key: "bid-scout", label: "Bid Scout", href: "/admin/bid-scout", group: "Revenue" },
  { key: "founding-businesses", label: "Founding Businesses", href: "/admin/founding-businesses", group: "Revenue" },
  { key: "data-access", label: "Data API", href: "/admin/data-access", group: "Revenue" },
  { key: "bid-fit-reviews", label: "Bid Fit Reviews", href: "/admin/bid-fit-reviews", group: "Operations" },
  // Nonprofit Free phase 2 unit B — the human review queue. A review surface nobody can
  // navigate to is not a review surface (owner lock: manual reviews with a 3-business-day
  // SLA), so the queue is reachable from every admin page.
  { key: "nonprofits", label: "Nonprofit Reviews", href: "/admin/nonprofits", group: "Operations" },
];

export const ADMIN_SECTIONS: AdminSection[] = ["Overview", "Visitors", "Leads & Signups", "Revenue", "Operations"];

const SECTION_ICONS = { Overview: LayoutDashboard, Visitors: Users, "Leads & Signups": Target, Revenue: Wallet, Operations: Settings2 };

export function AdminTabs({ active }: { active: AdminTab }) {
  const activeGroup = ADMIN_TABS.find((t) => t.key === active)?.group ?? "Overview";
  const pages = ADMIN_TABS.filter((t) => t.group === activeGroup);
  return (
    <nav aria-label="Admin sections" className="admin-nav space-y-3">
      <div className="admin-section-tabs">
        {ADMIN_SECTIONS.map((group) => {
          const first = ADMIN_TABS.find((t) => t.group === group)!;
          const on = group === activeGroup;
          const Icon = SECTION_ICONS[group];
          return (
            <a
              key={group}
              href={first.href}
              aria-current={on && first.key === active ? "page" : undefined}
              className={`admin-section-tab ${on ? "is-active" : ""}`}
            >
              <Icon size={17} aria-hidden="true" /> {group}
            </a>
          );
        })}
      </div>
      {pages.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {pages.map((t) => (
            <a
              key={t.key}
              href={t.href}
              aria-current={active === t.key ? "page" : undefined}
              className={`admin-page-tab ${active === t.key ? "is-active" : ""}`}
            >
              {t.label}
            </a>
          ))}
        </div>
      )}
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
    <div role="status" className="admin-loading rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600"><span className="admin-loading-dot" aria-hidden="true" />{message}</div>
  );
}
