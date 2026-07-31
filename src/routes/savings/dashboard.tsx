import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  TrendingDown,
  Activity,
  FileText,
  Calendar,
  DollarSign,
  Stethoscope,
  Sparkles,
  Loader2,
} from "lucide-react";
import { sql } from "~/db";
import { getCurrentUser, logout, type AuthUser } from "~/lib/auth";
import type { Diagnosis } from "~/data/savings";

// ── Types ──────────────────────────────────────────────────────────────────

interface SavingsDiagnosis {
  id: number;
  bill_type: string;
  provider_name: string;
  current_amount: number | null;
  diagnosis_json: Diagnosis;
  savings_prescription: string[];
  created_at: string;
}

interface SavingsBill {
  id: number;
  bill_type: string;
  provider_name: string;
  current_amount: number;
  billing_cycle: string;
  next_due_date: string | null;
  notes: string | null;
  created_at: string;
}

interface DashboardData {
  diagnoses: SavingsDiagnosis[];
  bills: SavingsBill[];
}

// ── Server Functions ───────────────────────────────────────────────────────

const fetchDashboardData = createServerFn({ method: "GET" }).handler(async (): Promise<DashboardData> => {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");

  const diagRows = await sql()`
    SELECT id, bill_type, provider_name, current_amount, diagnosis_json, savings_prescription, created_at
    FROM savings_diagnoses
    WHERE user_id = ${user.id}
    ORDER BY created_at DESC
  `;
  const diagnoses: SavingsDiagnosis[] = (diagRows as any[]).map((d) => ({
    id: d.id,
    bill_type: d.bill_type,
    provider_name: d.provider_name,
    current_amount: d.current_amount,
    diagnosis_json: typeof d.diagnosis_json === "string" ? JSON.parse(d.diagnosis_json) : d.diagnosis_json,
    savings_prescription: Array.isArray(d.savings_prescription)
      ? d.savings_prescription
      : [],
    created_at: String(d.created_at),
  }));

  const billRows = await sql()`
    SELECT id, bill_type, provider_name, current_amount, billing_cycle, next_due_date, notes, created_at
    FROM savings_bills
    WHERE user_id = ${user.id}
    ORDER BY next_due_date ASC NULLS LAST, created_at DESC
  `;
  const bills: SavingsBill[] = (billRows as any[]).map((b) => ({
    id: b.id,
    bill_type: b.bill_type,
    provider_name: b.provider_name,
    current_amount: Number(b.current_amount),
    billing_cycle: b.billing_cycle,
    next_due_date: b.next_due_date ? String(b.next_due_date).substring(0, 10) : null,
    notes: b.notes,
    created_at: String(b.created_at),
  }));

  return { diagnoses, bills };
});

const addBillFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as {
      bill_type: string;
      provider_name: string;
      current_amount: number;
      billing_cycle: string;
      next_due_date: string | null;
      notes: string | null;
    };
    if (!d.bill_type || !d.provider_name || !d.current_amount) {
      throw new Error("bill_type, provider_name, and current_amount are required");
    }
    return d;
  })
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");

    await sql()`
      INSERT INTO savings_bills (user_id, bill_type, provider_name, current_amount, billing_cycle, next_due_date, notes)
      VALUES (${user.id}, ${data.bill_type}, ${data.provider_name}, ${data.current_amount}, ${data.billing_cycle}, ${data.next_due_date || null}, ${data.notes || null})
    `;
    return { success: true };
  });

const deleteDiagnosisFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ id: (data as { id: number }).id }))
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");
    await sql()`DELETE FROM savings_diagnoses WHERE id = ${data.id} AND user_id = ${user.id}`;
    return { success: true };
  });

const deleteBillFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ id: (data as { id: number }).id }))
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");
    await sql()`DELETE FROM savings_bills WHERE id = ${data.id} AND user_id = ${user.id}`;
    return { success: true };
  });

const handleLogout = createServerFn({ method: "POST" }).handler(async () => logout());

// ── Route ──────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/savings/dashboard")({
  loader: () => getCurrentUser(),
  component: SavingsDashboard,
});

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Component ──────────────────────────────────────────────────────────────

