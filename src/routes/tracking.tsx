import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect, useCallback } from "react";
import { sql } from "~/db";
import { getCurrentUser, type AuthUser } from "~/lib/auth";
import { TrialGate } from "~/components/TrialGate";
import { CERTIFICATIONS, certificationDaysRemaining, certificationStatus, fmtCertDate } from "~/lib/certifications";

// ── Types ────────────────────────────────────────────────────────────────────
interface TrackedBid {
  id: number;
  user_email: string;
  bid_id: string;
  bid_title: string;
  agency: string;
  due_date: string;
  status: string;
  last_checked: string;
  created_at: string;
  days_remaining: number;
  amendments: Amendment[];
}

interface Amendment {
  id: number;
  bid_id: string;
  change_type: string;
  old_value: string;
  new_value: string;
  detected_at: string;
}

// ── Server Functions ─────────────────────────────────────────────────────────

export const trackBid = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as any;
    if (!d || typeof d.bid_id !== "string" || typeof d.bid_title !== "string" || typeof d.agency !== "string") {
      throw new Error("Invalid track input");
    }
    return d as { bid_id: string; bid_title: string; agency: string; due_date: string };
  })
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");

    await sql()`CREATE TABLE IF NOT EXISTS tracked_bids (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_id TEXT NOT NULL, bid_title TEXT NOT NULL, agency TEXT NOT NULL, due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'tracked', last_checked TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, bid_id))`;

    await sql()`INSERT INTO tracked_bids (user_email, bid_id, bid_title, agency, due_date) VALUES (${user.email}, ${data.bid_id}, ${data.bid_title}, ${data.agency}, ${data.due_date}) ON CONFLICT (user_email, bid_id) DO UPDATE SET due_date = ${data.due_date}, bid_title = ${data.bid_title}, agency = ${data.agency}, last_checked = NOW()`;

    return { success: true };
  });

export const untrackBid = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as any;
    if (!d || typeof d.bid_id !== "string") throw new Error("Invalid untrack input");
    return d as { bid_id: string };
  })
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");
    await sql()`DELETE FROM tracked_bids WHERE user_email = ${user.email} AND bid_id = ${data.bid_id}`;
    return { success: true };
  });
// ── Certification deadline tracking ──────────────────────────────────────────
export interface CertificationDatesData {
  certifications: string[];
  certification_dates: Record<string, string>;
}
const getCertificationDates = createServerFn({ method: "GET" }).handler(
  async (): Promise<CertificationDatesData> => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS certification_dates JSONB DEFAULT '{}'::jsonb`; } catch {}
    const rows = await sql()`
      SELECT certifications, certification_dates
      FROM business_profiles WHERE user_id = ${user.id} LIMIT 1
    `;
    if (rows.length === 0) return { certifications: [], certification_dates: {} };
    const p = rows[0] as any;
    return {
      certifications: Array.isArray(p.certifications) ? p.certifications : [],
      certification_dates:
        p.certification_dates && typeof p.certification_dates === "object" && !Array.isArray(p.certification_dates)
          ? p.certification_dates
          : {},
    };
  },
);
const saveCertificationDates = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as any;
    if (!d || typeof d !== "object") throw new Error("Invalid input");
    const dates: Record<string, string> = {};
    if (d.certificationDates && typeof d.certificationDates === "object") {
      for (const [key, value] of Object.entries(d.certificationDates)) {
        if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
          dates[key] = value;
        }
      }
    }
    return { certificationDates: dates };
  })
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS certification_dates JSONB DEFAULT '{}'::jsonb`; } catch {}
    const rows = await sql()`SELECT id FROM business_profiles WHERE user_id = ${user.id} LIMIT 1`;
    if (rows.length === 0) throw new Error("No business profile found — complete onboarding first.");
    await sql()`
      UPDATE business_profiles
      SET certification_dates = ${JSON.stringify(data.certificationDates)}::jsonb,
          updated_at = NOW()
      WHERE user_id = ${user.id}
    `;
    return { success: true };
  });

