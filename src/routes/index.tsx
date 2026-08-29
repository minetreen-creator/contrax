import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Menu, X } from "lucide-react";
import { getCurrentUser } from "~/lib/auth";
import { trackEvent } from "~/lib/track";
import { isLowContent, LOW_CONTENT_SQL } from "~/lib/low-content";
import { keywordPred } from "~/lib/open-bids";
import {
  buildContractMap,
  formatCompactMoney,
  STATE_NAMES,
  type ContractMapAggregate,
  type StateAggregate,
} from "~/lib/contract-map";
import { US_MAP_VIEWBOX, US_STATE_PATHS } from "~/lib/us-states-map";
import { toISODate } from "./awards";

// ── Types ─────────────────────────────────────────────────────────────────────
type Bid = {
  title: string;
  agency: string;
  estimated_value: string | null;
  due_date: string | null;
  location: string | null;
  created_at?: string | null;
  category?: string | null;
  description?: string | null;
};
type TodayBid = {
  title: string;
  agency: string;
  set_aside: string | null;
  location: string | null;
  due_date: string | null;
  created_at?: string | null;
};

// ── Server Functions ──────────────────────────────────────────────────────────

// Live Opportunities data — deduped at the SQL layer so a genuine duplicate
// row (same solicitation ingested by multiple state-keyword sync sources, e.g.
// `va` and `va_evirginia`) can NEVER surface as an adjacent twin card in the
// grid. DISTINCT ON (title, agency) keeps the most recently ingested row per
// solicitation, then orders the whole distinct set newest-first. The ingest
// guard in src/jobs/runner.ts prevents new duplicates from being written.
const getRecentBids = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data?: { q?: string } }) => {
    const q = data?.q?.trim() ?? "";
    const { sql } = await import("~/db");
    // Ensure naics_code exists so keywordPred can match it (falls back to
    // whole-corpus title/description/location/set_aside/agency match if not).
    if (q) {
      try { await sql()`ALTER TABLE bids ADD COLUMN IF NOT EXISTS naics_code TEXT`; } catch {}
    }
    const pred = keywordPred(q, sql);
    const rows = await sql()`
      SELECT title, agency, estimated_value, due_date, location, set_aside, created_at
      FROM (
        SELECT DISTINCT ON (title, agency)
               title, agency, estimated_value, due_date, location, set_aside, created_at
        FROM bids
        WHERE ${sql().unsafe(LOW_CONTENT_SQL)} AND due_date > NOW() ${pred}
        ORDER BY title, agency, created_at DESC NULLS LAST
      ) t
      ORDER BY t.created_at DESC NULLS LAST
      LIMIT ${q ? 200 : 60}
    `;
    // Honest post-filter, post-dedup total backing this feed — the OPEN set
    // ONLY (due_date > NOW()), keyword-filtered when q is present so the
    // "X of Y" matches exactly the open cards shown. Never pre-filter, never
    // hardcoded.
    const countRows = await sql()`
      SELECT COUNT(*)::int AS count FROM (
        SELECT DISTINCT title, agency
        FROM bids
        WHERE ${sql().unsafe(LOW_CONTENT_SQL)} AND due_date > NOW() ${pred}
      ) d
    `;
    return { bids: rows as Bid[], count: Number((countRows[0] as any)?.count || 0) };
  }
);
const getTodayBids = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data?: { q?: string } }) => {
    const q = data?.q?.trim() ?? "";
    const { sql } = await import("~/db");
    if (q) {
      try { await sql()`ALTER TABLE bids ADD COLUMN IF NOT EXISTS naics_code TEXT`; } catch {}
    }
    const pred = keywordPred(q, sql);
    // Public teaser: titles only — no source URLs or descriptions for
    // unauthenticated visitors. Full detail lives behind the signup wall.
    const rows = await sql()`
      SELECT title, agency, set_aside, location, due_date, created_at
      FROM (
        SELECT DISTINCT ON (title, agency)
               title, agency, set_aside, location, due_date, created_at
        FROM bids
        WHERE created_at >= NOW() - INTERVAL '24 hours'
          AND due_date > NOW()
          AND ${sql().unsafe(LOW_CONTENT_SQL)} ${pred}
        ORDER BY title, agency, created_at DESC NULLS LAST
      ) t
      ORDER BY t.created_at DESC NULLS LAST
      LIMIT ${q ? 100 : 10}
    `;
    // Distinct count so genuine dup rows (multi-source sync) can't inflate the
    // "posted in the last 24 hours" figure.
    const countRows = await sql()`
      SELECT COUNT(*)::int AS count FROM (
        SELECT DISTINCT title, agency
        FROM bids
        WHERE created_at >= NOW() - INTERVAL '24 hours'
          AND due_date > NOW()
          AND ${sql().unsafe(LOW_CONTENT_SQL)} ${pred}
      ) d
    `;
    return {
      bids: rows as TodayBid[],
      count: Number((countRows[0] as any)?.count || 0),
    };
  }
);

// ── Closing Soon ─────────────────────────────────────────────────────────────
// Solicitations whose due_date lands in (NOW, NOW + 7 days], deduped on the
// natural key (title, agency) EXACTLY like getRecentBids/getTodayBids (PR #172)
// and with the shared low-content filter applied (PR #174) — never weakened.
// Sorted soonest-first so the most urgent deadline is always on top. Bounded to
// 8 rows. Every value is REAL from the bids table — nothing fabricated.
export type ClosingSoonBid = {
  id: number;
  title: string;
  agency: string;
  estimated_value: string | null;
  due_date: string | null;
  set_aside: string | null;
};
const getClosingSoonBids = createServerFn({ method: "GET" }).handler(async () => {
  const { sql } = await import("~/db");
  const rows = await sql()`
    SELECT id, title, agency, estimated_value, due_date, set_aside
    FROM (
      SELECT DISTINCT ON (title, agency)
             id, title, agency, estimated_value, due_date, set_aside, created_at
      FROM bids
      WHERE due_date > NOW()
        AND due_date <= NOW() + INTERVAL '7 days'
        AND ${sql().unsafe(LOW_CONTENT_SQL)}
      ORDER BY title, agency, created_at DESC NULLS LAST
    ) t
    ORDER BY t.due_date ASC NULLS LAST
    LIMIT 8
  `;
  return rows as ClosingSoonBid[];
});

// ── U.S. Contract Map — homepage aggregate ────────────────────────────────────
// Reuses the exact same server aggregation as /map (buildContractMap over the
// open-bid population with the shared low-content filter), so the homepage map
// and its live counter are backed by the SAME real numbers as the full page --
// never a separate or fabricated figure. State attribution + stated-value
// honesty rules are enforced inside buildContractMap (see lib/contract-map.ts).
const getContractMapAggregate = createServerFn({ method: "GET" }).handler(
  async (): Promise<ContractMapAggregate> => {
    const { sql } = await import("~/db");
    const rows = await sql()`
      SELECT location, set_aside, estimated_value, agency, category, due_date
      FROM bids
      WHERE (due_date IS NULL OR due_date::date >= NOW()::date)
        AND ${sql().unsafe(LOW_CONTENT_SQL)}
    `;
    return buildContractMap(rows as any);
  },
);

// ── Live Award Feed (USAspending.gov) ────────────────────────────────────────
// REAL recent SET-ASIDE federal contract awards from the public USAspending.gov
// API (POST /api/v2/search/spending_by_award/). Deliberately NOT the
// `awarded_contracts` table — that table holds only demo rows with fake
// sam.gov URLs and would be dishonest presented as "live".
//
// Verified API contract (2026-08-15):
//  - fields MUST include the names below; "Date Signed" 422s and "Award Date"
//    returns null. `action_date` is NOT a valid sort key (422) — the only
//    working recency sort is `sort: "Last Modified Date", order: "desc"`, so
//    that field is also the per-row date we display. The API returns it as
//    "YYYY-MM-DD HH:MM:SS", which we normalize to ISO before formatting.
//  - The 90-day `date_type: "action_date"` filter guarantees every returned
//    row had a contract action in the last 90 days.
//  - set_aside_type_codes narrows the feed to SBA set-aside programs
//    ("8A","SDVOSBC","WOSB_ED_WOSB","HUBZONE","SBA","VOSB") — the whole point
//    of the feed. Note the per-row "Set Aside Type" value still comes back
//    null in search rows, so the purple badge rarely renders; the filter, not
//    the badge, is what makes the feed set-aside-specific.
//  - Results are cached in `live_awards_cache` (12h TTL) so SSR never waits
//    on the API. On API failure we serve stale cached rows; with no cache at
//    all we return [] and the section hides itself — never a 500.
export interface LiveAward {
  award_id: string;
  recipient: string;
  amount: number;
  last_modified: string | null; // USAspending "Last Modified Date" (YYYY-MM-DD HH:MM:SS)
  agency: string | null;
  set_aside: string | null;
  // Per-certification feed only: the set-aside code this row was FETCHED under
  // and its display label. USAspending's per-row "Set Aside Type" comes back
  // null in search rows (verified 2026-08-15), so the filter used is the only
  // truthful evidence of an award's type — the tag is never fabricated.
  cert?: string;
  certLabel?: string;
}

const USA_SPENDING_SEARCH = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
let lastUsaRequest = 0;
async function usaSpendingSearch(body: unknown): Promise<{ results?: any[] } | null> {
  // USAspending rate-limits (~1 req/sec) — same throttle approach as src/lib/fpds.ts
  const wait = Math.max(0, 1100 - (Date.now() - lastUsaRequest));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastUsaRequest = Date.now();
  const response = await fetch(USA_SPENDING_SEARCH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) return null;
  return response.json();
}

