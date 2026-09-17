/**
 * FPDS / USASpending incumbent + historical-pricing lookups (src/lib/fpds.ts).
 *
 * OWNER 09-16 (Radar scan-latency fix — HIGH severity, not an outage): the
 * upstream stage that used to run inside `runRadarScan`'s synchronous path is
 * now (a) removed from the scan entirely (see src/routes/radar.tsx — matches
 * return in ≈0.2 s) and (b) loaded LAZILY per displayed opportunity through the
 * `getRadarMatchIntel` server fn. This module supplies the hardened lookup that
 * the lazy path (and every other caller) uses:
 *
 *  1. HARD SERVER-SIDE DEADLINES. Every upstream fetch carries
 *     `AbortSignal.timeout(FPDS_FETCH_TIMEOUT_MS)` AND the whole lookup is
 *     bounded by a caller-supplied (or default) total budget
 *     (`FPDS_LOOKUP_TIMEOUT_MS`). A stalled socket can never hang a request,
 *     and an aborted lookup stops the inter-request spacing wait too — the
 *     "scan kept running long after the client gave up" failure class cannot
 *     recur by construction (fetch aborts ⇒ work ends).
 *  2. NEGATIVE RESULTS ARE CACHED with a shorter TTL than positives
 *     (`FPDS_NEGATIVE_TTL_HOURS`), so "no incumbent found" stops re-hitting
 *     USAspending on every repeat scan. A *failure* (HTTP error / timeout) is
 *     NEVER cached as a negative — that would hide real incumbent data.
 *  3. CACHE KEYS prefer STABLE identifiers (award/PIID → solicitation/opportunity
 *     number → per-source opportunity id) and fall back to a normalized
 *     title|agency|naics key. Title punctuation/case/whitespace can no longer
 *     destroy reuse; identical inputs still collapse to the same row, and
 *     distinct opportunities never collide.
 *  4. The `fpds_lookups` bootstrap DDL runs at most ONCE per process instead of
 *     on every lookup (it used to run up to 5× per Radar scan).
 */
import { sql } from "~/db";

export interface FPDSIncumbent {
  incumbent_name: string;
  incumbent_uei: string | null;
  total_obligated: number;
  pop_start_date: string | null;
  pop_end_date: string | null;
}
export interface HistoricalPrice { fiscal_year: number; total_obligated: number; award_count: number }
export interface FPDSIntel extends FPDSIncumbent { historical_pricing: HistoricalPrice[]; re_compete?: boolean }

const API = "https://api.usaspending.gov/api/v2";
// spending_by_award requires an explicit `fields` array — omitting it 422s with
// "Missing value: 'fields' is a required field" (verified live 2026-08-15), and
// result rows are keyed by these display names ("Recipient Name", "Award Amount",
// ...), NOT by underscore names (recipient_name / total_obligation are absent
// from search rows). Keep in sync with the homepage feed's field set
// (src/routes/index.tsx getLiveAwards). "End Date" maps to the period-of-
// performance current end date; "Start Date" to the POP start date.
const USA_SPENDING_FIELDS = ["Award ID", "Recipient Name", "Recipient UEI", "Award Amount", "Start Date", "End Date", "Awarding Agency", "Description"];

/** Per-FETCH deadline (owner 09-16): a stalled USAspending socket fails in
 *  4 s instead of hanging until the platform kills the function. */
export const FPDS_FETCH_TIMEOUT_MS = 4_000;
/** Default TOTAL deadline for one lookup (all upstream calls + the ≥1 s
 *  inter-request spacing between them). Callers with a tighter UX budget (the
 *  Radar per-card lazy load) pass their own — see FPDS_RADAR_LOOKUP_TIMEOUT_MS. */
export const FPDS_LOOKUP_TIMEOUT_MS = 8_000;
/** Radar's per-opportunity lazy load budget: long enough for a cold
 *  (cache-miss) incumbent + pricing lookup on a healthy upstream, short enough
 *  that a card never waits on a sick one. */
export const FPDS_RADAR_LOOKUP_TIMEOUT_MS = 5_000;
/** USAspending is rate-limited: keep a ≥1 s gap between calls (existing
 *  behavior, unchanged) — the deadline above bounds the wait. */