const getTrackedBids = createServerFn({ method: "GET" }).handler(async (): Promise<TrackedBid[]> => {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");

  await sql()`CREATE TABLE IF NOT EXISTS tracked_bids (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_id TEXT NOT NULL, bid_title TEXT NOT NULL, agency TEXT NOT NULL, due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'tracked', last_checked TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, bid_id))`;
  await sql()`CREATE TABLE IF NOT EXISTS bid_amendments (id SERIAL PRIMARY KEY, bid_id TEXT NOT NULL, change_type TEXT NOT NULL, old_value TEXT, new_value TEXT, detected_at TIMESTAMPTZ DEFAULT NOW())`;

  const rows = await sql()`SELECT * FROM tracked_bids WHERE user_email = ${user.email} ORDER BY due_date ASC`;
  const bids: TrackedBid[] = [];

  for (const row of rows as any[]) {
    const amendmentRows = await sql()`SELECT * FROM bid_amendments WHERE bid_id = ${String(row.bid_id)} ORDER BY detected_at DESC`;
    const amendments: Amendment[] = (amendmentRows as any[]).map((a) => ({
      id: a.id,
      bid_id: String(a.bid_id),
      change_type: a.change_type,
      old_value: a.old_value || "",
      new_value: a.new_value || "",
      detected_at: String(a.detected_at),
    }));

    const days = daysUntil(row.due_date);
    bids.push({
      id: row.id,
      user_email: row.user_email,
      bid_id: String(row.bid_id),
      bid_title: row.bid_title,
      agency: row.agency,
      due_date: row.due_date,
      status: row.status,
      last_checked: String(row.last_checked),
      created_at: String(row.created_at),
      days_remaining: days,
      amendments,
    });
  }

  return bids;
});

const getAmendments = createServerFn({ method: "GET" })
  .validator((data: unknown) => {
    const d = data as any;
    if (!d || typeof d.bid_id !== "string") throw new Error("bid_id required");
    return d as { bid_id: string };
  })
  .handler(async ({ data }) => {
    await sql()`CREATE TABLE IF NOT EXISTS bid_amendments (id SERIAL PRIMARY KEY, bid_id TEXT NOT NULL, change_type TEXT NOT NULL, old_value TEXT, new_value TEXT, detected_at TIMESTAMPTZ DEFAULT NOW())`;
    const rows = await sql()`SELECT * FROM bid_amendments WHERE bid_id = ${data.bid_id} ORDER BY detected_at DESC`;
    return (rows as any[]).map((a) => ({
      id: a.id,
      bid_id: String(a.bid_id),
      change_type: a.change_type,
      old_value: a.old_value || "",
      new_value: a.new_value || "",
      detected_at: String(a.detected_at),
    })) as Amendment[];
  });

// ── Helpers ──────────────────────────────────────────────────────────────────
function daysUntil(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function countdownLabel(days: number) {
  if (days < 0) return { label: "Closed", color: "text-slate-500 bg-slate-100" };
  if (days === 0) return { label: "Due today!", color: "text-red-700 bg-red-100" };
  if (days <= 3) return { label: `${days}d left`, color: "text-red-700 bg-red-100" };
  if (days <= 7) return { label: `${days}d left`, color: "text-amber-700 bg-amber-100" };
  return { label: `${days}d left`, color: "text-green-700 bg-green-100" };
}

function deadlineColor(days: number) {
  if (days < 0) return "text-slate-400";
  if (days <= 3) return "text-red-600";
  if (days <= 7) return "text-amber-600";
  return "text-green-600";
}

function changeTypeIcon(type: string) {
  if (type === "deadline") return "📅";
  if (type === "description") return "📝";
  if (type === "value") return "💰";
  return "📋";
}

function changeTypeLabel(type: string) {
  if (type === "deadline") return "Deadline changed";
  if (type === "description") return "Description updated";
  if (type === "value") return "Value changed";
  return "Amendment posted";
}

// ── Grouping helpers ─────────────────────────────────────────────────────────
interface CalendarGroup {
  label: string;
  bids: TrackedBid[];
}

function groupByDeadline(bids: TrackedBid[]): CalendarGroup[] {
  const now = new Date();
  const startOfWeek = (d: Date) => {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
    return new Date(d.getFullYear(), d.getMonth(), diff);
  };
  const endOfWeek = (d: Date) => {
    const start = startOfWeek(d);
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  };

  const thisWeekStart = startOfWeek(now);
  const thisWeekEnd = endOfWeek(now);
  const nextWeekStart = new Date(thisWeekEnd.getTime() + 86400000);
  const nextWeekEnd = new Date(nextWeekStart.getTime() + 6 * 86400000);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const groups: CalendarGroup[] = [
    { label: "This Week", bids: [] },
    { label: "Next Week", bids: [] },
    { label: "This Month", bids: [] },
    { label: "Later", bids: [] },
    { label: "Past", bids: [] },
  ];

  for (const bid of bids) {
    const d = new Date(bid.due_date);
    if (d < now) {
      groups[4].bids.push(bid);
    } else if (d <= thisWeekEnd) {
      groups[0].bids.push(bid);
    } else if (d <= nextWeekEnd) {
      groups[1].bids.push(bid);
    } else if (d <= monthEnd) {
      groups[2].bids.push(bid);
    } else {
      groups[3].bids.push(bid);
    }
  }

  return groups.filter((g) => g.bids.length > 0);
}

// ── Route ────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/tracking")({
  loader: () => getCurrentUser(),
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" },{ title: "Bid Tracking | Contrax" }],
  }),
  component: TrackingPageGated,
});