function SavingsDashboard() {
  const currentUser = Route.useLoaderData() as AuthUser | null;
  const navigate = useNavigate();

  if (!currentUser) {
    navigate({ to: "/login" });
    return null;
  }

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  // Add bill form state
  const [showAddBill, setShowAddBill] = useState(false);
  const [newBill, setNewBill] = useState({
    bill_type: "",
    provider_name: "",
    current_amount: "",
    billing_cycle: "monthly",
    next_due_date: "",
    notes: "",
  });
  const [addingBill, setAddingBill] = useState(false);
  const [addError, setAddError] = useState("");

  // Track deleting items
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    try {
      const d = await fetchDashboardData();
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const doAddBill = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError("");
    setAddingBill(true);
    try {
      await addBillFn({
        data: {
          bill_type: newBill.bill_type,
          provider_name: newBill.provider_name,
          current_amount: parseFloat(newBill.current_amount),
          billing_cycle: newBill.billing_cycle,
          next_due_date: newBill.next_due_date || null,
          notes: newBill.notes || null,
        },
      });
      setShowAddBill(false);
      setNewBill({ bill_type: "", provider_name: "", current_amount: "", billing_cycle: "monthly", next_due_date: "", notes: "" });
      // Reload data
      await loadData();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add bill");
    } finally {
      setAddingBill(false);
    }
  };

  const doDeleteDiagnosis = async (id: number) => {
    const key = `diag-${id}`;
    setDeleting((prev) => new Set(prev).add(key));
    try {
      await deleteDiagnosisFn({ data: { id } });
      setData((prev) =>
        prev
          ? { ...prev, diagnoses: prev.diagnoses.filter((d) => d.id !== id) }
          : null
      );
    } catch {} finally {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const doDeleteBill = async (id: number) => {
    const key = `bill-${id}`;
    setDeleting((prev) => new Set(prev).add(key));
    try {
      await deleteBillFn({ data: { id } });
      setData((prev) =>
        prev
          ? { ...prev, bills: prev.bills.filter((b) => b.id !== id) }
          : null
      );
    } catch {} finally {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F7F1E1] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#6C8A55]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#F7F1E1] flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold text-[#26251f]">Something went wrong</h2>
          <p className="mt-2 text-[#6b6a63]">{error}</p>
          <button
            onClick={() => { setError(""); setLoading(true); loadData(); }}
            className="mt-4 text-sm font-medium text-[#4F6142] hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const diagnoses = data?.diagnoses ?? [];
  const bills = data?.bills ?? [];

  // Calculate total estimated annual savings from diagnoses
  const totalSavings = diagnoses.reduce((sum, d) => {
    const s = d.diagnosis_json.savings;
    // Try to extract the number from strings like "$360/year", "$1,900", "$47/month"
    const match = s.match(/[\d,]+/);
    if (match) {
      let num = parseFloat(match[0].replace(/,/g, ""));
      // If it's per month, annualize
      if (s.toLowerCase().includes("month")) {
        num *= 12;
      }
      return sum + num;
    }
    return sum;
  }, 0);

  return (
    <div className="min-h-screen bg-[#F7F1E1] text-[#26251f] font-sans">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#F7F1E1]/90 backdrop-blur-md border-b border-[#E5DDC8]">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/savings" className="inline-flex items-center gap-2 text-[14px] text-[#6b6a63] hover:text-[#4F6142] transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <a href="/savings" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#6C8A55]">
                <Stethoscope className="h-4 w-4 text-white" />
              </span>
              <span className="text-lg font-bold tracking-tight font-serif">Savings Dashboard</span>
            </a>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-[#6b6a63] hidden sm:inline">{currentUser.email}</span>
            <button
              type="button"
              onClick={async () => {
                setLoggingOut(true);
                try {
                  await handleLogout();
                  navigate({ to: "/" });
                } catch {
                  setLoggingOut(false);
                }
              }}
              disabled={loggingOut}
              className="text-sm font-medium text-[#6b6a63] hover:text-[#4F6142] disabled:opacity-50"
            >
              {loggingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Summary Cards */}
        <div className="grid sm:grid-cols-3 gap-4 mb-8">
          <div className="rounded-2xl border border-[#E7DFC9] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-lg bg-[#8FA57A]/20 flex items-center justify-center">
                <Activity className="h-4 w-4 text-[#4F6142]" />
              </div>
              <span className="text-[12px] font-semibold text-[#6b6a63] tracking-wide">
                PAST DIAGNOSES
              </span>
            </div>
            <p className="text-3xl font-serif text-[#26251f]">{diagnoses.length}</p>
          </div>
          <div className="rounded-2xl border border-[#E7DFC9] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-lg bg-[#F4EED8] flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-[#6C8A55]" />
              </div>
              <span className="text-[12px] font-semibold text-[#6b6a63] tracking-wide">
                EST. ANNUAL SAVINGS
              </span>
            </div>
            <p className="text-3xl font-serif text-[#6C8A55]">
              ${totalSavings.toLocaleString()}
            </p>
          </div>
          <div className="rounded-2xl border border-[#E7DFC9] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-lg bg-[#EAE0C4]/60 flex items-center justify-center">
                <FileText className="h-4 w-4 text-[#6b6a63]" />
              </div>
              <span className="text-[12px] font-semibold text-[#6b6a63] tracking-wide">
                TRACKED BILLS
              </span>
            </div>
            <p className="text-3xl font-serif text-[#26251f]">{bills.length}</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3 mb-10">
          <Link
            to="/savings/checkup"
            className="inline-flex items-center gap-2 rounded-full bg-[#6C8A55] hover:bg-[#5c7848] text-white font-medium px-5 py-2.5 text-[14px] shadow-sm transition-all"
          >
            <Sparkles className="h-4 w-4" />
            New Checkup
          </Link>
          <button
            type="button"
            onClick={() => setShowAddBill(!showAddBill)}
            className="inline-flex items-center gap-2 rounded-full border border-[#DDD3B6] bg-white hover:border-[#8FA57A]/60 text-[#26251f] font-medium px-5 py-2.5 text-[14px] transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Bill
          </button>
        </div>

        {/* Add Bill Form */}
        {showAddBill && (
          <div className="mb-10 rounded-2xl border border-[#E7DFC9] bg-white p-6 shadow-sm">
            <h3 className="font-serif text-xl text-[#26251f] mb-4">Add a Bill to Track</h3>
            <form onSubmit={doAddBill} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-[#6b6a63] mb-1">Bill Type *</label>
                  <input
                    type="text"
                    required
                    value={newBill.bill_type}
                    onChange={(e) => setNewBill((p) => ({ ...p, bill_type: e.target.value }))}
                    placeholder="Internet, Phone, Insurance..."
                    className="w-full rounded-xl border border-[#DDD3B6] px-4 py-2.5 text-[15px] text-[#26251f] placeholder:text-[#A9A392] focus:outline-none focus:ring-2 focus:ring-[#8FA57A]/40 focus:border-[#8FA57A]"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#6b6a63] mb-1">Provider Name *</label>
                  <input
                    type="text"
                    required
                    value={newBill.provider_name}
                    onChange={(e) => setNewBill((p) => ({ ...p, provider_name: e.target.value }))}
                    placeholder="Comcast, State Farm..."
                    className="w-full rounded-xl border border-[#DDD3B6] px-4 py-2.5 text-[15px] text-[#26251f] placeholder:text-[#A9A392] focus:outline-none focus:ring-2 focus:ring-[#8FA57A]/40 focus:border-[#8FA57A]"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#6b6a63] mb-1">Current Amount ($) *</label>
                  <input
                    type="number"
                    required
                    step="0.01"
                    min="0"
                    value={newBill.current_amount}
                    onChange={(e) => setNewBill((p) => ({ ...p, current_amount: e.target.value }))}
                    placeholder="99.99"
                    className="w-full rounded-xl border border-[#DDD3B6] px-4 py-2.5 text-[15px] text-[#26251f] placeholder:text-[#A9A392] focus:outline-none focus:ring-2 focus:ring-[#8FA57A]/40 focus:border-[#8FA57A]"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#6b6a63] mb-1">Billing Cycle</label>
                  <select
                    value={newBill.billing_cycle}
                    onChange={(e) => setNewBill((p) => ({ ...p, billing_cycle: e.target.value }))}
                    className="w-full rounded-xl border border-[#DDD3B6] px-4 py-2.5 text-[15px] text-[#26251f] focus:outline-none focus:ring-2 focus:ring-[#8FA57A]/40 focus:border-[#8FA57A] bg-white"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#6b6a63] mb-1">Next Due Date</label>
                  <input
                    type="date"
                    value={newBill.next_due_date}
                    onChange={(e) => setNewBill((p) => ({ ...p, next_due_date: e.target.value }))}
                    className="w-full rounded-xl border border-[#DDD3B6] px-4 py-2.5 text-[15px] text-[#26251f] focus:outline-none focus:ring-2 focus:ring-[#8FA57A]/40 focus:border-[#8FA57A]"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#6b6a63] mb-1">Notes</label>
                  <input
                    type="text"
                    value={newBill.notes}
                    onChange={(e) => setNewBill((p) => ({ ...p, notes: e.target.value }))}
                    placeholder="Auto-pay, bundled, etc."
                    className="w-full rounded-xl border border-[#DDD3B6] px-4 py-2.5 text-[15px] text-[#26251f] placeholder:text-[#A9A392] focus:outline-none focus:ring-2 focus:ring-[#8FA57A]/40 focus:border-[#8FA57A]"
                  />
                </div>
              </div>

              {addError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                  {addError}
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={addingBill}
                  className="inline-flex items-center gap-2 rounded-full bg-[#6C8A55] hover:bg-[#5c7848] disabled:opacity-60 text-white font-medium px-5 py-2.5 text-[14px] shadow-sm transition-all"
                >
                  {addingBill ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    "Save Bill"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAddBill(false); setAddError(""); }}
                  className="text-[14px] text-[#6b6a63] hover:text-[#4F6142]"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Diagnoses Section */}
        <section className="mb-12">
          <h2 className="font-serif text-2xl text-[#26251f] mb-4">Past Diagnoses</h2>
          {diagnoses.length === 0 ? (
            <div className="rounded-2xl border border-[#E7DFC9] bg-white p-8 text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-[#F4EED8] flex items-center justify-center mb-3">
                <Stethoscope className="h-6 w-6 text-[#6C8A55]" />
              </div>
              <p className="text-[#6b6a63]">No diagnoses yet.</p>
              <Link
                to="/savings/checkup"
                className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-medium text-[#4F6142] hover:underline"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Run your first checkup
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {diagnoses.map((d) => {
                const isDeleting = deleting.has(`diag-${d.id}`);
                return (
                  <div
                    key={d.id}
                    className="rounded-2xl border border-[#E7DFC9] bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                            d.diagnosis_json.status === "Overpaying"
                              ? "bg-[#F7D6D0] text-[#B44536]"
                              : "bg-[#EAF0DB] text-[#4F6142]"
                          }`}>
                            {d.diagnosis_json.status}
                          </span>
                          <span className="text-[12px] text-[#8B8A7F]">{fmtDateTime(d.created_at)}</span>
                        </div>
                        <h3 className="font-serif text-lg text-[#26251f]">{d.diagnosis_json.type}</h3>
                        <p className="mt-1 text-[14px] text-[#5c5b53] line-clamp-2">{d.diagnosis_json.detail}</p>
                        <div className="mt-3 flex items-center gap-4 text-[13px]">
                          <span className="inline-flex items-center gap-1 text-[#6C8A55] font-medium">
                            <TrendingDown className="h-3.5 w-3.5" />
                            {d.diagnosis_json.savings}
                          </span>
                          {d.savings_prescription.length > 0 && (
                            <span className="text-[#6b6a63]">
                              {d.savings_prescription.length} step{d.savings_prescription.length !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => doDeleteDiagnosis(d.id)}
                        disabled={isDeleting}
                        className="shrink-0 text-[#C1B896] hover:text-red-400 disabled:opacity-50 transition-colors"
                        aria-label="Delete diagnosis"
                      >
                        {isDeleting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Bills Section */}
        <section>
          <h2 className="font-serif text-2xl text-[#26251f] mb-4">Tracked Bills</h2>
          {bills.length === 0 ? (
            <div className="rounded-2xl border border-[#E7DFC9] bg-white p-8 text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-[#F4EED8] flex items-center justify-center mb-3">
                <FileText className="h-6 w-6 text-[#6C8A55]" />
              </div>
              <p className="text-[#6b6a63]">No bills tracked yet.</p>
              <button
                type="button"
                onClick={() => setShowAddBill(true)}
                className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-medium text-[#4F6142] hover:underline"
              >
                <Plus className="h-3.5 w-3.5" />
                Add your first bill
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {bills.map((b) => {
                const isDeleting = deleting.has(`bill-${b.id}`);
                return (
                  <div
                    key={b.id}
                    className="rounded-2xl border border-[#E7DFC9] bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#EAE0C4]/60 text-[#6b6a63] capitalize">
                            {b.bill_type}
                          </span>
                          <span className="text-[12px] text-[#8B8A7F] capitalize">{b.billing_cycle}</span>
                        </div>
                        <h3 className="font-serif text-lg text-[#26251f]">{b.provider_name}</h3>
                        {b.notes && (
                          <p className="mt-1 text-[14px] text-[#5c5b53]">{b.notes}</p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-4 text-[13px]">
                          <span className="inline-flex items-center gap-1 text-[#26251f] font-medium">
                            <DollarSign className="h-3.5 w-3.5 text-[#6C8A55]" />
                            ${typeof b.current_amount === "number" ? b.current_amount.toFixed(2) : b.current_amount}
                          </span>
                          {b.next_due_date && (
                            <span className="inline-flex items-center gap-1 text-[#6b6a63]">
                              <Calendar className="h-3.5 w-3.5 text-[#8B8A7F]" />
                              Next due: {fmtDate(b.next_due_date)}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => doDeleteBill(b.id)}
                        disabled={isDeleting}
                        className="shrink-0 text-[#C1B896] hover:text-red-400 disabled:opacity-50 transition-colors"
                        aria-label="Delete bill"
                      >
                        {isDeleting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
