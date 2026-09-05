/**
 * Award Autopsy + Contrax Learning (owner-ratified 2026-09-05, Option B).
 *
 * When a user logs a LOST bid, Contrax AUTOMATICALLY looks up the real
 * award/winner on USAspending (via ~/lib/fpds.getFPDSIntel — already live and
 * cached in `fpds_lookups`), produces an "Award Autopsy" card, and persists the
 * outcome so future Radar matches can show the ⚡ "learned from your previous
 * loss" memory banner (Contrax Learning).
 *
 * ── OWNER FREEMIUM GATING (exact) ─────────────────────────────────────────────
 *   Plan          | Award Autopsy        | Contrax Learning (Radar ⚡ memory)
 *   --------------+----------------------+----------------------------------
 *   Basic (free)  | 1/mo — winner + award| NEVER shown (the accumulating
 *                 | amount ONLY (demo)   | reason not to cancel)
 *   Starter $19   | 5/mo — full analysis | ✅ shown on Radar
 *   Professional  | Unlimited — deeper   | ✅
 *   Agency $199    | Everything + portfolio win-loss | ✅
 *
 * HONESTY: every number traces to a live USAspending lookup (getFPDSIntel).
 * Nothing is invented: competition count is shown only when the source
 * provides it, else "Competition: not disclosed" (USAspending v2
 * spending_by_award does not expose the offers-received count for these award
 * types, so in practice it is always "not disclosed" — the field stays
 * nullable for a future source). If FPDS returns nothing at all, the autopsy
 * is an honest "no award data found yet" fallback and the manual loss still
 * feeds the Learning Engine exactly as before.
 *
 * Allowance: the ledger mirrors the AI-brief allowance pattern
 * (src/lib/ai-brief-allowance.ts) — per-user, per-YYYY-MM row, atomic guarded
 * increment so concurrent requests can never overshoot the cap. A failed
 * lookup does NOT consume allowance. A Basic user's FIRST autopsy of the
 * month always succeeds (no hard gate on the demo).
 */
import { sql } from "~/db";
import { loadUserTrialStatus } from "~/lib/trial";
import { getFPDSIntel, type FPDSIntel } from "~/lib/fpds";

/** Per-tier monthly autopsy allowances (owner-ratified 2026-09-05). */
export const AUTOPSY_ALLOWANCE: Record<string, number> = {
  basic: 1,
  starter: 5,
  professional: Infinity,
  agency: Infinity,
};

/** Tiers that see the Contrax Learning ⚡ memory on Radar — PAID-ONLY. */
export const LEARNING_TIERS = new Set(["starter", "professional", "agency"]);

/** True for the "deeper agency/incumbent/pricing" tiers (Pro/Agency). */
export function isDeeperAutopsyTier(tier: string): boolean {
  return tier === "professional" || tier === "agency";
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS autopsy_allowance (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    billing_period TEXT NOT NULL,
    tier TEXT NOT NULL,
    autopsies_used INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, billing_period)
  )