/** Auth + trial gate: redirects logged-out users; upgrade prompt for expired trials. */
function TrackingPageGated() {
  const currentUser = Route.useLoaderData() as AuthUser | null;
  const navigate = useNavigate();
  if (!currentUser) {
    navigate({ to: "/login" });
    return null;
  }
  return (
    <TrialGate>
      <TrackingPage currentUser={currentUser} />
    </TrialGate>
  );
}

// ── Loading Skeleton ─────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="h-8 w-28 bg-slate-200 rounded-lg animate-pulse" />
          <div className="h-5 w-16 bg-slate-200 rounded animate-pulse" />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <div className="h-7 w-48 bg-slate-200 rounded animate-pulse" />
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="h-5 w-3/4 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-1/3 bg-slate-100 rounded animate-pulse" />
        </div>
      </main>
    </div>
  );
}

// ── Empty State ──────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="text-center py-16">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 mx-auto mb-4">
        <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-slate-700">No tracked bids yet</h3>
      <p className="mt-2 text-sm text-slate-500 max-w-sm mx-auto">
        Track bids from your dashboard to monitor deadlines, amendments, and stay on top of opportunities.
      </p>
      <a
        href="/awards"
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 active:scale-[0.98] transition-all"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        Browse opportunities
      </a>
    </div>
  );
}