const getLiveAwards = createServerFn({ method: "GET" }).handler(async (): Promise<{
  awards: LiveAward[];
  updatedAt: string | null;
}> => {
  const { sql } = await import("~/db");
  const CACHE_KEY = "setaside-90d-v1";
  const readCache = async () => {
    const rows = await sql()`
      SELECT data, computed_at FROM live_awards_cache
      WHERE cache_key=${CACHE_KEY}
      ORDER BY computed_at DESC NULLS LAST
      LIMIT 1
    `;
    if (!rows.length) return null;
    const c: any = rows[0];
    return {
      awards: Array.isArray(c.data) ? (c.data as LiveAward[]) : [],
      updatedAt: c.computed_at ? new Date(c.computed_at).toISOString() : null,
    };
  };

  try {
    await sql()`CREATE TABLE IF NOT EXISTS live_awards_cache (id SERIAL PRIMARY KEY, cache_key TEXT NOT NULL UNIQUE, data JSONB NOT NULL DEFAULT '[]'::jsonb, computed_at TIMESTAMPTZ DEFAULT NOW())`;
    // Fresh cache (12h TTL) → serve it; SSR stays fast, no API call per page load.
    const fresh = await sql()`
      SELECT data, computed_at FROM live_awards_cache
      WHERE cache_key=${CACHE_KEY} AND computed_at > NOW() - INTERVAL '12 hours'
      LIMIT 1
    `;
    if (fresh.length) {
      const c: any = fresh[0];
      return {
        awards: Array.isArray(c.data) ? (c.data as LiveAward[]) : [],
        updatedAt: c.computed_at ? new Date(c.computed_at).toISOString() : null,
      };
    }
  } catch (err) {
    // cache table/query unavailable — fall through to a live fetch
    console.error("[homepage] live_awards_cache read failed:", err);
  }

  try {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const data = await usaSpendingSearch({
      filters: {
        time_period: [{ start_date: start, end_date: end, date_type: "action_date" }],
        award_type_codes: ["A", "B", "C", "D"], // contracts only — required with time_period
        // SBA set-aside programs only — the whole point of the feed
        set_aside_type_codes: ["8A", "SDVOSBC", "WOSB_ED_WOSB", "HUBZONE", "SBA", "VOSB"],
      },
      fields: ["Award ID", "Recipient Name", "Award Amount", "Start Date", "Awarding Agency", "Set Aside Type", "Description", "Last Modified Date"],
      limit: 25, // over-fetch so recipient dedupe below still yields 6 distinct rows
      page: 1,
      order: "desc", // action_date is NOT a valid sort key (422) — Last Modified Date is
      sort: "Last Modified Date",
      subawards: false,
    });
    const results = (data?.results || []).filter(
      (r) => r && r["Recipient Name"] && r["Award Amount"] != null,
    );
    if (results.length) {
      // Rows arrive sorted newest-first by Last Modified Date; keep at most one
      // row per recipient (first occurrence) so the feed shows 6 distinct
      // companies instead of e.g. HDR-OBG 3×.
      const seen = new Set<string>();
      const unique = results.filter((r) => {
        const name = String(r["Recipient Name"]).trim().toLowerCase();
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
      });
      const awards: LiveAward[] = unique.slice(0, 6).map((r) => ({
        award_id: String(r["Award ID"] || r.internal_id || ""),
        recipient: String(r["Recipient Name"]),
        amount: Number(r["Award Amount"]) || 0,
        // "Last Modified Date" arrives as "YYYY-MM-DD HH:MM:SS" — replace the
        // space with "T" so new Date() parses it as local time (a bare date
        // string would parse as UTC and can shift the shown day in US zones).
        last_modified: r["Last Modified Date"]
          ? String(r["Last Modified Date"]).replace(" ", "T")
          : null,
        agency: r["Awarding Agency"] ? String(r["Awarding Agency"]) : null,
        set_aside: r["Set Aside Type"] ? String(r["Set Aside Type"]) : null,
      }));
      try {
        await sql()`INSERT INTO live_awards_cache (cache_key, data) VALUES (${CACHE_KEY}, ${JSON.stringify(awards)}::jsonb) ON CONFLICT (cache_key) DO UPDATE SET data=EXCLUDED.data, computed_at=NOW()`;
      } catch (err) {
        // cache write failure — still serve the live rows for this request
        console.error("[homepage] live_awards_cache write failed:", err);
      }
      return { awards, updatedAt: new Date().toISOString() };
    }
  } catch (err) {
    // API unreachable — never break SSR: fall back to stale cache, else []
    console.error("[homepage] USAspending live-awards fetch failed:", err);
  }

  try {
    const stale = await readCache();
    if (stale) return stale;
  } catch { /* no cache — hide the section */ }
  return { awards: [], updatedAt: null };
});

// ── Live Award Feed — per-certification view ─────────────────────────────────
// Backs the "I am a:" selector above the feed. USAspending's search rows do
// NOT return a per-row "Set Aside Type" value (verified 2026-08-15 — it comes
// back null), so the ONLY truthful evidence of an award's type is the filter
// it was fetched under. We therefore fetch per cert (one code per call) and
// tag every row with that code — never a fabricated label. Same 12h cache /
// fresh-first / stale-on-error / never-500 pattern as getLiveAwards above.
const CERT_CODE_LABELS: Record<string, string> = {
  "8A": "8(a)",
  SDVOSBC: "SDVOSB",
  WOSB: "WOSB",
  HZC: "HUBZone",
  SBA: "Small Business",
};

const getLiveAwardsByCert = createServerFn({ method: "GET" }).handler(async ({
  data: certCode,
}: {
  data: string;
}): Promise<{ awards: LiveAward[]; updatedAt: string | null }> => {
  const { sql } = await import("~/db");
  // Guard the cache table against junk keys from anything but the 5 chips.
  if (!CERT_CODE_LABELS[certCode]) return { awards: [], updatedAt: null };
  const CACHE_KEY = `setaside-cert-${certCode}-v1`;
  const readCache = async () => {
    const rows = await sql()`
      SELECT data, computed_at FROM live_awards_cache
      WHERE cache_key=${CACHE_KEY}
      ORDER BY computed_at DESC NULLS LAST
      LIMIT 1
    `;
    if (!rows.length) return null;
    const c: any = rows[0];
    return {
      awards: Array.isArray(c.data) ? (c.data as LiveAward[]) : [],
      updatedAt: c.computed_at ? new Date(c.computed_at).toISOString() : null,
    };
  };

  try {
    await sql()`CREATE TABLE IF NOT EXISTS live_awards_cache (id SERIAL PRIMARY KEY, cache_key TEXT NOT NULL UNIQUE, data JSONB NOT NULL DEFAULT '[]'::jsonb, computed_at TIMESTAMPTZ DEFAULT NOW())`;
    const fresh = await sql()`
      SELECT data, computed_at FROM live_awards_cache
      WHERE cache_key=${CACHE_KEY} AND computed_at > NOW() - INTERVAL '12 hours'
      LIMIT 1
    `;
    if (fresh.length) {
      const c: any = fresh[0];
      return {
        awards: Array.isArray(c.data) ? (c.data as LiveAward[]) : [],
        updatedAt: c.computed_at ? new Date(c.computed_at).toISOString() : null,
      };
    }
  } catch (err) {
    console.error("[homepage] live_awards_cache read failed:", err);
  }

  try {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const data = await usaSpendingSearch({
      filters: {
        time_period: [{ start_date: start, end_date: end, date_type: "action_date" }],
        award_type_codes: ["A", "B", "C", "D"], // contracts only — required with time_period
        set_aside_type_codes: [certCode], // single code — the row tag below is truthful
      },
      fields: ["Award ID", "Recipient Name", "Award Amount", "Start Date", "Awarding Agency", "Set Aside Type", "Description", "Last Modified Date"],
      limit: 25, // over-fetch so recipient dedupe still yields 5 distinct rows
      page: 1,
      order: "desc",
      sort: "Last Modified Date",
      subawards: false,
    });
    const results = (data?.results || []).filter(
      (r) => r && r["Recipient Name"] && r["Award Amount"] != null,
    );
    if (results.length) {
      // One row per recipient, newest-first, keep 5 — same shape as the All view.
      const seen = new Set<string>();
      const unique = results.filter((r) => {
        const name = String(r["Recipient Name"]).trim().toLowerCase();
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
      });
      const awards: LiveAward[] = unique.slice(0, 5).map((r) => ({
        award_id: String(r["Award ID"] || r.internal_id || ""),
        recipient: String(r["Recipient Name"]),
        amount: Number(r["Award Amount"]) || 0,
        last_modified: r["Last Modified Date"]
          ? String(r["Last Modified Date"]).replace(" ", "T")
          : null,
        agency: r["Awarding Agency"] ? String(r["Awarding Agency"]) : null,
        set_aside: r["Set Aside Type"] ? String(r["Set Aside Type"]) : null,
        cert: certCode,
        certLabel: CERT_CODE_LABELS[certCode] || certCode,
      }));
      try {
        await sql()`INSERT INTO live_awards_cache (cache_key, data) VALUES (${CACHE_KEY}, ${JSON.stringify(awards)}::jsonb) ON CONFLICT (cache_key) DO UPDATE SET data=EXCLUDED.data, computed_at=NOW()`;
      } catch (err) {
        console.error("[homepage] live_awards_cache write failed:", err);
      }
      return { awards, updatedAt: new Date().toISOString() };
    }
  } catch (err) {
    console.error("[homepage] USAspending per-cert live-awards fetch failed:", err);
  }

  try {
    const stale = await readCache();
    if (stale) return stale;
  } catch { /* no cache — honest empty state */ }
  return { awards: [], updatedAt: null };
});