`;
let initialized = false;
async function ensureTable(): Promise<boolean> {
  if (initialized) return true;
  try {
    const db = sql();
    await db`${db.unsafe(CREATE_TABLE)}`;
    initialized = true;
  } catch (e) {
    console.error("[award-autopsy] ensureTable failed (fail-open):", e);
  }
  return initialized;
}

/** YYYY-MM billing period for the current (UTC) month. */
export function autopsyBillingPeriod(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export interface AutopsyAllowanceStatus {
  tier: string;
  limit: number | null; // null = unlimited
  used: number;
  remaining: number | null; // null = unlimited
  overLimit: boolean;
  /** Starter+ — sees the full analysis AND the Radar ⚡ memory. */
  paid: boolean;
}

/**
 * Effective plan tier for autopsy gating, honoring the SAME grant / demo /
 * admin logic the AI-brief allowance uses (src/lib/ai-brief-allowance.ts
 * effectiveTier): an ACTIVE time-boxed grant passes every gate, an expired
 * grant/trial downgrades to Basic, internal admins and the demo tier are
 * treated as Professional.
 */
export async function effectiveAutopsyTier(
  userId: number,
  user?: { is_admin?: boolean } | null,
): Promise<string> {
  if (user?.is_admin) return "professional";
  let trial: Awaited<ReturnType<typeof loadUserTrialStatus>> | null = null;
  try {
    trial = await loadUserTrialStatus(userId);
  } catch {
    trial = null;
  }
  const planTier = (trial?.planTier ?? "basic") as string;
  if (planTier === "demo") return "professional";
  if (trial?.fullAccess) return "professional";
  if (trial?.expired) return "basic";
  return planTier in AUTOPSY_ALLOWANCE ? planTier : "basic";
}

/** Current autopsy allowance WITHOUT consuming (honest "N of M this month"). */
export async function getAutopsyAllowanceStatus(
  userId: number,
  user?: { is_admin?: boolean } | null,
): Promise<AutopsyAllowanceStatus> {
  const tier = await effectiveAutopsyTier(userId, user);
  const rawLimit = AUTOPSY_ALLOWANCE[tier] ?? 1;
  const limit = Number.isFinite(rawLimit) ? (rawLimit as number) : null;
  let used = 0;
  try {
    if (await ensureTable()) {
      const period = autopsyBillingPeriod();
      const rows = (await sql()`
        SELECT autopsies_used FROM autopsy_allowance
        WHERE user_id = ${userId} AND billing_period = ${period}
      `) as Array<{ autopsies_used: number }>;
      used = Number(rows?.[0]?.autopsies_used ?? 0);
    }
  } catch {
    /* treat as 0 on blip — the atomic consume below stays authoritative */
  }
  const remaining = limit === null ? null : Math.max(0, limit - used);
  const paid = LEARNING_TIERS.has(tier);
  return { tier, limit, used, remaining, overLimit: !paid && limit !== null && used >= limit, paid };
}

/**
 * Atomically consume ONE autopsy for the user's current billing period — a
 * single UPDATE guarded by `autopsies_used < limit` (mirrors
 * consumeAllowance in ai-brief-allowance) so concurrent requests can never
 * overshoot the cap. Unlimited tiers (Pro/Agency) just ensure the ledger row.
 *
 * @returns the new used count (or 0→fine for unlimited), or null when at cap.
 */
export async function consumeAutopsyAllowance(
  userId: number,
  tier: string,
): Promise<number | null> {
  try {
    if (!(await ensureTable())) return 0; // fail-open — never lock a real user out
    const period = autopsyBillingPeriod();
    await sql()`
      INSERT INTO autopsy_allowance (user_id, billing_period, tier, autopsies_used)
      VALUES (${userId}, ${period}, ${tier}, 0)
      ON CONFLICT (user_id, billing_period)
      DO UPDATE SET tier = EXCLUDED.tier, updated_at = NOW()
    `;
    const rawLimit = AUTOPSY_ALLOWANCE[tier] ?? 1;
    if (!Number.isFinite(rawLimit)) return 0; // unlimited — nothing to guard
    const rows = (await sql()`
      UPDATE autopsy_allowance
      SET autopsies_used = autopsies_used + 1, updated_at = NOW()
      WHERE user_id = ${userId} AND billing_period = ${period} AND autopsies_used < ${rawLimit}
      RETURNING autopsies_used
    `) as Array<{ autopsies_used: number }>;
    if (!rows.length) return null; // at cap — nothing consumed
    return Number(rows[0].autopsies_used);
  } catch (e) {
    console.error("[award-autopsy] consumeAutopsyAllowance failed (fail-open):", e);
    return 0;
  }
}

// ── The Autopsy itself ────────────────────────────────────────────────────────

/** "What probably hurt you" finding — rule-based over REAL data only. */
export interface AutopsyFinding {
  emoji: string;
  text: string;
  tone: "red" | "orange" | "green";
}

export interface AwardAutopsy {
  /** Whether a real USAspending award was matched to this loss. */
  found: boolean;
  /** Honest fallback message when no award data matched. */
  fallbackMessage: string | null;
  youBid: number | null;
  winner: string | null;
  winningAmount: number | null;
  /** user bid minus winning amount (only when both are real). */
  difference: number | null;
  /** (user bid - winning) / winning — only when both are real and winning > 0. */
  differencePct: number | null;
  incumbentRetained: boolean | null; // null = unknown / not determinable
  /** Offers received — ONLY when a source provides it; otherwise null (UI renders "not disclosed"). */
  competition: number | null;
  findings: AutopsyFinding[]; // [] for Basic (redacted) and no-award fallbacks
  recommendation: string | null; // Starter+ only
  /** Historical award pricing for this NAICS+agency (Starter+ display). */
  historicalPricing: { fiscal_year: number; total_obligated: number; award_count: number }[];
  similarAwardCount: number;
}

function parseMoney(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = String(value).replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const num = Number.parseFloat(cleaned);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function money(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

const EMPTY_AUTOPSY: AwardAutopsy = {
  found: false,
  fallbackMessage: null,
  youBid: null,
  winner: null,
  winningAmount: null,
  difference: null,
  differencePct: null,
  incumbentRetained: null,
  competition: null,
  findings: [],
  recommendation: null,
  historicalPricing: [],
  similarAwardCount: 0,
};

/**
 * Build the Award Autopsy for one logged loss. Calls the LIVE, cached
 * USAspending lookup (getFPDSIntel) — never fabricates. `paid` (Starter+)
 * controls the full analysis (findings + recommendation); a Basic user still
 * gets the demo fields (winner + amount + difference) but never the full
 * analysis or anything resembling the Radar memory.
 */
export async function buildAutopsy(input: {
  bidTitle: string;
  agency: string;
  naicsCode: string;
  estimatedValue: string;
  paid: boolean;
  deeper: boolean;
}): Promise<{ autopsy: AwardAutopsy; intel: FPDSIntel | null }> {
  const { bidTitle, agency, naicsCode, estimatedValue, paid, deeper } = input;
  let intel: FPDSIntel | null = null;
  try {
    intel = await getFPDSIntel(naicsCode || "", agency || "", bidTitle || "");
  } catch (e) {
    console.error("[award-autopsy] FPDS lookup failed:", e);
    intel = null;
  }

  if (!intel || !intel.incumbent_name) {
    return {
      autopsy: {
        ...EMPTY_AUTOPSY,
        fallbackMessage:
          "No award data found yet for this bid and agency — log the winner if you know it and your loss is still saved to the Learning Engine.",
      },
      intel: null,
    };
  }

  const youBid = parseMoney(estimatedValue);
  const winningAmount = Number(intel.total_obligated ?? 0);
  const hasWinning = Number.isFinite(winningAmount) && winningAmount > 0;
  const difference = youBid != null && hasWinning ? youBid - winningAmount : null;
  const differencePct =
    youBid != null && hasWinning && winningAmount > 0
      ? ((youBid - winningAmount) / winningAmount) * 100
      : null;

  // "What probably hurt you" — rule-based over REAL data only (Starter+).
  const findings: AutopsyFinding[] = [];
  if (paid) {
    if (differencePct != null && differencePct > 0) {
      findings.push({
        emoji: "🔴",
        tone: "red",
        text: `Your price was ${differencePct.toFixed(1)}% above the winning price.`,
      });
    } else if (differencePct != null && differencePct < 0) {
      findings.push({
        emoji: "🟢",
        tone: "green",
        text: `Your price was actually ${Math.abs(differencePct).toFixed(1)}% BELOW the winning price — price likely wasn't the deciding factor.`,
      });
    }
    const history = intel.historical_pricing || [];
    const similarAwardCount = history.reduce((acc, h) => acc + (h.award_count || 0), 0);
    if (similarAwardCount > 0) {
      findings.push({
        emoji: "🟠",
        tone: "orange",
        text: `This agency has ${similarAwardCount} similar award${similarAwardCount === 1 ? "" : "s"} on record for this NAICS in the last 4 fiscal years — the winner has an established track record here.`,
      });
    }
    if (intel.re_compete === true) {
      findings.push({
        emoji: "🟠",
        tone: "orange",
        text: "This appears to be a re-compete of an existing contract — the incumbent's past performance carried weight.",
      });
    }
    if (findings.length === 0) {
      findings.push({
        emoji: "🟢",
        tone: "green",
        text: "No clear price or incumbency signal found in the award data — request a formal debrief from the agency for the real evaluation factors.",
      });
    }
  }

  // Recommendation — Starter+ only, from REAL historical awards (no invention).
  let recommendation: string | null = null;
  if (paid) {
    const history = intel.historical_pricing || [];
    const amounts = history
      .map((h) => h.total_obligated / Math.max(1, h.award_count))
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);
    if (amounts.length >= 2) {
      const low = amounts[Math.floor(amounts.length * 0.25)];
      const high = amounts[Math.floor(amounts.length * 0.75)];
      recommendation = `For similar opportunities at this agency, recent awards averaged between ${money(low)} and ${money(high)} per contract. Evaluate the incumbent's strength and your past performance before committing proposal resources.`;
    } else if (hasWinning) {
      recommendation = `The most recent comparable award here was ${money(winningAmount)}. Evaluate the incumbent's strength and your past performance before committing proposal resources.`;
    } else {
      recommendation =
        "Historical award amounts for this NAICS and agency are not available yet — verify the contract size in the solicitation before committing proposal resources.";
    }
  }

  return {
    autopsy: {
      found: true,
      fallbackMessage: null,
      youBid,
      winner: intel.incumbent_name,
      winningAmount: hasWinning ? winningAmount : null,
      difference,
      differencePct,
      // re_compete semantics: true = incumbent kept a renewed contract. When
      // the source does not assert it we leave null ("unknown") — honest.
      incumbentRetained: intel.re_compete === true ? true : intel.re_compete === false ? false : null,
      competition: null, // USAspending does not disclose offers received — never fabricated
      findings,
      recommendation,
      historicalPricing: (intel.historical_pricing || []).slice(0, 5),
      similarAwardCount: (intel.historical_pricing || []).reduce((acc, h) => acc + (h.award_count || 0), 0),
    },
    intel,
  };
}