const RATE_LIMIT_GAP_MS = 1_000;
const RATE_LIMIT_429_BACKOFF_MS = 1_100;
/** Positive cache TTL (unchanged 30 days). */
export const FPDS_POSITIVE_TTL_DAYS = 30;
/** OWNER 09-16 (#2): negative-result TTL. Federal award data moves on a daily
 *  cadence, so a "no incumbent found" verdict is good for roughly a working
 *  day: 12 h removes the repeat-scan amplification (every "Try again" used to
 *  re-pay 1–3 upstream calls per match) while never pinning a stale negative on
 *  a match whose real incumbent data appears later the same day. */
export const FPDS_NEGATIVE_TTL_HOURS = 12;

// ── cache keys (owner 09-16 #3) ───────────────────────────────────────────────
export interface FpdsKeyInput {
  naicsCode?: string | null;
  agency?: string | null;
  /** The search keyword (the bid/solicitation TITLE, as before). */
  title?: string | null;
  /** Stable identifiers, MOST precise first. Whichever is present wins. */
  awardId?: string | null;
  solicitation?: string | null;
  source?: string | null;
  /** The source's own stable opportunity id (bids.external_id). */
  opportunityId?: string | null;
}
/** Text normalization for the FALLBACK key: case, punctuation and whitespace
 *  differences stop destroying reuse ("Janitorial Services, Bldg 5" ≡
 *  "janitorial   services bldg 5"). Digits are kept — a title's numbers are
 *  meaningful. */
export function normalizeFpdsKeyText(v: string | null | undefined): string {
  return String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
/** Identifier normalization: uppercase and drop ALL separators, because the
 *  same solicitation/PIID/external id is published with different punctuation
 *  across sources ("W91247-23-R-0042" ≡ "w9124723r0042"). Applied only to
 *  identifiers, never to titles. */
export function normalizeFpdsKeyId(v: string | null | undefined): string {
  return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
/** The single cache key for a lookup. Every key is versioned (`fpds:v2:`) so a
 *  future key change can never read a row written under a different rule. */
export function fpdsLookupKey(k: FpdsKeyInput): string {
  const award = normalizeFpdsKeyId(k.awardId);
  if (award) return `fpds:v2:aw:${award}`;
  const sol = normalizeFpdsKeyId(k.solicitation);
  if (sol) return `fpds:v2:sol:${sol}`;
  const src = normalizeFpdsKeyId(k.source);
  const op = normalizeFpdsKeyId(k.opportunityId);
  if (src && op) return `fpds:v2:op:${src}:${op}`;
  // FALLBACK (no stable id available): normalized title|agency|naics. All three
  // are the inputs of the USAspending search below, so two rows that collapse
  // onto the same key would have produced the same answer anyway — collisions
  // are semantically harmless; distinct titles still never collide.
  return `fpds:v2:t:${normalizeFpdsKeyText(k.title)}|${normalizeFpdsKeyText(k.agency)}|${normalizeFpdsKeyId(k.naicsCode)}`;
}

// ── deadlines ─────────────────────────────────────────────────────────────────
function abortReasonError(): Error {
  const e = new Error("fpds lookup deadline exceeded");
  e.name = "AbortError";
  return e;
}
/** Abortable sleep: an aborted signal ends the wait immediately instead of
 *  letting the rate-limit gap run on after the caller gave up. */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!(ms > 0)) return signal?.aborted ? Promise.reject(abortReasonError()) : Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(abortReasonError()); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); reject(abortReasonError()); }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
/** Merge an arbitrary set of abort signals (no `AbortSignal.any` dependency —
 *  it is not available on every runtime this app runs on). */
function mergeSignals(signals: (AbortSignal | undefined)[]): { signal: AbortSignal; dispose: () => void } {
  const ctrl = new AbortController();
  const live = signals.filter((s): s is AbortSignal => !!s);
  const onAbort = () => ctrl.abort();
  for (const s of live) {
    if (s.aborted) { ctrl.abort(); break; }
    s.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    dispose: () => { for (const s of live) s.removeEventListener("abort", onAbort); },
  };
}