const getUserCount = async () => {
  try {
    const { sql } = await import("~/db");
    const rows = await sql()`SELECT COUNT(*)::int AS count FROM users`;
    return Number((rows[0] as any)?.count || 0);
  } catch {
    // users table may not exist yet — fall back to generic social-proof copy
    return 0;
  }
};
const getFarClauseCounts = async (): Promise<{
  total: number;
  far: number;
  dfars: number;
} | null> => {
  try {
    const { sql } = await import("~/db");
    const rows = await sql()`
      SELECT source, COUNT(*)::int AS count
      FROM far_clauses
      GROUP BY source
    `;
    let total = 0;
    let far = 0;
    let dfars = 0;
    for (const row of rows as { source?: string | null; count?: number }[]) {
      const count = Number(row?.count || 0);
      total += count;
      if (row?.source === "far") far = count;
      else if (row?.source === "dfars") dfars = count;
    }
    return { total, far, dfars };
  } catch (err) {
    // far_clauses may not exist yet (pre-first-sync DB) — hide the strip
    // rather than break the page or show unverifiable numbers.
    console.error("[homepage] failed to load FAR/DFARS clause counts:", err);
    return null;
  }
};
// Honest "Tracking N active solicitations across M agencies" hero stat.
// N = number of DISTINCT active (due_date > now()) solicitations deduped on
// the natural key (title, agency) — NOT the raw COUNT(*) which is inflated by
// the ~11k duplicate rows ingested when multiple state-keyword sync sources
// return the same national solicitation (20,809 raw rows vs 9,646 distinct,
// and only 5,057 distinct ACTIVE as of 2026-08-18). Never report an inflated
// or fabricated figure.
const getBidStats = async (): Promise<{ activeCount: number; agencyCount: number }> => {
  try {
    const { sql } = await import("~/db");
    const [bids, agencies] = await Promise.all([
      sql()`SELECT COUNT(*)::int AS count FROM (SELECT DISTINCT title, agency FROM bids WHERE due_date > NOW()) d`,
      sql()`SELECT COUNT(DISTINCT agency)::int AS count FROM bids WHERE due_date > NOW()`,
    ]);
    return {
      activeCount: Number((bids[0] as any)?.count || 0),
      agencyCount: Number((agencies[0] as any)?.count || 0),
    };
  } catch {
    // bids table may not exist yet — hide the stat row entirely
    return { activeCount: 0, agencyCount: 0 };
  }
};
// Distinct dollar total of the federal awards we track (Live Award Feed +
// per-certification views). Award amounts carry REAL values from USAspending
// (unlike solicitation `estimated_value`, which is "Not specified" on 99.9% of
// bid rows). The same award repeats across cache keys, so we dedupe by
// award_id (taking the max amount per id) and NEVER sum raw rows — that
// double-counts to ~$214.8M vs the honest ~$214.2M. Fail-open: if the cache
// table or any award data is unavailable, return 0 so the caller hides ONLY
// this stat rather than breaking the page.
const getAwardDollarTotal = async (): Promise<number> => {
  try {
    const { sql } = await import("~/db");
    const rows = await sql()`SELECT data FROM live_awards_cache`;
    const maxByAward = new Map<string, number>();
    let any = false;
    for (const r of rows as { data?: unknown }[]) {
      const arr = Array.isArray(r?.data) ? (r.data as { award_id?: string; amount?: number }[]) : [];
      for (const a of arr) {
        const id = String(a?.award_id ?? "");
        const amt = Number(a?.amount);
        if (!id || !Number.isFinite(amt) || amt <= 0) continue;
        any = true;
        maxByAward.set(id, Math.max(maxByAward.get(id) ?? 0, amt));
      }
    }
    if (!any) return 0;
    let total = 0;
    for (const v of maxByAward.values()) total += v;
    return total;
  } catch {
    // cache table/query unavailable — hide the stat row entirely
    return 0;
  }
};
const getPerCertCounts = async (): Promise<Record<string, number>> => {
  // REAL active set-aside counts for the Personalization Hook, computed at SSR
  // time from the bids table (never fabricated). Keyed by the same cert ids the
  // "I am a:" selector uses. "Small Business" = ALL active set-asides
  // (set_aside IS NOT NULL) — honest by definition, because a federal
  // "set-aside" is reserved exclusively for small business, so every set-aside
  // row IS a small-business competition. Unrestricted (NULL set_aside)
  // solicitations are deliberately NOT counted as "small business" — they are
  // full-and-open and would overstate the niche.
  try {
    const { sql } = await import("~/db");
    // Dedupe on the natural key (title, agency) so multi-source duplicate rows
    // can't inflate the per-cert personalization counts (PR #171 stays intact,
    // but reports honest distinct active set-asides).
    const rows = await sql()`
      SELECT set_aside, COUNT(*)::int AS n FROM (
        SELECT DISTINCT ON (title, agency) set_aside
        FROM bids
        WHERE due_date > NOW() AND set_aside IS NOT NULL
        ORDER BY title, agency
      ) d
      GROUP BY set_aside
    `;
    const counts: Record<string, number> = { "8a": 0, sdvosb: 0, wosb: 0, hubzone: 0, sb: 0 };
    let totalSetAside = 0;
    for (const r of rows as { set_aside: string | null; n: number }[]) {
      if (!r.set_aside) continue; // unrestricted / full-and-open — not a set-aside
      totalSetAside += r.n;
      if (r.set_aside === "8(a)") counts["8a"] = r.n;
      else if (r.set_aside === "SDVOSB") counts.sdvosb = r.n;
      else if (r.set_aside === "WOSB") counts.wosb = r.n;
      else if (r.set_aside === "HUBZone") counts.hubzone = r.n;
    }
    counts.sb = totalSetAside; // all set-asides = all small-business competitions
    return counts;
  } catch {
    // bids table unavailable — return zeroed counts so the personalization
    // card hides rather than showing a fabricated number or breaking SSR.
    return { "8a": 0, sdvosb: 0, wosb: 0, hubzone: 0, sb: 0 };
  }
};
const getLandingData = createServerFn({ method: "GET" }).handler(async ({ data }: { data?: { q?: string } }) => {
  const q = data?.q?.trim() ?? "";
  const { sql } = await import("~/db");
  const [businessName, user, recentBids, todayBids, liveAwards, userCount, bidStats, farClauseCounts, awardDollarTotal, perCertCounts, closingSoon, contractMap] = await Promise.all([
    (async () => {
      try {
        const cfg = JSON.parse(await readFile("site.json", "utf8")) as {
          businessName?: string;
        };
        return cfg.businessName?.trim() ?? "Contrax";
      } catch {
        return "Contrax";
      }
    })(),
    getCurrentUser(),
    getRecentBids({ data: { q } }),
    getTodayBids({ data: { q } }),
    getLiveAwards(),
    getUserCount(),
    getBidStats(),
    getFarClauseCounts(),
    getAwardDollarTotal(),
    getPerCertCounts(),
    getClosingSoonBids(),
    getContractMapAggregate(),
  ]);
  const { bids, count: openCount } = recentBids;
  let alertCount = 0;
  if (user) {
    try {
      await sql()`CREATE TABLE IF NOT EXISTS bid_alerts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), bid_id INTEGER NOT NULL REFERENCES bids(id), alert_type TEXT DEFAULT 'new_match', is_read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, bid_id, alert_type))`;
      const rows = await sql()`SELECT COUNT(*)::int AS count FROM bid_alerts WHERE user_id=${user.id} AND is_read=false`;
      alertCount = Number((rows[0] as any)?.count || 0);
    } catch { /* table or query failed — safe to return 0 */ }
  }
  return { businessName, user, bids, alertCount, userCount, bidStats, todayBids, farClauseCounts, liveAwards, awardDollarTotal, perCertCounts, closingSoon, contractMap, openCount, q };
});

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/")({
  // q must be a STRING even when the URL value is all-digits. TanStack's default
  // search parser JSON/coerces `?q=238220` into the NUMBER 238220; the old
  // `typeof search.q === "string"` guard then dropped it silently (NAICS query
  // vanished -> feed stayed unfiltered and the URL was rewritten to /?qa=...).
  // Accept string OR number and coerce to a canonical string so a NAICS/trade
  // query is honored like any other keyword.
  validateSearch: (search: Record<string, unknown>) => ({
    q:
      typeof search.q === "string" || typeof search.q === "number"
        ? String(search.q)
        : undefined,
  }),
  // CRITICAL for client-side navigation: without loaderDeps the route match is
  // keyed ONLY on the pathname (matchId = route.id + path + loaderDepsHash, where
  // loaderDepsHash is "" when no loaderDeps is declared - see router.js
  // matchRoutes()). So the hero submit (navigate({ search: { q } }), / -> /?q=HVAC)
  // produced the SAME matchId -> the router reused the existing match's cached
  // "/" loader data and did NOT re-run the loader -> the feed stayed unfiltered
  // ("Showing 12 of 8018") even though the URL + hash updated (the 26KB
  // RSC-then-noop nav QA saw). Declaring loaderDeps folds q into the matchId
  // hash, so any q change creates a NEW match and the loader re-runs with the
  // new deps on the client too.
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ deps, location }) => {
    // Prefer deps (the validated search, always a string for both SSR first-load
    // and client transitions; wired from route.match.loaderDeps in load-matches).
    // Fall back to location.search for robustness and coerce numbers to strings
    // in case a value arrives as a raw number (e.g. NAICS). The old `context`
    // read is intentionally NOT used - verified on main that SSR hands the
    // loader `location` as a top-level arg and an EMPTY context.
    const depsQ = typeof deps?.q === "string" ? deps.q : "";
    const locSearch = (location?.search ?? {}) as { q?: unknown };
    const rawQ = depsQ || (locSearch.q == null ? "" : String(locSearch.q));
    return getLandingData({ data: { q: rawQ } });
  },
  component: Home,
  head: () => ({
    meta: [
      { title: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
      {
        name: "description",
        content:
          "Stop reading 100-page government RFPs. Contrax uses AI to instantly extract mandatory requirements, licenses, bonding, and critical deadlines from municipal, state, and federal set-aside bids — so you understand the critical requirements in seconds.",
      },
      { name: "robots", content: "index, follow" },
      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.contrax.company" },
      { property: "og:title", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
      {
        property: "og:description",
        content:
          "Stop reading 100-page government RFPs. Contrax uses AI to instantly extract mandatory requirements, licenses, bonding, and critical deadlines from municipal, state, and federal set-aside bids — so you understand the critical requirements in seconds.",
      },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:alt", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
      {
        name: "twitter:description",
        content:
          "Stop reading 100-page government RFPs. Contrax uses AI to instantly extract mandatory requirements, licenses, bonding, and critical deadlines from municipal, state, and federal set-aside bids — so you understand the critical requirements in seconds.",
      },
      { name: "twitter:image", content: "https://www.contrax.company/logo-square.png" },
      { name: "twitter:image:alt", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company" }],
  }),
});

// ── Official Partnership Announcement (Veterans Against Diabetes) ──────────────
// Static, self-contained announcement band rendered at the very top of the
// homepage (above the Navbar). Pure presentational copy — no buttons, no
// checkout wiring, no pricing/gating changes. Rendered as part of the Home
// component tree so it is included in the server-rendered HTML on first load.
function PartnershipBanner() {
  return (
    <section className="border-b border-amber-500/20 bg-slate-900">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 py-2.5 text-center sm:px-6">
        <p className="text-xs font-medium leading-snug text-slate-200 sm:text-sm">
          <span className="font-bold text-amber-300">Official Partnership:</span>{" "}
          Veterans Against Diabetes members get ~25% off paid plans for their first
          12 months —{" "}
          <a
            href="/vad"
            className="font-semibold text-amber-300 underline decoration-amber-400/40 underline-offset-2 transition-colors hover:text-amber-200"
          >
            Learn more →
          </a>
        </p>
      </div>
    </section>
  );
}

// ── Page Component ────────────────────────────────────────────────────────────

function Home() {

  const { user, bids, alertCount, userCount, bidStats, todayBids, farClauseCounts, liveAwards, closingSoon, contractMap, q } = Route.useLoaderData();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Contrax",
    description:
      "Contrax is the contract intelligence platform for 8(a), SDVOSB, WOSB, and HUBZone-certified businesses — finding set-aside opportunities, explaining bid documents, and drafting proposals so certified firms can compete and win.",
    url: "https://www.contrax.company",
    logo: "https://www.contrax.company/logo-square.png",
    email: "hello@contrax.company",
  };

  // Single selection source of truth for the "I am a:" Personalization Hook.
  // Shared by the top-of-page selector (stat + CTA) and the Live Award Feed
  // chip row (feed filter) — one state, two mirrored controls.
  const [certId, setCertId] = useState("all");
  const selectCert = (id: string) => {
    if (id === certId) return; // already active — no event, no refetch
    trackEvent("feed_filter_click", id); // fire-and-forget, never blocks UI
    setCertId(id);
  };

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PartnershipBanner />
      <Navbar user={user} alertCount={alertCount} />
      <Hero userCount={userCount} bidStats={bidStats} openOppCount={contractMap.totals.totalOpen} cert={certId} q={q || ""} onSelectCert={selectCert} />
      <OpportunityMap aggregate={contractMap} />
      <ClosingSoon bids={closingSoon} />
      <HowItWorks />
      <LiveAwardFeed feed={liveAwards} activeId={certId} onSelectId={selectCert} />
      <FarClauseStats stats={farClauseCounts} />
      <ProductShowcase />
      <Pricing />
      <OpenOpportunities bids={bids} todayBids={todayBids} openCount={contractMap.totals.totalOpen} q={q || ""} user={user} />
      <HealthcareTeaser />
      <Example />
      <WhoItsFor />
      <CompareTeaser />
      <WaitlistSection />
      <Footer />
    </div>
  );
}

// ── Navbar ────────────────────────────────────────────────────────────────────