// ── Contrax Learning — the Radar ⚡ memory (PAID-ONLY, Starter+) ──────────────

/** Compact prior-loss badge the Radar surfaces on a similar opportunity. */
export interface PriorLossBadge {
  /** Long month + year of the prior loss, e.g. "September 2026". */
  month: string;
  /** |price difference| in % of the winning amount (real, from the autopsy). */
  priceDiffPct: number;
  /** "above" when the user bid over the winner, "below" when under. */
  direction: "above" | "below";
}

/** One autopsied-loss row as the Radar memory consumes it. */
export interface PriorLossRow {
  agency: string;
  naics_code: string | null;
  autopsy: {
    found?: boolean;
    winningAmount?: number | null;
    differencePct?: number | null;
  } | null;
  created_at: string;
}

/**
 * Load every autopsy-backed loss for ONE user (user-email scoped — only the
 * SAME user's losses ever feed the memory). Cheap: users have a handful of
 * losses; the scan matches them against bids in JS. Returns [] on any error so
 * Radar can never break because of the memory.
 */
async function loadPriorLosses(userEmail: string): Promise<PriorLossRow[]> {
  try {
    const rows = (await sql()`
      SELECT agency, naics_code, autopsy, created_at
      FROM bid_losses
      WHERE user_email = ${userEmail}
        AND autopsy IS NOT NULL
        AND COALESCE((autopsy->>'found')::boolean, false) = true
        AND COALESCE((autopsy->>'winningAmount')::numeric, 0) > 0
      ORDER BY created_at DESC
      LIMIT 50
    `) as any[];
    return (rows || []).map((r) => ({
      agency: String(r.agency || ""),
      naics_code: r.naics_code ? String(r.naics_code) : null,
      autopsy: (typeof r.autopsy === "string" ? JSON.parse(r.autopsy) : r.autopsy) as PriorLossRow["autopsy"],
      created_at: String(r.created_at || ""),
    }));
  } catch (e) {
    console.error("[award-autopsy] loadPriorLosses failed (memory disabled):", e);
    return [];
  }
}