let lastRequest = 0;
async function request(path: string, init?: RequestInit, deadline?: AbortSignal): Promise<any> {
  await abortableSleep(Math.max(0, RATE_LIMIT_GAP_MS - (Date.now() - lastRequest)), deadline);
  lastRequest = Date.now();
  const call = async () => {
    // Per-fetch deadline + the caller's total deadline, whichever fires first.
    const merged = mergeSignals([AbortSignal.timeout(FPDS_FETCH_TIMEOUT_MS), deadline]);
    try {
      return await fetch(`${API}${path}`, {
        ...init,
        signal: merged.signal,
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(init?.headers || {}) },
      });
    } finally {
      merged.dispose();
    }
  };
  let response = await call();
  if (response.status === 429) {
    await abortableSleep(RATE_LIMIT_429_BACKOFF_MS, deadline);
    lastRequest = Date.now();
    response = await call();
  }
  if (!response.ok) {
    // A non-OK status (422/500/…) is an UPSTREAM FAILURE, not "no incumbent":
    // log it and throw so the caller reports an honest "unavailable" and — most
    // importantly — so a transient upstream error is never cached as a
    // NEGATIVE result for 12 h (owner 09-16 #2). Callers that historically
    // fail-open still do (getFPDSIntel / searchFPDSIncumbent catch).
    const detail = await response.text().catch(() => "");
    console.error(`[fpds] USAspending ${path} returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    throw new Error(`USAspending ${path} returned HTTP ${response.status}`);
  }
  return response.json();
}
function filters(naicsCode: string, agency: string, keywords: string, years?: boolean) {
  const now = new Date(); const end = now.toISOString().slice(0, 10); const start = new Date(now.getFullYear() - 5, 0, 1).toISOString().slice(0, 10);
  return { filters: { time_period: years ? [{ start_date: start, end_date: end }] : undefined, naics_codes: naicsCode ? [naicsCode] : undefined, keywords: [keywords, agency].filter(Boolean), award_type_codes: ["A", "B", "C", "D"] }, fields: USA_SPENDING_FIELDS, limit: 100, page: 1, subawards: false };
}
async function search(body: unknown, deadline?: AbortSignal) { return request("/search/spending_by_award/", { method: "POST", body: JSON.stringify(body) }, deadline); }

/** Raw incumbent search. THROWS on an upstream failure (HTTP error, timeout,
 *  abort) and returns null only when USAspending genuinely answered with no
 *  matching award — the distinction the negative cache depends on. */
async function searchIncumbentRaw(naicsCode: string, agency: string, keywords: string, deadline?: AbortSignal): Promise<FPDSIncumbent | null> {
  const data = await search(filters(naicsCode, agency, keywords), deadline);
  const rows: any[] = data?.results || []; if (!rows.length) return null;
  // Prefer a real, non-zero award amount over the default top-ranked row:
  // USAspending search can rank a $0 record first (e.g. a 0-obligation
  // modification line), which would render an honest-but-weak "$0" even when
  // that same winner holds real awards with actual amounts in the result set.
  // Walk the rows and use the first one with a finite non-zero obligated/award
  // amount (real data — never invented). If every row is $0/empty, fall back to
  // the top row so the caller still gets an honest zero / "not available"
  // placeholder rather than a fabricated figure. The winner name stays the
  // actual recipient of whichever real award we surface.
  let row: any = rows[0];
  for (const r of rows) {
    const amt = Number(r["Award Amount"] ?? r.total_obligation ?? 0);
    if (Number.isFinite(amt) && amt > 0) { row = r; break; }
  }
  // Search rows key the requested fields by display name ("Recipient Name"…);
  // the optional /awards/{id}/ detail call returns nested keys
  // (recipient.recipient_name, period_of_performance.start_date) with
  // total_obligation at top level. Read both so the lookup survives either.
  const detail = row.generated_unique_award_id ? await request(`/awards/${encodeURIComponent(row.generated_unique_award_id)}/`, undefined, deadline) : row;
  const d: any = detail || row;
  const name = d.recipient?.recipient_name || d.recipient_name || row["Recipient Name"]; if (!name) return null;
  return {
    incumbent_name: name,
    incumbent_uei: d.recipient?.recipient_uei || d.recipient_uei || row["Recipient UEI"] || null,
    total_obligated: Number(d.total_obligation ?? row["Award Amount"] ?? 0),
    pop_start_date: d.period_of_performance?.start_date || d.period_of_performance_start_date || row["Start Date"] || null,
    pop_end_date: d.period_of_performance?.end_date || d.period_of_performance_current_end_date || row["End Date"] || null,
  };
}

/** Public fail-open incumbent search (unchanged contract: null = "no data",
 *  never throws). Used by the Radar-homepage feed paths. */
export async function searchFPDSIncumbent(naicsCode: string, agency: string, keywords: string): Promise<FPDSIncumbent | null> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), FPDS_LOOKUP_TIMEOUT_MS);
  try {
    return await searchIncumbentRaw(naicsCode, agency, keywords, deadline.signal);
  } catch (err) {
    if (!(err instanceof Error && err.name === "AbortError")) console.error("[fpds] incumbent lookup failed:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
export async function fetchHistoricalPricing(naicsCode: string, agency: string, keywords: string): Promise<HistoricalPrice[]> {
  if (!naicsCode) return [];
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), FPDS_LOOKUP_TIMEOUT_MS);
  try {
    const data = await search(filters(naicsCode, agency, keywords, true), deadline.signal); const totals = new Map<number, { total: number; count: number }>();
    for (const row of data?.results || []) { const date = row["Start Date"] || row.period_of_performance_start_date || row.award_date; const year = date ? (new Date(date).getMonth() >= 9 ? new Date(date).getFullYear() + 1 : new Date(date).getFullYear()) : 0; if (year >= new Date().getFullYear() - 4) { const v = totals.get(year) || { total: 0, count: 0 }; v.total += Number(row["Award Amount"] ?? row.total_obligation ?? 0); v.count++; totals.set(year, v); } }
    return [...totals.entries()].sort((a, b) => a[0] - b[0]).map(([fiscal_year, v]) => ({ fiscal_year, total_obligated: v.total, award_count: v.count }));
  } catch (err) {
    if (!(err instanceof Error && err.name === "AbortError")) console.error("[fpds] historical pricing lookup failed:", err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
export async function searchFPDSContract(solicitationNumber: string): Promise<FPDSIncumbent | null> {
  if (!solicitationNumber) return null;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), FPDS_LOOKUP_TIMEOUT_MS);
  try {
    // award_type_codes is also required by spending_by_award (422 without it,
    // verified live 2026-08-15) — contract award types A/B/C/D only.
    const data = await search({ filters: { keywords: [solicitationNumber], award_type_codes: ["A", "B", "C", "D"] }, fields: USA_SPENDING_FIELDS, limit: 10, page: 1 }, deadline.signal);
    const row = data?.results?.[0]; if (!row) return null;
    return { incumbent_name: row["Recipient Name"] || row.recipient_name || "", incumbent_uei: row["Recipient UEI"] || row.recipient_uei || null, total_obligated: Number(row["Award Amount"] ?? row.total_obligation ?? 0), pop_start_date: row["Start Date"] || row.period_of_performance_start_date || null, pop_end_date: row["End Date"] || row.period_of_performance_current_end_date || null };
  } catch (err) {
    if (!(err instanceof Error && err.name === "AbortError")) console.error("[fpds] contract lookup failed:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Result of a cache-aware lookup. The THREE-WAY status is what lets the UI be
 *  honest: "none" = USAspending answered and found nothing (safe to cache and
 *  safe to tell the user "not available"); "unavailable" = we could not
 *  complete the lookup (timeout / HTTP error) and must NOT claim anything. */
export type FPDSIntelLookup =
  | { status: "ok"; intel: FPDSIntel }
  | { status: "none" }
  | { status: "unavailable" };

export interface FpdsLookupOptions {
  /** TOTAL wall-clock budget for this lookup (spacing waits + every fetch). */
  totalTimeoutMs?: number;
  /** Stable identifiers for the cache key (see fpdsLookupKey). */
  key?: FpdsKeyInput;
}

/** Table bootstrap, memoized: the DDL used to run on EVERY lookup (up to 5× per
 *  Radar scan). Reset on failure so a transient DB error still retries later. */
let tableReady: Promise<unknown> | null = null;
function ensureLookupTable(): Promise<unknown> {
  if (!tableReady) {
    tableReady = Promise.resolve(
      sql()`CREATE TABLE IF NOT EXISTS fpds_lookups (id SERIAL PRIMARY KEY, lookup_key TEXT NOT NULL UNIQUE, incumbent_name TEXT, incumbent_uei TEXT, total_obligated DECIMAL(14,2), pop_start_date TEXT, pop_end_date TEXT, historical_pricing JSONB DEFAULT '[]'::jsonb, fetched_at TIMESTAMPTZ DEFAULT NOW())`,
    ).catch((err) => { tableReady = null; throw err; });
  }
  return tableReady;
}

/** Cache-aware incumbent + pricing lookup (the entry point every caller should
 *  use). Every UPSTREAM call is bounded by `totalTimeoutMs` (default
 *  FPDS_LOOKUP_TIMEOUT_MS) plus the per-fetch timeout, so a hung/sick
 *  USAspending returns { status: "unavailable" } instead of hanging. (The cache
 *  read/write are plain Neon HTTP queries — not separately clocked here; the
 *  Radar lazy endpoint races its own wall-clock guard and the card has a client
 *  budget, so nothing user-visible can wait on a stalled DB either.) */
export async function lookupFPDSIntel(
  naicsCode: string,
  agency: string,
  keywords: string,
  opts: FpdsLookupOptions = {},
): Promise<FPDSIntelLookup> {
  const totalMs = opts.totalTimeoutMs ?? FPDS_LOOKUP_TIMEOUT_MS;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), totalMs);
  const lookupKey = fpdsLookupKey({ ...(opts.key ?? {}), naicsCode, agency, title: keywords });
  try {
    await ensureLookupTable();
    const cached = await sql()`
      SELECT incumbent_name, incumbent_uei, total_obligated, pop_start_date, pop_end_date, historical_pricing
      FROM fpds_lookups
      WHERE lookup_key = ${lookupKey}
        AND (
          (incumbent_name IS NOT NULL AND fetched_at > NOW() - ${`${FPDS_POSITIVE_TTL_DAYS} days`}::interval)
          OR (incumbent_name IS NULL AND fetched_at > NOW() - ${`${FPDS_NEGATIVE_TTL_HOURS} hours`}::interval)
        )
      LIMIT 1`;
    if (cached.length) {
      const c: any = cached[0];
      if (!c.incumbent_name) return { status: "none" }; // cached NEGATIVE (owner 09-16 #2)
      return {
        status: "ok",
        intel: {
          incumbent_name: c.incumbent_name, incumbent_uei: c.incumbent_uei,
          total_obligated: Number(c.total_obligated || 0),
          pop_start_date: c.pop_start_date, pop_end_date: c.pop_end_date,
          historical_pricing: c.historical_pricing || [],
        },
      };
    }
    // MISS → upstream. `answered` distinguishes "USAspending said no incumbent"
    // (cacheable negative) from a failure (never cached; caller reported as
    // unavailable).
    let incumbent: FPDSIncumbent | null = null;
    let answered = false;
    try {
      incumbent = await searchIncumbentRaw(naicsCode, agency, keywords, deadline.signal);
      answered = true;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") console.error(`[fpds] lookup aborted at ${totalMs}ms budget (key=${lookupKey})`);
      else console.error("[fpds] incumbent lookup failed:", err);
    }
    if (!answered) return { status: "unavailable" };
    const historical = incumbent ? await fetchHistoricalPricing(naicsCode, agency, keywords) : [];
    if (deadline.signal.aborted && !incumbent) return { status: "unavailable" };
    // Positive OR negative: both are cached (negatives with the shorter TTL
    // enforced on read). fetched_at is refreshed on every write.
    await sql()`
      INSERT INTO fpds_lookups (lookup_key, incumbent_name, incumbent_uei, total_obligated, pop_start_date, pop_end_date, historical_pricing)
      VALUES (${lookupKey},${incumbent?.incumbent_name ?? null},${incumbent?.incumbent_uei ?? null},${incumbent?.total_obligated ?? null},${incumbent?.pop_start_date ?? null},${incumbent?.pop_end_date ?? null},${JSON.stringify(historical)})
      ON CONFLICT (lookup_key) DO UPDATE SET incumbent_name=EXCLUDED.incumbent_name, incumbent_uei=EXCLUDED.incumbent_uei, total_obligated=EXCLUDED.total_obligated, pop_start_date=EXCLUDED.pop_start_date, pop_end_date=EXCLUDED.pop_end_date, historical_pricing=EXCLUDED.historical_pricing, fetched_at=NOW()`;
    return incumbent ? { status: "ok", intel: { ...incumbent, historical_pricing: historical } } : { status: "none" };
  } catch (err) {
    console.error("[fpds] getFPDSIntel failed:", err);
    return { status: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

/** Back-compat wrapper (unchanged signature + fail-open contract: null = no
 *  data / no answer). Callers that need the honest three-way status use
 *  lookupFPDSIntel directly. */
export async function getFPDSIntel(
  naicsCode: string,
  agency: string,
  keywords: string,
  opts: FpdsLookupOptions = {},
): Promise<FPDSIntel | null> {
  const r = await lookupFPDSIntel(naicsCode, agency, keywords, opts);
  return r.status === "ok" ? r.intel : null;
}