function Navbar({ user, alertCount }: { user: { id: number; email: string } | null; alertCount: number }) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    window.location.href = "/";
  };
  const closeMenu = () => setMenuOpen(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-100 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <a href="/" className="flex items-center" aria-label="Contrax home">
          <img src="/logo.png" alt="Contrax" className="h-9 w-auto" />
        </a>

        <a
          href="https://www.facebook.com/profile.php?id=61593835047770"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-4 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900"
          aria-label="Contrax on Facebook"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M22 12.06C22 6.51 17.52 2 12 2S2 6.51 2 12.06c0 5.01 3.66 9.18 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.5-3.91 3.78-3.91 1.09 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.45 2.9h-2.33V22c4.78-.76 8.44-4.93 8.44-9.94z"/>
          </svg>
          Facebook
        </a>

        {/* Desktop nav — unchanged, hidden below lg */}
        <div className="hidden items-center gap-3 lg:flex">
          {user ? (
            <>
              <a href="/competitors" className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-all hover:text-gray-900">Competitors</a>
              <a href="/evaluate" className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-all hover:text-gray-900">🔴 Red Team</a>
              <a href="/alerts" aria-label="Bid alerts" className="relative inline-flex items-center rounded-lg px-3 py-2 text-lg text-gray-600 hover:text-gray-900">🔔{alertCount > 0 && <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">{alertCount}</span>}</a>
              <a
                href="/dashboard"
                className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800"
              >
                Dashboard
              </a>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="inline-flex items-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50"
              >
                {loggingOut ? "Signing out..." : "Sign out"}
              </button>
            </>
          ) : (
            <>
              <a
                href="/pricing"
                className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-all hover:text-gray-900"
              >
                Pricing
              </a>
              <a
                href="/demo"
                className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-all hover:text-gray-900"
              >
                Request a demo
              </a>
              <a
                href="/login"
                className="inline-flex items-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900"
              >
                Sign In
              </a>
              <a
                href="/signup"
                onClick={() => trackEvent("hero_cta_click", "nav")}
                className="inline-flex items-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-amber-400 hover:shadow-md"
              >
                Get Started
              </a>
            </>
          )}
        </div>

        {/* Mobile hamburger — visible below lg */}
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          className="inline-flex items-center justify-center rounded-lg border border-gray-200 p-2 text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 lg:hidden"
        >
          <span className="relative inline-flex h-5 w-5">
            <X
              className={`absolute inset-0 h-5 w-5 transition-all duration-300 ease-in-out ${
                menuOpen ? "rotate-0 opacity-100" : "rotate-90 opacity-0"
              }`}
            />
            <Menu
              className={`absolute inset-0 h-5 w-5 transition-all duration-300 ease-in-out ${
                menuOpen ? "-rotate-90 opacity-0" : "rotate-0 opacity-100"
              }`}
            />
          </span>
        </button>
      </div>

      {/* Mobile slide-down panel — same links as desktop */}
      <div
        id="mobile-nav"
        aria-hidden={!menuOpen}
        className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out lg:hidden ${
          menuOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden" inert={!menuOpen}>
          <div className="space-y-2 border-t border-gray-100 px-6 pb-6 pt-4">
            {user ? (
              <>
                <a href="/competitors" onClick={closeMenu} className="block w-full rounded-lg px-4 py-2.5 text-center text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900">Competitors</a>
                <a href="/alerts" onClick={closeMenu} className="block w-full rounded-lg px-4 py-2.5 text-center text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900">🔔 Bid alerts{alertCount > 0 ? ` (${alertCount})` : ""}</a>
                <a href="/evaluate" onClick={closeMenu} className="block w-full rounded-lg px-4 py-2.5 text-center text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900">🔴 Red Team</a>
                <a
                  href="/dashboard"
                  onClick={closeMenu}
                  className="block w-full rounded-lg bg-slate-900 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800"
                >
                  Dashboard
                </a>
                <button
                  onClick={() => {
                    closeMenu();
                    handleLogout();
                  }}
                  disabled={loggingOut}
                  className="block w-full rounded-lg border border-gray-200 px-4 py-2.5 text-center text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50"
                >
                  {loggingOut ? "Signing out..." : "Sign out"}
                </button>
              </>
            ) : (
              <>
                <a
                  href="/pricing"
                  onClick={closeMenu}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900"
                >
                  Pricing
                </a>
                <a
                  href="/demo"
                  onClick={closeMenu}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900"
                >
                  Request a demo
                </a>
                <a
                  href="/login"
                  onClick={closeMenu}
                  className="block w-full rounded-lg border border-gray-200 px-4 py-2.5 text-center text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900"
                >
                  Sign In
                </a>
                <a
                  href="/signup"
                  onClick={() => {
                    closeMenu();
                    trackEvent("hero_cta_click", "nav");
                  }}
                  className="block w-full rounded-lg bg-amber-500 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition-all hover:bg-amber-400 hover:shadow-md"
                >
                  Get Started
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero({
  userCount,
  bidStats,
  openOppCount,
  cert,
  q,
  onSelectCert,
}: {
  userCount: number;
  bidStats: { activeCount: number; agencyCount: number };
  openOppCount: number;
  cert: string;
  q: string;
  onSelectCert: (id: string) => void;
}) {
  const navigate = useNavigate();
  // Keep the search box in sync with the URL's ?q= param: initialize it from q
  // on first paint (a fresh /?q=HVAC load shows "HVAC" in the box) and re-sync
  // whenever the route's q changes (hero submit navigation, or the clear-search
  // link dropping q). Typing mutates local tradeQ only, so it never fights this.
  const [tradeQ, setTradeQ] = useState(q || "");
  useEffect(() => {
    setTradeQ(q || "");
  }, [q]);
  // hero_search telemetry is submit-only: the input's onChange (below) only
  // mutates local state and never fires tracking, so typing can't emit a flood
  // of events. The dedupe ref additionally swallows a double-submit / rapid-
  // Enter repeat of the SAME query within 1.5s, so one real search records
  // exactly one event (a genuinely new search still fires).
  const lastSearchFired = useRef<{ key: string; at: number } | null>(null);
  // Instant "Trade / Keyword" search (owner-directed): typing a trade, NAICS, or
  // state once and pressing Enter lands on the keyword-filtered Open
  // Opportunities feed (/?q=...#open-opportunities), filtered server-side so the
  // SSR HTML carries the matches. The CTA always shows the REAL active
  // solicitation count (bidStats.activeCount) — never a fabricated figure.
  // "Explore Bids →" routes to Contract Radar, pre-filtered to the typed trade
  // and the selected certification, so the visitor lands straight on their
  // matching Radar cards (owner-directed). The radar route accepts `trade` and
  // `cert` search params; both are omitted when empty/"all" (radar then defaults
  // cert to sb). Homepage cert ids map 1:1 to radar's valid set except "all" --
  // only a real cert id is emitted.
  const handleTradeSearch = (e: FormEvent) => {
    e.preventDefault();
    const trade = tradeQ.trim();
    if (trade) {
      // Fire only on an actual submit (never per keystroke). Dedupes an
      // identical query re-submitted within 1.5s so a single search action
      // records exactly one event. Fire-and-forget, never blocks UI.
      const now = Date.now();
      const last = lastSearchFired.current;
      if (!last || last.key !== trade || now - last.at > 1500) {
        lastSearchFired.current = { key: trade, at: now };
        trackEvent("hero_search", trade);
      }
    }
    const RADAR_CERTS = ["8a", "sdvosb", "wosb", "hubzone", "sb"] as const;
    const search: Record<string, string> = {};
    if (trade) search.trade = trade;
    if (cert !== "all" && (RADAR_CERTS as readonly string[]).includes(cert)) {
      search.cert = cert;
    }
    navigate({ to: "/radar", search });
  };

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
      {/* Subtle background pattern */}
      <div className="absolute inset-0 bg-[url('data:image/png;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-50" />
      <div className="relative mx-auto max-w-7xl px-6 pb-16 pt-12 sm:pb-24 sm:pt-16 lg:pb-28 lg:pt-14">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/10 px-4 py-1.5 text-center text-sm font-medium text-blue-200">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
            </span>
            ⚡ NEW: AI-POWERED RFP INTELLIGENCE &amp; REQUIREMENT EXTRACTOR
          </div>


          <h1 className="max-w-4xl text-3xl font-bold tracking-tight text-white sm:text-5xl lg:text-5xl">
            Stop reading 100-page government RFPs.{" "}
            <span className="bg-gradient-to-r from-amber-300 to-amber-500 bg-clip-text text-transparent">
              Understand the critical requirements in seconds.
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-blue-100/80 sm:text-xl">
            Contrax tracks municipal, state, and federal bids across every
            trade—and uses AI to instantly extract mandatory licenses, bonding
            requirements, critical site-walk deadlines, and disqualifiers. No
            more digging through bloated PDFs.
          </p>

          {/* "I am a:" certification selector — reuses the shared cert state so
              picking a cert filters the Live Award Feed below (same chips/logic as
              the feed's own row). Fires the existing feed_filter_click event. */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <span className="text-sm font-semibold text-blue-200/80">I am a:</span>
            {CERT_CHIPS.filter((c) => c.id !== "all").map((chip) => {
              const isActive = cert === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => onSelectCert(chip.id)}
                  aria-pressed={isActive}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                    isActive
                      ? "border-amber-400 bg-amber-400/20 text-amber-200"
                      : "border-white/15 bg-white/5 text-blue-100/80 hover:border-white/30 hover:text-white"
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>

          {/* Instant Trade / Keyword search — the hero's first call to action.
              Full-width on mobile, input + button row on desktop. */}
          <div className="mt-6">
            <form
              onSubmit={handleTradeSearch}
              action="/radar"
              method="get"
              role="search"
              aria-label="Search open solicitations by trade, NAICS, or state"
              className="mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-amber-400/25 bg-white/[0.06] p-4 shadow-xl shadow-black/20 backdrop-blur-md sm:flex-row sm:items-center sm:p-3"
            >
              <div className="flex flex-1 items-center gap-3 rounded-xl bg-white/95 px-4">
                <svg className="h-5 w-5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  name="trade"
                  value={tradeQ}
                  onChange={(e) => setTradeQ(e.target.value)}
                  placeholder={'Enter your trade, NAICS, or state (e.g. "HVAC", "Janitorial", "Texas")'}
                  aria-label="Enter your trade, NAICS, or state"
                  className="w-full bg-transparent py-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="shrink-0 rounded-xl bg-amber-500 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 active:scale-[0.98]"
              >
                🔍 Search Active Bids &amp; AI Briefs — Free
              </button>
            </form>
            <p className="mt-2.5 text-center text-xs font-medium text-blue-200/70">
              Free instant access · No credit card required · Includes 1 free AI Brief every month
            </p>
          </div>

          {/* Contract Radar — the strongest demo CTA on the homepage. */}
          <div className="mt-5">
            <a
              href="/radar"
              onClick={() => trackEvent("hero_cta_click", "radar_activate")}
              className="mx-auto block w-full max-w-3xl rounded-2xl bg-gradient-to-r from-amber-400 to-amber-500 px-6 py-4 text-center text-base font-extrabold text-slate-950 shadow-xl shadow-amber-500/25 transition-all hover:from-amber-300 hover:to-amber-400 active:scale-[0.99] sm:text-lg"
            >
              📡 Activate My Contract Radar →
            </a>
            <p className="mt-2 text-center text-xs font-medium text-blue-200/60">
              Get a real match score on live set-aside solicitations — your first 3 matches free, no signup needed
            </p>
          </div>

          <p className="mt-5 flex items-center justify-center gap-1.5 text-sm text-blue-200/70">
            <svg className="h-4 w-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {userCount >= 5
              ? `Join ${userCount.toLocaleString()} small ${userCount === 1 ? "business" : "businesses"} already using Contrax`
              : "Join a growing community of small businesses using Contrax"}
          </p>
        </div>
      </div>
      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent" />
    </section>
  );
}

// ── U.S. Contract Map — homepage embed ───────────────────────────────────────
// A COMPACT version of the full /map page (owner spec: "Homepage: simplified
// map, one color scale, hover totals, click-to-search, live counter"). Reuses
// the exact same US SVG geometry (us-states-map.ts), the same per-state
// aggregate (buildContractMap — the identical server aggregation /map uses), and
// the SAME one color scale (MAP_BUCKETS/mapFillFor) as /map. Every number is
// REAL and SSR-rendered; the hover totals tooltip + gold selection are pure
// progressive enhancement layered on top. Clicking a state is a plain anchor to
// /map?state=<CODE> — the full page already handles the drill-down, so no JS is
// required for click-to-search.
const MAP_BUCKETS: { min: number; fill: string; label: string; glow?: boolean }[] = [
  { min: 0, fill: "#2b3a52", label: "No recorded open bids" },
  { min: 1, fill: "#5b8def", label: "1–25 open bids" },
  { min: 26, fill: "#3b74e8", label: "26–100" },
  { min: 101, fill: "#2557c9", label: "101–300" },
  { min: 301, fill: "#22c58b", label: ">300 — most active", glow: true },
];
function mapFillFor(count: number): { fill: string; glow: boolean } {
  let out = MAP_BUCKETS[0];
  for (const b of MAP_BUCKETS) if (count >= b.min) out = b;
  return { fill: out.fill, glow: !!out.glow };
}

function mapCompactValueLabel(agg: StateAggregate): string {
  if (agg.withValue <= 0) return "stated value not disclosed";
  return `${formatCompactMoney(agg.statedValue)} in stated value`;
}

function OpportunityMap({ aggregate }: { aggregate: ContractMapAggregate }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<{ code: string; x: number; y: number } | null>(null);
  const { totals } = aggregate;
  const hasData = totals.totalOpen > 0;

  const handleMove = (e: { clientX: number; clientY: number }, code: string) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setHovered({ code, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  // Reset the hover tooltip when the pointer leaves the map container.
  useEffect(() => {
    const onLeave = () => setHovered(null);
    const el = containerRef.current;
    el?.addEventListener("mouseleave", onLeave);
    return () => el?.removeEventListener("mouseleave", onLeave);
  }, []);

  const hoverAgg = hovered ? aggregate.states[hovered.code] : null;

  return (
    <section className="bg-white py-12 sm:py-16" aria-label="U.S. Contract Map">
      <div className="mx-auto max-w-7xl px-6">
        <div className="overflow-hidden rounded-3xl border border-slate-700/60 bg-gradient-to-b from-slate-900 to-slate-950 px-5 py-8 text-slate-100 shadow-2xl shadow-slate-900/20 sm:px-8 sm:py-10">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-sky-400">Contrax Opportunity Map</p>
            <h2 className="mt-2 text-2xl font-extrabold text-white sm:text-3xl">
              {hasData
                ? `${totals.totalOpen.toLocaleString()} open opportunities across 50 states + D.C.`
                : "See where government money is moving."}
            </h2>
            <p className="mt-3 text-sm text-slate-400">
              Hover a state for its totals — click one to see exactly what&apos;s being bought there. Live from the
              open solicitations synchronized from SAM.gov.
            </p>
          </div>

          <div
            ref={containerRef}
            className="relative mt-6 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/40 p-3 sm:p-4"
          >
            <svg
              viewBox={`0 0 ${US_MAP_VIEWBOX.width} ${US_MAP_VIEWBOX.height}`}
              className="w-full"
              role="img"
              aria-label="Map of US states showing open contract opportunities"
            >
              <defs>
                <filter id="homeMapGlow" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#38bdf8" floodOpacity="0.85" />
                </filter>
              </defs>
              {Object.keys(US_STATE_PATHS).map((code) => {
                const agg = aggregate.states[code];
                const tooltip = agg
                  ? `${STATE_NAMES[code] ?? code}: ${agg.count} open bids · ${agg.setAsideCount} set-asides · ${mapCompactValueLabel(agg)}`
                  : `${STATE_NAMES[code] ?? code}: no recorded open bids`;
                const { fill, glow } = mapFillFor(agg?.count ?? 0);
                return (
                  <a
                    key={code}
                    href={`/map?state=${code}`}
                    onMouseMove={(e) => handleMove(e.nativeEvent as any, code)}
                    onMouseEnter={(e) => handleMove(e.nativeEvent as any, code)}
                    className="outline-none"
                    aria-label={tooltip}
                  >
                    <path
                      d={US_STATE_PATHS[code]}
                      fill={fill}
                      stroke="#0b1220"
                      strokeWidth="1"
                      className="cursor-pointer transition-all duration-150 hover:brightness-125"
                      style={glow ? { filter: "url(#homeMapGlow)" } : undefined}
                    />
                  </a>
                );
              })}
            </svg>

            {/* hover totals tooltip (progressive enhancement — map renders fine without) */}
            {hovered && hoverAgg ? (
              <div
                className="pointer-events-none absolute z-20 max-w-xs rounded-lg border border-slate-600 bg-slate-900/95 px-3 py-2 text-xs shadow-xl"
                style={{
                  left: Math.min(hovered.x + 14, (containerRef.current?.clientWidth ?? 700) - 260),
                  top: hovered.y + 14,
                }}
              >
                <div className="font-semibold text-white">
                  {STATE_NAMES[hovered.code] ?? hovered.code}:{" "}
                  {`${hoverAgg.count} open bids · ${hoverAgg.setAsideCount} set-asides · ${mapCompactValueLabel(hoverAgg)}`}
                </div>
                <div className="mt-1 text-slate-400">
                  {hoverAgg.closingSoon} closing this week · stated value across {hoverAgg.withValue} of{" "}
                  {hoverAgg.count} bids
                </div>
              </div>
            ) : hovered ? (
              <div
                className="pointer-events-none absolute z-20 max-w-xs rounded-lg border border-slate-600 bg-slate-900/95 px-3 py-2 text-xs shadow-xl"
                style={{
                  left: Math.min(hovered.x + 14, (containerRef.current?.clientWidth ?? 700) - 260),
                  top: hovered.y + 14,
                }}
              >
                <div className="font-semibold text-white">
                  {STATE_NAMES[hovered.code] ?? hovered.code}: no recorded open bids
                </div>
              </div>
            ) : null}

            {/* One color scale only, matching /map */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
              <span className="font-medium text-slate-300">Fewer</span>
              {MAP_BUCKETS.map((b) => (
                <span key={b.label} className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: b.fill }} />
                  {b.label}
                </span>
              ))}
              <span className="text-slate-500">Brighter = more open opportunities</span>
            </div>
          </div>

          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
            <p className="text-center text-xs text-slate-500">
              Stated value is shown only across the opportunities that disclose one — never invented or padded.
            </p>
            <a
              href="/map"
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400"
            >
              Explore the full map &rarr;
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── FAR/DFARS Trust Strip ────────────────────────────────────────────────────
// Compact stats strip advertising the live FAR/DFARS clause corpus. Counts come
// from the DB at SSR time (getFarClauseCounts above) — never hardcoded. If the
// query fails or the table is empty the strip renders nothing rather than
// breaking the page or showing unverifiable numbers.
function FarClauseStats({
  stats,
}: {
  stats: { total: number; far: number; dfars: number } | null;
}) {
  if (!stats || stats.total <= 0) return null;
  return (
    <section
      className="border-b border-gray-100 bg-white py-12 sm:py-16"
      aria-label="FAR and DFARS clause database"
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col items-center gap-8 lg:flex-row lg:justify-between lg:gap-12">
          <h2 className="max-w-lg text-center text-2xl font-bold tracking-tight text-slate-900 lg:text-left">
            The verified FAR &amp; DFARS clause library.{" "}
            <span className="bg-gradient-to-r from-amber-500 to-amber-600 bg-clip-text text-transparent">
              Built into every draft.
            </span>
          </h2>
          <p className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl lg:text-right">
            Search {stats.total.toLocaleString()} verified FAR and DFARS clauses — free.
          </p>
        </div>
        <div className="mt-5 text-center">
          <a
            href="/clauses"
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100"
          >
            Browse the FAR Clause Library — {stats.total.toLocaleString()} real clauses, free
            <span aria-hidden="true">&rarr;</span>
          </a>
        </div>
      </div>
    </section>
  );
}

// ── Live Award Feed ────────────────────────────────────────────────────────────
// Renders REAL recent SET-ASIDE federal contract awards (SBA set-aside
// programs only — 8(a), SDVOSB, WOSB, HUBZone, VOSB) from USAspending.gov
// (cached by getLiveAwards above, 12h TTL). Self-hides when there are no rows —
// the same graceful pattern as FarClauseStats — so an API/cache failure never
// breaks SSR.
const money = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B`
  : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M`
  : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K`
  : `$${Math.round(n).toLocaleString()}`;

function fmtAwardDate(d: string | null): string | null {
  if (!d) return null;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function fmtFeedUpdated(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Live Award Feed ────────────────────────────────────────────────────────────
// Renders REAL recent SET-ASIDE federal contract awards (SBA set-aside
// programs only — 8(a), SDVOSB, WOSB, HUBZone, VOSB) from USAspending.gov
// (cached by getLiveAwards above, 12h TTL). Self-hides when there are no rows —
// the same graceful pattern as FarClauseStats — so an API/cache failure never
// breaks SSR.
//
// "I am a:" certification selector: chips [All set-asides] [8(a)] [SDVOSB]
// [WOSB] [HUBZone] [Small Business]. "All set-asides" is the default and uses
// the SSR feed untouched (no regression on the default homepage path). Picking
// a cert calls getLiveAwardsByCert client-side, which fetches that ONE set-
// aside code from USAspending and tags every row with the code it was fetched
// under (the only truthful type evidence — per-row "Set Aside Type" is null).
// A cert with zero rows shows an honest empty state, never a fabricated count.
const CERT_CHIPS = [
  { id: "all", label: "All set-asides", code: null as string | null },
  { id: "8a", label: "8(a)", code: "8A" },
  { id: "sdvosb", label: "SDVOSB", code: "SDVOSBC" },
  { id: "wosb", label: "WOSB", code: "WOSB" },
  { id: "hubzone", label: "HUBZone", code: "HZC" },
  { id: "sb", label: "Small Business", code: "SBA" },
];

function LiveAwardFeed({
  feed,
  activeId,
  onSelectId,
}: {
  feed: { awards: LiveAward[]; updatedAt: string | null };
  activeId: string;
  onSelectId: (id: string) => void;
}) {
  const [certFeed, setCertFeed] = useState<{ awards: LiveAward[]; updatedAt: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0); // stale-response guard for rapid chip switches
  // Fetch the per-cert feed whenever the selection changes. The selection
  // (activeId) lives in Home — shared by the top-of-page Personalization Hook
  // and this chip row — so both mirrored controls stay in lockstep (one source
  // of truth). All hooks run unconditionally (before the self-hide return below).
  useEffect(() => {
    if (activeId === "all") {
      setCertFeed(null);
      setLoading(false);
      return;
    }
    const chip = CERT_CHIPS.find((c) => c.id === activeId);
    setCertFeed(null); // never show a previous cert's rows under a new headline
    if (!chip?.code) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const req = ++reqRef.current;
    getLiveAwardsByCert({ data: chip.code as string })
      .then((result) => {
        if (req === reqRef.current) setCertFeed(result);
      })
      .catch(() => {
        // API failure — honest empty state, never a 500 in the UI
        if (req === reqRef.current) setCertFeed({ awards: [], updatedAt: null });
      })
      .finally(() => {
        if (req === reqRef.current) setLoading(false);
      });
  }, [activeId]);

  const allAwards = feed?.awards || [];
  if (!allAwards.length) return null; // graceful self-hide (FAR-strip pattern); hooks already run above

  const activeChip = CERT_CHIPS.find((c) => c.id === activeId) || CERT_CHIPS[0];
  const showAll = activeId === "all";
  const awards = showAll ? allAwards : certFeed?.awards || [];
  const updatedIso = showAll ? feed.updatedAt : certFeed?.updatedAt ?? null;
  const updated = updatedIso ? fmtFeedUpdated(updatedIso) : null;

  const subheadline = showAll
    ? `Recent set-aside awards already won · 8(a) · SDVOSB · WOSB · HUBZone · Source: USAspending.gov${updated ? ` · Updated ${updated}` : ""}`
    : `Recent ${activeChip.label} set-aside awards already won · Source: USAspending.gov${updated ? ` · Updated ${updated}` : ""}`;

  return (
    <section id="live-award-feed" className="border-b border-gray-100 bg-white py-12 sm:py-16" aria-label="Recent set-aside federal contract awards">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Recent Awards</h2>
          </div>
          <p className="text-sm text-gray-500">{subheadline}</p>
        </div>
        <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-gray-500">
          Real set-aside contracts that have already been awarded — what the incumbents won, so you know what to bid next. Different from the open solicitations below, which you can compete for right now.
        </p>

        {/* "I am a:" certification selector — wraps on mobile, no horizontal overflow */}
        <div className="mx-auto mt-8 flex max-w-4xl flex-wrap items-center justify-center gap-x-2 gap-y-2">
          <span className="mr-1 whitespace-nowrap text-sm font-semibold text-gray-500">I am a:</span>
          {CERT_CHIPS.map((chip) => {
            const isActive = chip.id === activeId;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => onSelectId(chip.id)}
                aria-pressed={isActive}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                    : "border-gray-300 bg-white text-gray-700 hover:border-slate-400 hover:text-slate-900"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        <div className="mx-auto mt-6 max-w-4xl divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {loading ? (
            <div className="px-5 py-6 text-center">
              <p className="text-sm font-medium text-gray-500">
                Loading recent {activeChip.label} set-aside awards…
              </p>
            </div>
          ) : awards.length ? (
            awards.map((award, i) => {
              const date = fmtAwardDate(award.last_modified);
              return (
                <div
                  key={award.award_id || `${award.recipient}-${award.amount}-${i}`}
                  className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900" title={award.recipient}>
                      {award.recipient}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      {award.agency || "Federal agency"}
                      {date ? ` · ${date}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
                    <span className="text-sm font-bold text-emerald-600">{money(award.amount)}</span>
                    {award.certLabel || award.set_aside ? (
                      <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-700">
                        {award.certLabel || award.set_aside}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-semibold text-slate-900">
                No recent {activeChip.label} set-aside awards in the feed right now
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Source: USAspending.gov — check back soon, or view the full set-aside feed.
              </p>
              <button
                type="button"
                onClick={() => onSelectId("all")}
                className="mt-4 inline-flex items-center justify-center rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:text-slate-900"
              >
                Show all set-asides
              </button>
            </div>
          )}
        </div>

        <div className="mt-10 text-center">
          <a
            href="/awards#feed"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition-all hover:bg-slate-800 hover:shadow-xl"
          >
            Explore recent awards & incumbent intel →
          </a>
        </div>
      </div>
    </section>
  );
}

// ── Product Showcase ──────────────────────────────────────────────────────────

const showcaseItems = [
  {
    emoji: "⚡",
    title: "Instant AI Executive Brief",
    description:
      "Skip the 80-page legal jargon. Get a plain-English 3-sentence summary of the actual scope of work in seconds.",
    href: "/radar",
    cta: "Search active bids",
  },
  {
    emoji: "✅",
    title: "Mandatory Qualifications Check",
    description:
      "Instantly see required trade licenses (TACLA, Electrical, GC), minimum insurance, bonding limits, and past performance clauses.",
    href: "/radar",
    cta: "See what's required",
  },
  {
    emoji: "⏰",
    title: "Critical Milestone Radar",
    description:
      "Never miss a mandatory pre-bid site walk or Q&A cutoff with real-time countdown alerts and verified dates.",
    href: "/signup?plan=basic",
    cta: "Start free",
  },
];

function ProductShowcase() {
  return (
    <section id="product-showcase" className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-amber-600">
            Built for set-aside small businesses
          </h2>
          <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Win set-aside contracts the big firms miss
          </h3>
          <p className="mt-4 text-lg leading-relaxed text-gray-600">
            Contrax finds the set-asides you qualify for, decodes what each RFP really requires,
            and drafts compliant responses — so your 8(a), SDVOSB, WOSB, or HUBZone certification
            becomes a winning edge, not a checkbox.
          </p>
        </div>

        <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {showcaseItems.map((item) => (
            <a
              key={item.title}
              href={item.href}
              className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-amber-300 hover:shadow-xl hover:shadow-slate-900/10"
            >
              <div className="flex items-center justify-center border-b border-gray-100 bg-gradient-to-br from-amber-50 to-white py-8 text-5xl">
                <span aria-hidden="true">{item.emoji}</span>
              </div>
              <div className="flex flex-1 flex-col p-6">
                <h4 className="text-lg font-bold text-slate-900">{item.title}</h4>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-600">
                  {item.description}
                </p>
                <span className="mt-4 inline-flex items-center text-sm font-semibold text-amber-600 transition-colors group-hover:text-amber-500">
                  {item.cta}
                  <svg
                    className="ml-1.5 h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </span>
              </div>
            </a>
          ))}
        </div>

        {/* CTA — free trial + free score */}
        <div className="mt-14 flex flex-col items-center justify-between gap-8 rounded-2xl bg-slate-900 p-8 text-center shadow-lg sm:flex-row sm:p-10 sm:text-left">
          <div className="max-w-xl">
            <p className="text-2xl font-bold text-white">Your certification is your edge. Put it to work.</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Start free — set-aside-matched opportunities, RFP summaries, AI proposal drafting, and
              certification deadline tracking, all in one place. 21-day free trial.
            </p>
          </div>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-4">
            <a
              href="/signup?plan=professional"
              onClick={() => trackEvent("hero_cta_click", "product_showcase")}
              className="inline-flex items-center rounded-xl bg-amber-500 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 hover:shadow-xl active:scale-[0.98]"
            >
              Start free trial →
            </a>
            <a
              href="/score"
              className="inline-flex items-center rounded-xl border border-slate-600 px-7 py-3.5 text-sm font-semibold text-slate-100 transition-all hover:border-slate-400 hover:text-white"
            >
              Score a solicitation free
            </a>
          </div>
        </div>
        {/* Bridge — the live feed now sits above the showcase (demo arc) */}
        <p className="mt-10 text-center text-sm text-gray-500">
          The live set-aside awards above are real, straight from USAspending.gov — Contrax is how you go from seeing them to winning them.
        </p>
      </div>
    </section>
  );
}

// ── Today's Solicitations ─────────────────────────────────────────────────────
// Normalizes raw SAM.gov set-aside labels to the app's brand names for badges.
function setAsideLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    sba: "8(a)",
    "8a": "8(a)",
    "8(a)": "8(a)",
    sdvosbc: "SDVOSB",
    sdvosb: "SDVOSB",
    vosbc: "VOSB",
    vosb: "VOSB",
    wosb: "WOSB",
    edwosb: "EDWOSB",
    "wosb/edwosb": "WOSB/EDWOSB",
    hzc: "HUBZone",
    hubzone: "HUBZone",
  };
  if (map[lower]) return map[lower];
  if (lower.includes("8(a)") || (lower.includes("8a") && lower.includes("sba"))) return "8(a)";
  if (lower.includes("service-disabled") || lower.includes("sdvosb")) return "SDVOSB";
  if (lower.includes("economically disadvantaged")) return "EDWOSB";
  if (lower.includes("women-owned") || lower.includes("women owned") || lower.includes("wosb")) return "WOSB";
  if (lower.includes("veteran-owned") || lower.includes("veteran owned") || lower.includes("vosb")) return "VOSB";
  if (lower.includes("hubzone") || lower.includes("hub zone")) return "HUBZone";
  return null; // unknown designation — hide the badge on the public teaser
}

// ── Closing Soon ─────────────────────────────────────────────────────────────
// "⏰ Closing in the next 7 days:" urgency section rendered directly above Open
// Opportunities. Lists REAL solicitations whose due_date is in (NOW, NOW+7d],
// deduped + low-content-filtered by the same shared SQL patterns as the feed.
// Sorted soonest-first; due dates within 48h are highlighted in amber for
// urgency. Value is the real estimated_value formatted as currency when numeric,
// otherwise the honest "Not specified" — never invented or rounded up. Set-Aside
// uses the same setAsideLabel() badge logic as the rest of the page. When the
// set is empty it shows an honest note — never pads with fake or overdue rows.
const fmtClosingDue = (d: string | null) => {
  // Normalize through the shared toISODate() helper (awards.tsx, PR #175) —
  // NEVER String(d).slice(0, 10), which parses to the fixed year 2001. Build
  // the calendar date from the ISO y/m/d so the shown day is the real due day
  // regardless of server timezone.
  const iso = toISODate(d);
  if (!iso) return null;
  const parts = iso.split("-").map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  if (Number.isNaN(date.getTime())) return null;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
};
const formatClosingValue = (v: string | null) => {
  if (!v) return "Not specified";
  const amount = Number(v);
  if (Number.isFinite(amount) && String(v).trim() !== "") {
    return amount.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }
  return "Not specified";
};
function ClosingSoon({ bids }: { bids: ClosingSoonBid[] }) {
  const now = Date.now();
  const within48h = (d: string | null) => {
    if (!d) return false;
    const t = new Date(d).getTime();
    return Number.isFinite(t) && t - now <= 48 * 60 * 60 * 1000;
  };
  const headerCols = "grid grid-cols-[2fr_1fr_0.6fr_0.8fr_0.6fr] items-center gap-3 px-5";
  return (
    <section
      id="closing-soon"
      className="border-b border-amber-200 bg-gradient-to-b from-amber-50/70 to-white py-12 sm:py-16"
      aria-label="Solicitations closing in the next 7 days"
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-2 text-center">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            </span>
            <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
              ⏰ Closing in the next 7 days:
            </h2>
          </div>
          <p className="text-sm text-gray-600">
            Real solicitations with deadlines in the next 7 days — sorted soonest first. Don&apos;t miss the window.
          </p>
        </div>

        {bids.length > 0 ? (
          <>
            <div className="mt-8 overflow-x-auto">
              <div className="mx-auto min-w-[720px] max-w-5xl overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
                <div className={`${headerCols} border-b border-amber-100 bg-amber-50/70 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500`}>
                  <span>Title</span>
                  <span>Agency</span>
                  <span>Due</span>
                  <span>Value</span>
                  <span>Set-Aside</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {bids.map((bid, i) => {
                    const due = fmtClosingDue(bid.due_date);
                    const soon = within48h(bid.due_date);
                    const badge = setAsideLabel(bid.set_aside);
                    const value = formatClosingValue(bid.estimated_value);
                    return (
                      <div key={`${bid.title}|${bid.agency}|${i}`} className={`${headerCols} py-3.5`}>
                        <a
                          href={`/signup?bid=${bid.id}&ticker_bid=${encodeURIComponent(bid.title)}&ticker_agency=${encodeURIComponent(bid.agency || "")}&closes=${encodeURIComponent(bid.due_date ?? "")}&value=${encodeURIComponent(bid.estimated_value ?? "")}&next=%2F%23closing-soon`}
                          title={bid.title}
                          onClick={() => trackEvent("signup_cta_click", "home_closing_soon_row", "/#closing-soon")}
                          className="line-clamp-2 text-sm font-semibold text-slate-800 transition-colors hover:text-amber-700"
                        >
                          {bid.title}
                        </a>
                        <span className="truncate text-xs text-gray-600" title={bid.agency}>
                          {bid.agency || "Federal agency"}
                        </span>
                        <span className={`text-sm font-semibold ${soon ? "text-amber-600" : "text-slate-800"}`}>
                          {due || "—"}
                        </span>
                        <span className="truncate text-xs text-gray-600">{value}</span>
                        <span>
                          {badge ? (
                            <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-700">
                              {badge}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <p className="mt-4 text-center text-xs text-gray-500">
              Source: synced SAM.gov &amp; state solicitations · updated every 4 hours
            </p>
          </>
        ) : (
          <div className="mx-auto mt-8 max-w-xl rounded-xl border border-dashed border-amber-300 bg-white/60 px-6 py-8 text-center">
            <p className="text-sm font-medium text-slate-700">
              No solicitations closing in the next 7 days right now
            </p>
            <p className="mt-1 text-xs text-gray-500">
              New opportunities are synced continuously — check back soon.
            </p>
          </div>
        )}
        <div className="mt-8 flex justify-center">
          <a
            // The `/` and `#` in the return path are URL-encoded (%2F%23) so the
            // browser treats `/#closing-soon` as PART of the `next` query value,
            // not as the fragment of the /signup URL. validateSearch decodes it
            // back to `/#closing-soon`, safeNext() accepts it (same-site relative,
            // not `//`), and the onboarding redirect (window.location.assign)
            // preserves the fragment so the user lands scrolled to #closing-soon.
            href="/signup?plan=starter&next=%2F%23closing-soon"
            onClick={() => trackEvent("signup_cta_click", "home_closing_soon_button", "/#closing-soon")}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-7 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-amber-600 active:scale-[0.98]"
          >
            Start free — track closing deadlines →
          </a>
        </div>
      </div>
    </section>
  );
}


// ── Healthcare Teaser (compact link → /healthcare-contracting) ────────────────
function HealthcareTeaser() {
  return (
    <section className="bg-white py-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <div>
          <p className="text-lg font-semibold text-slate-900">🏥 Healthcare Government Contracting</p>
          <p className="mt-1 text-sm text-gray-500">VA, HHS, DHA, and IHS set-aside opportunities for certified small businesses.</p>
        </div>
        <a href="/healthcare-contracting" className="shrink-0 font-semibold text-blue-700 transition-colors hover:text-blue-900">See healthcare contracting opportunities →</a>
      </div>
    </section>
  );
}

function OpenOpportunities({ bids, todayBids, openCount, q, user }: { bids: Bid[]; todayBids: { bids: TodayBid[]; count: number }; openCount: number; q: string; user: { id: number; email: string } | null }) {
  // Short, non-interactive preview (owner-directed): the full interactive feed
  // was redundant with the "⚠ Closing in the next 7 days" section above, so this
  // section now shows just the 3 newest open solicitations plus one Browse button.
  // Data plumbing (loader -> recentBids/openCount/todayBids) is left untouched;
  // todayBids is still accepted by the call site but no longer needed here.
  const fmtDue = (d: string | null) => {
    if (!d) return null;
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return null;
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    });
  };

  // The 3 newest real open solicitations, newest-first (low-content junk filtered).
  const preview = [...bids]
    .filter((b) => !isLowContent(b.title, b.location, b.set_aside))
    .sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    })
    .slice(0, 3);
  const keyOf = (title: string, agency: string) =>
    `${String(title).trim().toLowerCase()}|${String(agency || "").trim().toLowerCase()}`;
  const totalLabel = openCount.toLocaleString("en-US");
  // The only dedicated browse route is /opportunities/$setaside/$naics, which
  // requires both path params — a bare /opportunities serves no browse page.
  // Login-aware CTA (owner-directed): logged-out visitors go through the signup
  // flow with attribution + next-step back to /dashboard; logged-in users go
  // straight to /dashboard.
  const browseTarget = user ? "/dashboard" : "/signup?source=browse_all&next=/dashboard";

  return (
    <section id="open-opportunities" className="bg-gradient-to-b from-slate-50 to-white py-16 sm:py-20" aria-label="Open contract solicitations you can bid on now">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Open Opportunities</h2>
          <p className="text-lg leading-relaxed text-gray-600">
            What you can bid on right now — fresh set-aside and open solicitations from SAM.gov and city procurement, pulled in as they post. Browse titles free; full details are one signup away.
          </p>
          <a
            href="/map"
            className="mt-1 inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-5 py-2.5 text-sm font-semibold text-amber-700 transition-all hover:bg-amber-100 hover:shadow-sm"
          >
            🗺️ Explore the U.S. Contract Map &rarr;
          </a>
        </div>
        {q ? (
          <p className="mt-6 text-center text-sm font-medium text-slate-700">
            Showing results for &ldquo;{q}&rdquo; —{" "}
            <a href="/#open-opportunities" className="font-semibold text-amber-600 underline-offset-2 hover:underline">
              clear search to browse every open solicitation
            </a>
          </p>
        ) : (
          <>
            <div className="mx-auto mt-10 max-w-3xl divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              {preview.map((bid) => {
                const due = fmtDue(bid.due_date);
                return (
                  <div key={keyOf(bid.title, bid.agency)} className="flex items-center justify-between gap-4 px-6 py-4">
                    <div className="min-w-0">
                      <p className="line-clamp-1 text-sm font-semibold text-slate-800">{bid.title}</p>
                      <p className="mt-0.5 truncate text-xs text-gray-500">{bid.agency || "Federal agency"}</p>
                    </div>
                    {due && <span className="shrink-0 text-xs font-medium text-amber-700">Due {due}</span>}
                  </div>
                );
              })}
            </div>
            <div className="mt-10 text-center">
              <a
                href={browseTarget}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition-all hover:bg-slate-800 hover:shadow-xl"
              >
                Browse all {totalLabel} open opportunities →
              </a>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ── How It Works ──────────────────────────────────────────────────────────────

function HowItWorks() {
  const steps = [
    {
      number: "01",
      title: "Search Your Trade",
      tagline: "Find closing RFPs in your industry",
      description:
        "Enter your industry (HVAC, IT, Fleet, A&E, Roofing) to see active municipal and commercial RFPs closing soon.",
      href: "/radar",
      cta: "Search the market",
      icon: (
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
      ),
    },
    {
      number: "02",
      title: 'Click "Get AI Executive Brief"',
      tagline: "AI extracts requirements with citations",
      description:
        "Our model extracts the mandatory requirements, milestones, and red flags from the solicitation description, citing the relevant text.",
      href: "/example-brief",
      cta: "See an example brief",
      icon: (
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      ),
    },
    {
      number: "03",
      title: "Bid With Confidence",
      tagline: "Know your odds in seconds",
      description:
        "Understand in seconds whether the job matches your capacity, licensing, and bonding before spending hours on a proposal.",
      href: "/signup?plan=basic",
      cta: "Start free",
      icon: (
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
      ),
    },
  ];

  return (
    <section id="how-it-works" className="bg-gray-50 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">
            How it works
          </h2>
          <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Search. Brief. Bid.
          </h3>
          <p className="mt-4 text-lg text-gray-600">
            Find the RFPs in your industry, understand every requirement in seconds, and
            bid with confidence — all on Contrax.
          </p>
        </div>

        <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.number}
              className="group relative flex flex-col rounded-2xl border border-gray-200/60 bg-white p-8 shadow-sm transition-all hover:shadow-md"
            >
              <div className="mb-5 flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                  {step.icon}
                </div>
                <span className="text-sm font-bold text-blue-600/60">{step.number}</span>
              </div>
              <h3 className="text-xl font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-1 text-sm font-semibold text-amber-600">{step.tagline}</p>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-gray-600">{step.description}</p>
              <a
                href={step.href}
                className="mt-5 inline-flex items-center text-sm font-semibold text-blue-600 transition-colors hover:text-blue-700"
              >
                {step.cta}
                <svg
                  className="ml-1.5 h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Example / See It In Action ────────────────────────────────────────────────

function Example() {
  const outputs = [
    "Identified 23 FAR clauses applicable",
    "Drafted Executive Summary (340 words)",
    "Generated Past Performance matrix",
    "Built compliance checklist",
  ];

  return (
    <section className="bg-gray-50 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">
            See It In Action
          </h2>
          <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            From RFP to proposal draft in minutes
          </h3>
          <p className="mt-4 text-lg text-gray-600">
            Let Contrax handle the heavy lifting while you focus on winning the work.
          </p>
        </div>

        <div className="demo-shell mt-14 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-5 py-3 sm:px-7">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
              <span className="ml-2 text-xs font-medium text-slate-300">Contract Intelligence Copilot</span>
            </div>
            <span className="text-xs text-slate-400">Live workspace</span>
          </div>
          <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[.9fr_1.1fr] lg:gap-10 lg:p-10">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 sm:p-6">
              <div className="mb-5 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Source document</span>
                <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">RFP</span>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-semibold leading-relaxed text-slate-900">RFP: VA Medical Center IT Modernization</p>
                <p className="mt-2 text-xs text-slate-500">Solicitation VA-26-IT-0042 &nbsp;•&nbsp; 120 pages</p>
                <div className="mt-5 space-y-2">
                  <div className="h-2 w-full rounded bg-slate-100" /><div className="h-2 w-4/5 rounded bg-slate-100" /><div className="h-2 w-11/12 rounded bg-slate-100" />
                </div>
              </div>
              <div className="demo-analyzing mt-5 flex items-center gap-2 text-xs font-medium text-blue-700">
                <span className="h-2 w-2 animate-pulse rounded-full bg-blue-600" />
                Analyzing RFP requirements...
              </div>
            </div>
            <div className="flex min-h-[280px] flex-col rounded-xl border border-blue-100 bg-blue-50/40 p-5 sm:p-6">
              <div className="mb-5 flex items-center gap-2 border-b border-blue-100 pb-4">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-xs font-bold text-white">C</span>
                <span className="text-sm font-semibold text-slate-900">Contrax Copilot</span>
                <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Working</span>
              </div>
              <div className="flex flex-1 flex-col justify-center gap-3">
                {outputs.map((output, i) => (
                  <div key={output} className={`demo-output demo-output-${i + 1} flex items-start gap-2.5 rounded-lg bg-white px-3.5 py-3 text-sm text-slate-700 shadow-sm`}>
                    <span className="font-bold text-emerald-600">✓</span><span>{output}</span>
                  </div>
                ))}
                <div className="demo-ready mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-700">Proposal draft ready in under 3 minutes</div>
              </div>
            </div>
          </div>
          <div className="border-t border-slate-100 px-5 py-5 text-center sm:px-8">
            <a href="/signup" className="inline-flex items-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700">Try it free <span className="ml-1.5">→</span></a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Who It's For ──────────────────────────────────────────────────────────────

function WhoItsFor() {
  return (
    <section className="bg-gray-50 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">
            Who It&rsquo;s For
          </h2>
          <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Built for certified businesses that win government work
          </h3>
          <p className="mt-4 text-lg text-gray-600">
            Contrax is purpose-built for minority-, veteran-, and women-owned businesses pursuing
            8(a), SDVOSB, WOSB, and HUBZone set-aside contracts.
          </p>
        </div>

        <p className="mx-auto mt-12 max-w-2xl text-center text-lg text-gray-600">
          Built for certified small businesses across construction, technology, facilities, professional services, healthcare, and manufacturing.
        </p>

        {/* Set-aside focus */}
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-6 text-center sm:p-8">
            <svg className="mx-auto mb-4 h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-lg font-bold text-slate-900">Set-Aside Matching</h3>
            <p className="mt-2 text-gray-600">Automatically match bids to your certifications: 8(a), SDVOSB, WOSB, HUBZone</p>
          </div>
          <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-6 text-center sm:p-8">
            <svg className="mx-auto mb-4 h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499l2.125 5.111 5.518.442-4.204 3.602 1.285 5.385L12 14.654l-4.204 2.885 1.285-5.385-4.204-3.602 5.518-.442L12.52 3.5a.562.562 0 01-1.04 0z" />
            </svg>
            <h3 className="text-lg font-bold text-slate-900">Built around the set-aside journey</h3>
            <p className="mt-2 text-gray-600">Designed to help minority-, veteran-, and women-owned businesses identify and pursue the set-aside contracts their certifications make possible.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Compare Teaser (compact link → /compare) ───────────────────────────────────
function CompareTeaser() {
  return (
    <section className="bg-white py-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <div>
          <p className="text-lg font-semibold text-slate-900">Why small businesses choose Contrax</p>
          <p className="mt-1 text-sm text-gray-500">See how Contrax stacks up against the alternatives.</p>
        </div>
        <a href="/compare" className="shrink-0 font-semibold text-blue-700 transition-colors hover:text-blue-900">See how we compare →</a>
      </div>
    </section>
  );
}

// ── Pricing ───────────────────────────────────────────────────────────────────

function Pricing() {
  const plans = [
    {
      name: "Basic",
      price: "0",
      period: "/month",
      description: "Free forever. For small businesses scouting their first set-aside opportunities.",
      features: [
        "Basic Solicitations Search",
        "Up to 3 Saved Bids",
        "1 AI Executive Brief monthly",
        "Standard Set-Aside Filters",
      ],
      cta: "Start Free",
      slug: "basic",
      featured: false,
    },
    {
      name: "Starter",
      price: "19",
      period: "/month",
      description: "For businesses ready to build and track a real government-contracting pipeline.",
      features: [
        "Unlimited Saved Bids",
        "3 AI Executive Briefs monthly",
        "Daily NAICS Email Alerts",
        "CSV Pipeline Export",
      ],
      cta: "Get Started",
      slug: "starter",
      featured: false,
    },
    {
      name: "Professional",
      price: "79",
      period: "/month",
      description: "For growing businesses that win more with full RFP intelligence — 50 AI Executive Briefs a month, incumbent pricing, and draft tools.",
      features: [
        "50 AI Executive Briefs a month — requirements, milestones & red flags",
        "Full Incumbent Intelligence & Past Pricing",
        "AI Match Scoring",
        "Draft Tools",
      ],
      cta: "Get Started",
      slug: "professional",
      featured: true,
    },
  ];

  // Agency ($199/mo) is NOT part of the primary 3-tier matrix — kept separately
  // (Proposal Evaluator Red Team + team roles). Listed below the main grid.
  const agencyPlan = {
    name: "Agency",
    price: "199",
    period: "/month",
    description: "For firms managing multiple clients or large contract portfolios.",
    features: [
      "Everything in Professional",
      "200 AI Executive Briefs monthly",
      "Proposal Evaluator Red Team",
      "Team roles & permissions",
      "Integration connectors",
      "Win/loss bid tracking",
      "Team collaboration tools",
    ],
    cta: "Get Started",
    slug: "agency",
  };

  return (
    <section id="pricing" className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-amber-600">
            Pricing
          </h2>
          <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Plans for every stage of growth
          </h3>
          <p className="mt-4 text-lg text-gray-600">
            Start small and scale up as your contracting pipeline grows. No long-term contracts
            required.
          </p>
          <p className="mt-3 text-sm font-medium text-slate-500">Start free on Basic — no card required. Paid plans include a 21-day free trial. Cancel anytime.</p>
        </div>

        <div className="mt-14 grid gap-8 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-2xl border bg-white p-8 shadow-sm transition-all hover:shadow-lg ${
                plan.featured
                  ? "border-blue-500 ring-2 ring-blue-500/20 scale-[1.02] lg:scale-105"
                  : "border-gray-200"
              }`}
            >
              {plan.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-4 py-1 text-xs font-semibold uppercase tracking-wider text-white shadow-md">
                  Recommended
                </div>
              )}
              <div className="mb-6">
                <h3 className="text-xl font-bold text-slate-900">{plan.name}</h3>
                <p className="mt-1 text-sm text-gray-500">{plan.description}</p>
              </div>
              <div className="mb-6">
                <span className="text-4xl font-extrabold text-slate-900">${plan.price}</span>
                <span className="text-gray-500">{plan.period}</span>
              </div>
              <ul className="mb-8 flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <svg
                      className={`mt-0.5 h-5 w-5 flex-shrink-0 ${plan.featured ? "text-blue-600" : "text-green-500"}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-gray-700">{feature}</span>
                  </li>
                ))}
              </ul>
              <a href={`/signup?plan=${plan.slug}`} onClick={() => trackEvent("hero_cta_click", "pricing")} className={`block w-full rounded-xl px-6 py-3 text-center text-sm font-semibold transition-all active:scale-[0.98] ${plan.featured ? "bg-amber-500 text-white" : "border-2 border-slate-900 text-slate-900 hover:bg-slate-900 hover:text-white"}`}>{plan.cta}</a>
            </div>
          ))}
        </div>

        {/* Agency — kept separate from the primary 3-tier matrix */}
        <div className="mt-10">
          <div className="relative flex flex-col rounded-2xl border border-gray-200 bg-white p-8 shadow-sm transition-all hover:shadow-lg sm:flex-row sm:items-center sm:justify-between sm:gap-8">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-bold text-slate-900">{agencyPlan.name}</h3>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-wider text-slate-500">
                  Add-on
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-500">{agencyPlan.description}</p>
              <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-gray-600">
                {agencyPlan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-1.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-6 sm:mt-0 sm:text-right">
              <p className="text-3xl font-extrabold text-slate-900">
                ${agencyPlan.price}<span className="text-base font-normal text-gray-500">{agencyPlan.period}</span>
              </p>
              <a
                href={`/signup?plan=${agencyPlan.slug}`}
                onClick={() => trackEvent("hero_cta_click", "pricing")}
                className="mt-3 inline-block w-full rounded-xl border-2 border-slate-900 px-6 py-3 text-center text-sm font-semibold text-slate-900 transition-all hover:bg-slate-900 hover:text-white active:scale-[0.98] sm:w-auto"
              >
                {agencyPlan.cta}
              </a>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-gray-500">
            Agency includes the Proposal Evaluator "Red Team" and team roles — available separately from the core tiers.
          </p>
        </div>

        {/* Billing note */}
        <p className="mt-8 text-center text-sm text-gray-500">
          Plans are billed monthly. Cancel anytime.
        </p>
        <p className="mt-3 text-center">
          <a href="/signup" onClick={() => trackEvent("hero_cta_click", "pricing")} className="text-sm font-medium text-amber-600 hover:text-amber-500 transition-colors">
            Or start your free trial →
          </a>
        </p>
      </div>
    </section>
  );
}

// ── CTA ────────────────────────────────────────────────────────────────────────

function WaitlistSection() {
  return (
    <>
      <section className="bg-slate-900 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Ready to find your next government contract?
            </h2>
            <p className="mt-4 text-lg text-blue-100/70">
              Start finding and winning more contracts today with a plan built for your business.
            </p>
            <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <a
                href="/signup"
                onClick={() => trackEvent("hero_cta_click", "cta_final")}
                className="inline-flex items-center rounded-xl bg-amber-500 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 hover:shadow-xl hover:shadow-amber-500/30 active:scale-[0.98]"
              >
                Get Started
                <svg className="ml-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
              <a href="/signup" className="text-sm font-medium text-blue-300 hover:text-white transition-colors">
                No credit card required →
              </a>
            </div>
          </div>
        </div>
      </section>

    </>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-gray-800 bg-slate-900 py-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-700">
            <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
          <span className="text-lg font-bold text-white">Contrax</span>
        </div>
        <p className="text-sm text-gray-400">
          &copy; {new Date().getFullYear()} Contrax. All rights reserved.
        </p>
        <div className="flex flex-wrap items-center gap-5">
          <a href="/compare" className="text-sm text-gray-400 transition-colors hover:text-white">
            Compare
          </a>
          <a href="/clauses" className="text-sm text-gray-400 transition-colors hover:text-white">
            FAR Clause Library
          </a>
          <a href="/blog" className="text-sm text-gray-400 transition-colors hover:text-white">
            Blog
          </a>
          <a href="/about" className="text-sm text-gray-400 transition-colors hover:text-white">
            About
          </a>
          <a href="/vad" className="text-sm text-gray-400 transition-colors hover:text-white">
            Veterans Against Diabetes Pricing
          </a>
          <a href="/security" className="text-sm text-gray-400 transition-colors hover:text-white">
            Security
          </a>
          <a href="/privacy" className="text-sm text-gray-400 transition-colors hover:text-white">
            Privacy Policy
          </a>
          <a href="/terms" className="text-sm text-gray-400 transition-colors hover:text-white">
            Terms of Service
          </a>
          <a
            href="mailto:hello@contrax.company"
            className="text-sm text-gray-400 transition-colors hover:text-white"
          >
            hello@contrax.company
          </a>
        </div>
      </div>
    </footer>
  );
}