function naicsPrefixMatch(a: string | null, b: string | null): boolean {
  const ca = (a || "").replace(/\D/g, "");
  const cb = (b || "").replace(/\D/g, "");
  if (ca.length < 2 || cb.length < 2) return false;
  const width = ca.length >= 4 && cb.length >= 4 ? 4 : 2;
  return ca.slice(0, width) === cb.slice(0, width);
}

/**
 * One-query-per-surface form of the memory: Radar scans call this ONCE, then
 * matchPriorLoss per bid in JS. Null when the user has no usable memory.
 */
export async function getPriorLossIndex(
  userEmail: string,
): Promise<PriorLossRow[] | null> {
  if (!userEmail) return null;
  const losses = await loadPriorLosses(userEmail);
  return losses.length ? losses : null;
}

/** Pure matcher over getPriorLossIndex — the same rule as findPriorLossForBid. */
export function matchPriorLoss(
  index: PriorLossRow[] | null,
  agency: string | null | undefined,
  naicsCode: string | null | undefined,
): PriorLossBadge | null {
  if (!index || !index.length) return null;
  const agencyNorm = (agency || "").trim().toLowerCase();
  if (!agencyNorm) return null;
  for (const l of index) {
    if (l.agency.trim().toLowerCase() !== agencyNorm) continue;
    if (!naicsPrefixMatch(l.naics_code, naicsCode || null)) continue;
    const pct = Number(l.autopsy?.differencePct ?? NaN);
    if (!Number.isFinite(pct) || pct === 0) continue;
    const month = l.created_at
      ? new Date(l.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : "";
    if (!month) continue;
    return {
      month,
      priceDiffPct: Math.abs(Math.round(pct * 10) / 10),
      direction: pct > 0 ? "above" : "below",
    };
  }
  return null;
}

/**
 * The per-bid Contrax Learning check: does THIS user have a prior AUTOPSIED
 * loss for a similar contract (same agency case-insensitively + NAICS prefix
 * 2–4 digits) with a real winning amount? Returns the badge or null. Never
 * throws — the memory can only add a banner, never break a surface.
 */
export async function findPriorLossForBid(
  userEmail: string,
  agency: string | null | undefined,
  naicsCode: string | null | undefined,
): Promise<PriorLossBadge | null> {
  return matchPriorLoss(await getPriorLossIndex(userEmail), agency, naicsCode);
}
