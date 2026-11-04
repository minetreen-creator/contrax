/**
 * Investor numbers (owner 2026-11-04: "yes add the investor numbers panel",
 * after asking whether the first sale changed the company's valuation). The
 * figures investors price an early company on, from data Contrax already has:
 * paying customers, monthly recurring revenue, recent revenue, week-over-week
 * sales growth, the pass-to-$19 renewal rate, and customers ever. PURE: the
 * live-console API gathers the inputs.
 */

export interface PaidSession {
  created: number;
  amount_total?: number | null;
  payment_status?: string | null;
  customer_details?: { email?: string | null } | null;
  metadata?: Record<string, string> | null;
}

export interface InvestorNumbers {
  /** Accounts paying right now: a running $5 pass or an active subscription. */
  payingCustomers: number;
  /** Monthly recurring revenue in dollars: active subscriptions x monthly list price. */
  mrr: number;
  /** Real (non-test, non-probe) paid revenue in dollars. */
  revenue30d: number;
  revenue7d: number;
  revenuePrev7d: number;
  /** Paid checkouts this week and the week before. */
  sales7d: number;
  salesPrev7d: number;
  /** Passes that went on to $19/month, out of passes that have run out. */
  renewal: { continued: number; ended: number; rate: number | null };
  /** Accounts that have ever paid. */
  customersEver: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** A real paid checkout: paid, not a test or owner account, not the daily path-check probe. */
export function isRealSale(s: PaidSession, isAdmin: (email: string) => boolean): boolean {
  if (s.payment_status !== "paid") return false;
  if (s.metadata?.probe) return false;
  const email = String(s.customer_details?.email ?? "").trim().toLowerCase();
  if (email && (isAdmin(email) || email.endsWith("@test.contrax"))) return false;
  return true;
}

export function revenueWindows(sessions: readonly PaidSession[], isAdmin: (email: string) => boolean, nowMs: number) {
  let revenue30d = 0;
  let revenue7d = 0;
  let revenuePrev7d = 0;
  let sales7d = 0;
  let salesPrev7d = 0;
  for (const s of sessions) {
    if (!isRealSale(s, isAdmin)) continue;
    const age = nowMs - s.created * 1000;
    if (age < 0) continue;
    const amount = Number(s.amount_total ?? 0) / 100;
    if (age < 30 * DAY) revenue30d += amount;
    if (age < 7 * DAY) {
      revenue7d += amount;
      sales7d++;
    } else if (age < 14 * DAY) {
      revenuePrev7d += amount;
      salesPrev7d++;
    }
  }
  return { revenue30d, revenue7d, revenuePrev7d, sales7d, salesPrev7d };
}

/** Monthly recurring revenue from active subscription counts by plan. */
export function monthlyRecurring(
  byTier: readonly { plan_tier: string | null; n: number }[],
  prices: Partial<Record<string, number>>,
): number {
  return byTier.reduce((sum, r) => sum + (prices[String(r.plan_tier ?? "")] ?? 0) * Number(r.n || 0), 0);
}

export function renewalRate(continued: number, ended: number): { continued: number; ended: number; rate: number | null } {
  const done = continued + ended;
  return { continued, ended, rate: done > 0 ? continued / done : null };
}

/** "+50%", "new" (nothing the week before), "flat" or "-25%". */
export function weekGrowthLabel(current: number, previous: number): string {
  if (previous <= 0) return current > 0 ? "new" : "flat";
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return "flat";
  return (pct > 0 ? "+" : "") + pct + "%";
}

/** "$5", "$19", "$12.50". */
export function dollars(n: number): string {
  const cents = Math.round(n * 100) % 100 !== 0;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
}