// ── Certifications Panel ────────────────────────────────────────────────────
function CertificationsPanel({
  data,
  loading,
  saving,
  error,
  dates,
  onDateChange,
  onSave,
}: {
  data: CertificationDatesData | null;
  loading: boolean;
  saving: boolean;
  error: string;
  dates: Record<string, string>;
  onDateChange: (cert: string, date: string) => void;
  onSave: () => void;
}) {
  const held = (data?.certifications ?? []).filter((c) =>
    CERTIFICATIONS.some((m) => m.value === c),
  );
  if (loading && !data) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
        Loading your certifications...
      </div>
    );
  }
  if (!data || held.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
          <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-slate-700">No certifications tracked yet</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
          Add the set-aside certifications your business holds (8(a), SDVOSB, WOSB, HUBZone) and we&apos;ll track renewal deadlines for you.
        </p>
        <a href="/settings" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 active:scale-[0.98] transition-all">
          Manage Certifications
        </a>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">🛡️ Certification Renewals</h2>
          <p className="mt-1 text-sm text-slate-500">
            Keep expiration dates current — expired certifications can disqualify you from set-aside contracts.
          </p>
        </div>
        <span className="inline-flex w-fit items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
          {held.length} tracked
        </span>
      </div>
      {error && (
        <div className="mb-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      )}
      <div className="space-y-3">
        {held.map((cert) => {
          const meta = CERTIFICATIONS.find((m) => m.value === cert);
          const date = dates[cert] ?? "";
          const days = certificationDaysRemaining(date);
          const status = certificationStatus(days);
          return (
            <div key={cert} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-slate-200 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900">{meta?.label ?? cert}</p>
                {meta?.cadence && <p className="mt-0.5 text-xs text-slate-500">{meta.cadence}</p>}
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => onDateChange(cert, e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <span className={`inline-flex w-fit shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-bold ${status.badge}`}>
                  {status.label}
                </span>
              </div>
              <p className={`sm:w-40 shrink-0 text-right text-xs font-medium ${status.text}`}>
                {status.kind === "missing"
                  ? "Set an expiration date"
                  : status.kind === "expired"
                    ? `Expired ${Math.abs(days)} day${Math.abs(days) !== 1 ? "s" : ""} ago`
                    : days === 0
                      ? "Expires today"
                      : `${days} day${days !== 1 ? "s" : ""} left`}
              </p>
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <p className="text-xs text-slate-400">
          Dates are stored on your business profile and appear on the dashboard.
        </p>
        <div className="flex gap-3">
          <a href="/settings" className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Full profile settings
          </a>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save dates"}
          </button>
        </div>
      </div>
    </div>
  );
}
// ── Component ────────────────────────────────────────────────────────────────
function TrackingPage({ currentUser }: { currentUser: AuthUser }) {
  const [bids, setBids] = useState<TrackedBid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [untracking, setUntracking] = useState<Set<string>>(new Set());
  const [expandedBid, setExpandedBid] = useState<string | null>(null);
  // Certification tracking state
  const [tab, setTab] = useState<"bids" | "certifications">(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "certifications"
      ? "certifications"
      : "bids",
  );
  const [certData, setCertData] = useState<CertificationDatesData | null>(null);
  const [certLoading, setCertLoading] = useState(false);
  const [certSaving, setCertSaving] = useState(false);
  const [certError, setCertError] = useState("");
  const [certDates, setCertDates] = useState<Record<string, string>>({});
  const loadCerts = useCallback(async () => {
    setCertLoading(true);
    setCertError("");
    try {
      const result = await getCertificationDates();
      setCertData(result);
      setCertDates({ ...(result.certification_dates ?? {}) });
    } catch {
      setCertError("Couldn't load your certifications.");
    } finally {
      setCertLoading(false);
    }
  }, []);
  useEffect(() => {
    if (tab === "certifications" && !certData) loadCerts();
  }, [tab, certData, loadCerts]);
  const saveCerts = useCallback(async () => {
    setCertSaving(true);
    setCertError("");
    try {
      await saveCertificationDates({ certificationDates: certDates });
      const result = await getCertificationDates();
      setCertData(result);
      setCertDates({ ...(result.certification_dates ?? {}) });
    } catch {
      setCertError("Couldn't save certification dates.");
    } finally {
      setCertSaving(false);
    }
  }, [certDates]);

  const loadBids = useCallback(async () => {
    try {
      const result = await getTrackedBids();
      setBids(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tracked bids");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBids(); }, [loadBids]);

  const doUntrack = useCallback(async (bidId: string) => {
    setUntracking((p) => new Set(p).add(bidId));
    try {
      await untrackBid({ data: { bid_id: bidId } });
      setBids((prev) => prev.filter((b) => b.bid_id !== bidId));
      setExpandedBid(null);
    } catch {} finally {
      setUntracking((p) => { const n = new Set(p); n.delete(bidId); return n; });
    }
  }, []);

  const activeBids = bids.filter((b) => b.days_remaining >= 0);
  const pastBids = bids.filter((b) => b.days_remaining < 0);
  const urgentCount = bids.filter((b) => b.days_remaining >= 0 && b.days_remaining <= 3).length;

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-2">
            <img src="/logo.png" alt="Contrax" className="h-8 w-auto" />
          </a>
          <div className="flex items-center gap-4">
            <a href="/dashboard" className="text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors">Dashboard</a>
            <a href="/workspace" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">Team</a>
            <span className="text-sm text-slate-500 hidden sm:inline">{currentUser.email}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {/* Page Heading */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">📅 Bid Tracking</h1>
          <p className="mt-1 text-sm text-slate-500">
            Monitor bid deadlines and certification renewals in one place.
          </p>
        </div>
        {/* Tabs */}
        <div className="mb-6 flex w-fit gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setTab("bids")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${tab === "bids" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            Tracked Bids
          </button>
          <button
            type="button"
            onClick={() => setTab("certifications")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${tab === "certifications" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            Certifications
          </button>
        </div>
        {tab === "bids" ? (
          <>
        {error && (
          <div className="mb-6 rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">
            {error}
            <button type="button" onClick={() => { setError(""); loadBids(); }} className="ml-2 underline hover:no-underline">Retry</button>
          </div>
        )}

        {/* Urgent Alert */}
        {urgentCount > 0 && (
          <div className="mb-6 rounded-2xl border-2 border-red-200 bg-gradient-to-r from-red-50 to-rose-50 p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <p className="font-bold text-red-800">
                  {urgentCount} bid{urgentCount !== 1 ? "s" : ""} closing soon
                </p>
                <p className="mt-1 text-sm text-red-700">
                  {urgentCount === 1 ? "One tracked bid" : `${urgentCount} tracked bids`} due within 3 days. Review now to avoid missing deadlines.
                </p>
              </div>
            </div>
          </div>
        )}

        {bids.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-8 lg:grid-cols-3">
            {/* Left Column — Tracked Bids + Calendar */}
            <div className="lg:col-span-2 space-y-8">
              {/* Active Tracked Bids */}
              <section>
                <h2 className="text-lg font-bold text-slate-900 mb-4">
                  Tracked Bids
                  <span className="ml-2 text-sm font-normal text-slate-400">({activeBids.length} active{bids.length > activeBids.length ? `, ${bids.length - activeBids.length} closed` : ""})</span>
                </h2>
                {activeBids.length === 0 && (
                  <p className="text-sm text-slate-500 py-4">All tracked bids have closed. <a href="/awards" className="font-semibold text-amber-700 hover:underline">Browse new opportunities</a>.</p>
                )}
                <div className="space-y-3">
                  {activeBids.map((bid) => {
                    const cd = countdownLabel(bid.days_remaining);
                    const dc = deadlineColor(bid.days_remaining);
                    const isExpanded = expandedBid === bid.bid_id;
                    const isUntracking = untracking.has(bid.bid_id);

                    return (
                      <div key={bid.bid_id} className={`rounded-xl border bg-white shadow-sm transition-all ${isExpanded ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300"}`}>
                        <button
                          type="button"
                          onClick={() => setExpandedBid(isExpanded ? null : bid.bid_id)}
                          className="w-full text-left p-4"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <h3 className="font-semibold text-slate-900 truncate">{bid.bid_title}</h3>
                              <p className="mt-0.5 text-sm text-slate-500">{bid.agency}</p>
                              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                                <span className={`inline-flex items-center gap-1 font-medium ${dc}`}>
                                  🕐 {bid.days_remaining === 0 ? "Due today" : `${bid.days_remaining} day${bid.days_remaining !== 1 ? "s" : ""} remaining`}
                                </span>
                                <span className="text-slate-400">Due {fmtDate(bid.due_date)}</span>
                                {bid.amendments.length > 0 && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                                    📋 {bid.amendments.length} amendment{bid.amendments.length !== 1 ? "s" : ""}
                                  </span>
                                )}
                              </div>
                            </div>
                            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${cd.color}`}>{cd.label}</span>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                              <div><p className="font-medium text-slate-400">Due Date</p><p className="text-slate-800">{fmtDate(bid.due_date)}</p></div>
                              <div><p className="font-medium text-slate-400">Status</p><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${bid.status === "amended" ? "bg-purple-100 text-purple-700" : bid.status === "extended" ? "bg-blue-100 text-blue-700" : bid.status === "closed" ? "bg-slate-100 text-slate-600" : "bg-green-100 text-green-700"}`}>{bid.status}</span></div>
                              <div><p className="font-medium text-slate-400">Last Checked</p><p className="text-slate-800">{fmtDateTime(bid.last_checked)}</p></div>
                              <div><p className="font-medium text-slate-400">Tracked Since</p><p className="text-slate-800">{fmtDate(bid.created_at)}</p></div>
                            </div>
                            <div className="flex gap-3 pt-2">
                              <a href={`/dashboard`} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">View on Dashboard →</a>
                              <button
                                type="button"
                                onClick={() => doUntrack(bid.bid_id)}
                                disabled={isUntracking}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                              >
                                {isUntracking ? "Removing..." : "Untrack"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Past/Closed Bids */}
                {pastBids.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Closed</h3>
                    <div className="space-y-2">
                      {pastBids.map((bid) => (
                        <div key={bid.bid_id} className="rounded-lg border border-slate-100 bg-white p-3 opacity-60 hover:opacity-100 transition-opacity">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium text-slate-600 truncate text-sm">{bid.bid_title}</p>
                              <p className="text-xs text-slate-400">{bid.agency} · Due {fmtDate(bid.due_date)}</p>
                            </div>
                            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">Closed</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* Deadline Calendar */}
              <section>
                <h2 className="text-lg font-bold text-slate-900 mb-4">📆 Deadline Calendar</h2>
                <div className="space-y-6">
                  {groupByDeadline(bids).map((group) => (
                    <div key={group.label}>
                      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">{group.label}</h3>
                      <div className="space-y-2">
                        {group.bids.map((bid) => {
                          const dc = deadlineColor(bid.days_remaining);
                          return (
                            <div key={bid.bid_id} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-white p-3">
                              <div className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg ${bid.days_remaining < 0 ? "bg-slate-100" : bid.days_remaining <= 3 ? "bg-red-100" : bid.days_remaining <= 7 ? "bg-amber-100" : "bg-green-100"}`}>
                                <span className="text-sm font-bold leading-none">{new Date(bid.due_date).getDate()}</span>
                                <span className="text-[10px] font-medium text-slate-500">{new Date(bid.due_date).toLocaleString("en-US", { month: "short" })}</span>
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-slate-800 truncate text-sm">{bid.bid_title}</p>
                                <p className="text-xs text-slate-500">{bid.agency}</p>
                              </div>
                              <span className={`shrink-0 text-xs font-semibold ${dc}`}>
                                {bid.days_remaining < 0 ? "Past" : bid.days_remaining === 0 ? "Today" : `${bid.days_remaining}d`}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {bids.length === 0 && (
                    <p className="text-sm text-slate-500 py-4">Track bids to see them on your deadline calendar.</p>
                  )}
                </div>
              </section>
            </div>

            {/* Right Column — Amendment Feed */}
            <div className="space-y-6">
              <section>
                <h2 className="text-lg font-bold text-slate-900 mb-4">📋 Amendment Feed</h2>
                {(() => {
                  const allAmendments = bids.flatMap((b) =>
                    b.amendments.map((a) => ({ ...a, bid_title: b.bid_title, agency: b.agency }))
                  ).sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime());

                  if (allAmendments.length === 0) {
                    return (
                      <div className="rounded-xl border border-slate-100 bg-white p-6 text-center">
                        <p className="text-sm text-slate-500">No amendments detected yet.</p>
                        <p className="text-xs text-slate-400 mt-1">Changes will appear here when bid sync detects updates to your tracked bids.</p>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-3">
                      {allAmendments.map((am) => (
                        <div key={am.id} className="rounded-xl border border-purple-100 bg-white p-4 shadow-sm">
                          <div className="flex items-start gap-2 mb-2">
                            <span className="text-lg">{changeTypeIcon(am.change_type)}</span>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-purple-800">{changeTypeLabel(am.change_type)}</p>
                              <p className="text-xs text-slate-500 truncate">{am.bid_title} · {am.agency}</p>
                            </div>
                          </div>
                          {(am.old_value || am.new_value) && (
                            <div className="mt-2 rounded-lg bg-slate-50 p-2.5 text-xs space-y-1">
                              {am.old_value && (
                                <p className="text-slate-500 line-through">Was: {am.old_value}</p>
                              )}
                              {am.new_value && (
                                <p className="text-slate-800 font-medium">Now: {am.new_value}</p>
                              )}
                            </div>
                          )}
                          <p className="mt-2 text-[10px] text-slate-400">{fmtDateTime(am.detected_at)}</p>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </section>

              {/* Quick Stats */}
              <section>
                <h2 className="text-lg font-bold text-slate-900 mb-4">Stats</h2>
                <div className="rounded-xl border border-slate-100 bg-white p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Total tracked</span>
                    <span className="font-bold text-slate-900">{bids.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Active</span>
                    <span className="font-bold text-green-600">{activeBids.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Urgent (&lt;3 days)</span>
                    <span className={`font-bold ${urgentCount > 0 ? "text-red-600" : "text-slate-500"}`}>{urgentCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Closed</span>
                    <span className="font-bold text-slate-500">{pastBids.length}</span>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}
          </>
        ) : (
          <CertificationsPanel
            data={certData}
            loading={certLoading}
            saving={certSaving}
            error={certError}
            dates={certDates}
            onDateChange={(cert, date) => setCertDates((prev) => ({ ...prev, [cert]: date }))}
            onSave={saveCerts}
          />
        )}
      </main>
    </div>
  );
}
