import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Menu, Radar, X } from "lucide-react";
import { getCurrentUser } from "~/lib/auth";
import { trackEvent } from "~/lib/track";

// ── Types ─────────────────────────────────────────────────────────────────────
type Bid = {
  title: string;
  agency: string;
  estimated_value: string | null;
  due_date: string | null;
  location: string | null;
  category?: string | null;
  description?: string | null;
};
type TodayBid = {
  title: string;
  agency: string;
  set_aside: string | null;
  location: string | null;
  due_date: string | null;
};

// ── Server Functions ──────────────────────────────────────────────────────────

const getRecentBids = createServerFn({ method: "GET" }).handler(async () => {
  const { sql } = await import("~/db");
  const rows = await sql()`
    SELECT title, agency, estimated_value, due_date, location
    FROM bids
    ORDER BY created_at DESC NULLS LAST
    LIMIT 50
  `;
  return rows as Bid[];
});
const getTodayBids = createServerFn({ method: "GET" }).handler(async () => {
  const { sql } = await import("~/db");
  // Public teaser: titles only — no source URLs or descriptions for
  // unauthenticated visitors. Full detail lives behind the signup wall.
  const rows = await sql()`
    SELECT title, agency, set_aside, location, due_date
    FROM bids
    WHERE created_at >= NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC NULLS LAST
    LIMIT 10
  `;
  const countRows = await sql()`
    SELECT COUNT(*)::int AS count FROM bids WHERE created_at >= NOW() - INTERVAL '24 hours'
  `;
  return {
    bids: rows as TodayBid[],
    count: Number((countRows[0] as any)?.count || 0),
  };
});

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

const HEALTHCARE_KEYWORDS = [
  "health", "medical", "nurse", "nursing", "physician", "clinician", "clinical",
  "hospital", "tricare", "medicare", "medicaid", "pharma", "pharmacy", "dental",
  "behavioral", "mental health", "substance abuse", "telehealth",
  "telemedicine", "emr", "ehr", "hipaa",
];

/**
 * Construction/vehicle/utilities terms checked against the TITLE only. Many of
 * these words (road, street, gas, vehicle, van, bus, gate, fence, waste,
 * trash, recycling, sanitation, fuel, elevator…) routinely appear inside the
 * *descriptions* of genuine healthcare bids (street addresses, lab supplies,
 * medical transport, etc.), so a description-level check would wrongly drop
 * them — e.g. "…Babcock Road Medical Center…" in a real cardiology notice.
 * The original code checked only the title; that conservative behavior is
 * preserved here, plus "facility"/"facilities", which are safe only in titles
 * (healthcare descriptions are full of "…at the health care facility…"
 * boilerplate).
 */
const HEALTHCARE_EXCLUSIONS = [
  "truck", "trailer", "vehicle", "van", "bus", "bulldozer", "excavator", "crane",
  "forklift", "paving", "roofing", "concrete", "dumpster", "fence", "gate",
  "landscaping", "janitorial", "elevator", "hvac", "plumbing", "electrical",
  "generator", "fuel", "gas", "diesel", "manhole", "sewer", "drainage", "pipeline",
  "asphalt", "pavement", "sidewalk", "curb", "gutter", "road", "highway", "bridge",
  "culvert", "demolition", "waste", "trash", "recycling", "sanitation",
  "street", "wastewater", "rehabilitation", "renewal",
  "facility", "facilities",
];

/**
 * Unambiguous construction/facilities terms, checked against BOTH the title
 * and the description. These words never describe a healthcare *service*:
 * "roof"/"roof top"/"rtu" (rooftop unit) identify roofing/HVAC work,
 * "construction"/"renovation" identify facilities work, "stormwater"
 * identifies civil infrastructure.
 *
 * Deliberately NOT included: "repair", "replacement", "maintenance" — they are
 * over-broad and would wrongly exclude genuine healthcare bids, e.g. "medical
 * equipment repair" or the Defense Health Agency "…Asset Tracking System
 * Installation and Maintenance Services" notice (a real, wanted entry in this
 * section). See the category escape hatch below for how an explicit healthcare
 * category always wins.
 */
const HEALTHCARE_TEXT_EXCLUSIONS = [
  "roof", "roof top", "rtu", "construction", "renovation", "stormwater",
];

/**
 * Pure classification predicate — kept outside the server fn so it can be
 * unit-tested without a database. A bid is shown when it has a healthcare
 * signal (category match, or any healthcare keyword in title/description) and
 * no construction/facilities exclusion term. An explicit healthcare category
 * match always wins over exclusion terms.
 */
export function isHealthcareBid(bid: {
  title: string;
  description: string;
  category: string;
}): boolean {
  const title = (bid.title ?? "").toLowerCase();
  const category = (bid.category ?? "").toLowerCase();
  const description = (bid.description ?? "").toLowerCase();
  const categoryMatchesHealthcare = HEALTHCARE_KEYWORDS.some((keyword) =>
    category.includes(keyword),
  );
  const text = `${title} ${description}`;
  const healthcareMatchCount = HEALTHCARE_KEYWORDS.filter((keyword) =>
    text.includes(keyword),
  ).length;
  const hasStrongHealthcareSignal = categoryMatchesHealthcare || healthcareMatchCount >= 1;
  const hasExcludedTerm =
    HEALTHCARE_EXCLUSIONS.some((term) => title.includes(term)) ||
    HEALTHCARE_TEXT_EXCLUSIONS.some((term) => text.includes(term));

  return hasStrongHealthcareSignal && (!hasExcludedTerm || categoryMatchesHealthcare);
}

const getHealthcareBids = createServerFn({ method: "GET" }).handler(async () => {
  const { sql } = await import("~/db");
  const patterns = HEALTHCARE_KEYWORDS.map((keyword) => `%${keyword}%`);
  const rows = await sql()`
    SELECT title, agency, estimated_value, due_date, location, category, description
    FROM bids
    WHERE LOWER(category) ILIKE ANY(${patterns}::text[])
       OR LOWER(title) ILIKE ANY(${patterns}::text[])
       OR LOWER(description) ILIKE ANY(${patterns}::text[])
    ORDER BY created_at DESC NULLS LAST
    LIMIT 10
  `;

  return (rows as Bid[]).filter((bid) =>
    isHealthcareBid({
      title: bid.title ?? "",
      description: bid.description ?? "",
      category: bid.category ?? "",
    }),
  );
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
const getBidStats = async (): Promise<{ totalBids: number; agencyCount: number }> => {
  try {
    const { sql } = await import("~/db");
    const [bids, agencies] = await Promise.all([
      sql()`SELECT COUNT(*)::int AS count FROM bids`,
      sql()`SELECT COUNT(DISTINCT agency)::int AS count FROM bids`,
    ]);
    return {
      totalBids: Number((bids[0] as any)?.count || 0),
      agencyCount: Number((agencies[0] as any)?.count || 0),
    };
  } catch {
    // bids table may not exist yet — hide the stat row entirely
    return { totalBids: 0, agencyCount: 0 };
  }
};
const getLandingData = createServerFn({ method: "GET" }).handler(async () => {
  const { sql } = await import("~/db");
  const [businessName, user, bids, healthcareBids, todayBids, liveAwards, userCount, bidStats, farClauseCounts] = await Promise.all([
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
    getRecentBids(),
    getHealthcareBids(),
    getTodayBids(),
    getLiveAwards(),
    getUserCount(),
    getBidStats(),
    getFarClauseCounts(),
  ]);
  let alertCount = 0;
  if (user) {
    try {
      await sql()`CREATE TABLE IF NOT EXISTS bid_alerts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), bid_id INTEGER NOT NULL REFERENCES bids(id), alert_type TEXT DEFAULT 'new_match', is_read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, bid_id, alert_type))`;
      const rows = await sql()`SELECT COUNT(*)::int AS count FROM bid_alerts WHERE user_id=${user.id} AND is_read=false`;
      alertCount = Number((rows[0] as any)?.count || 0);
    } catch { /* table or query failed — safe to return 0 */ }
  }
  return { businessName, user, bids, healthcareBids, alertCount, userCount, bidStats, todayBids, farClauseCounts, liveAwards };
});

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/")({
  loader: () => getLandingData(),
  component: Home,
  head: () => ({
    meta: [
      { title: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
      {
        name: "description",
        content:
          "Find and win government contracts reserved for businesses like yours. Contrax matches your 8(a), SDVOSB, WOSB, or HUBZone certification to live SAM.gov and city procurement opportunities — with 5-year incumbent pricing data so you know what to bid before you write a word.",
      },
      { name: "robots", content: "index, follow" },
      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.contrax.company" },
      { property: "og:title", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
      {
        property: "og:description",
        content:
          "Find and win government contracts reserved for businesses like yours. Contrax matches your 8(a), SDVOSB, WOSB, or HUBZone certification to live SAM.gov and city procurement opportunities — with 5-year incumbent pricing data so you know what to bid before you write a word.",
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
          "Find and win government contracts reserved for businesses like yours. Contrax matches your 8(a), SDVOSB, WOSB, or HUBZone certification to live SAM.gov and city procurement opportunities — with 5-year incumbent pricing data so you know what to bid before you write a word.",
      },
      { name: "twitter:image", content: "https://www.contrax.company/logo-square.png" },
      { name: "twitter:image:alt", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company" }],
  }),
});

// ── Page Component ────────────────────────────────────────────────────────────

function Home() {
  const { businessName, user, bids, healthcareBids, alertCount, userCount, bidStats, todayBids, farClauseCounts, liveAwards } = Route.useLoaderData();

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


  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navbar user={user} alertCount={alertCount} />
      <Hero businessName={businessName} userCount={userCount} bidStats={bidStats} />
      <ProductShowcase />
      <LiveAwardFeed feed={liveAwards} />
      <FarClauseStats stats={farClauseCounts} />
      <TodaySolicitations todayBids={todayBids} />
      <BidTicker bids={bids} />
      <HealthcareOpportunities bids={healthcareBids} />
      <HowItWorks />
      <Pricing />
      <Example />
      <WhoItsFor />
      <ROICalculator />
      <CompetitorComparison />
      <LeadCapture />
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
  businessName,
  userCount,
  bidStats,
}: {
  businessName: string;
  userCount: number;
  bidStats: { totalBids: number; agencyCount: number };
}) {
  const navigate = useNavigate();
  const [scoreText, setScoreText] = useState("");
  const handleScoreSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = scoreText.trim();
    // `score_submit` is fired by /score's handleScore when the analysis actually starts
    // (both for this ?text= auto-run and manual "Score it" clicks) — firing it here too
    // would double-count every hero submission.
    trackEvent("hero_cta_click", "hero_score");
    navigate({ to: "/score", search: text ? { text } : {} });
  };
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
      {/* Subtle background pattern */}
      <div className="absolute inset-0 bg-[url('data:image/png;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-50" />
      <div className="relative mx-auto max-w-7xl px-6 pb-24 pt-20 sm:pb-32 sm:pt-24 lg:pb-40 lg:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/10 px-4 py-1.5 text-sm font-medium text-blue-200">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
            </span>
            Contract Intelligence Platform
          </div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3.5 py-1 text-xs font-medium text-emerald-200">
            <svg className="h-3.5 w-3.5 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Transparent pricing from $19/mo — 21-day free trial
          </div>
          {bidStats.totalBids > 0 && bidStats.agencyCount > 0 && (
            <div className="mb-6 flex items-center justify-center gap-2 text-sm text-blue-200/80">
              <Radar className="h-4 w-4 shrink-0 text-amber-300" />
              <span>
                Tracking{" "}
                <span className="font-semibold text-amber-300">
                  {bidStats.totalBids.toLocaleString()}
                </span>{" "}
                active solicitations across{" "}
                <span className="font-semibold text-amber-300">
                  {bidStats.agencyCount.toLocaleString()}
                </span>{" "}
                agencies — updated every 4 hours on weekdays
              </span>
            </div>
          )}
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
            Find and win government contracts{" "}
            <span className="bg-gradient-to-r from-amber-300 to-amber-500 bg-clip-text text-transparent">
              reserved for businesses like yours.
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-blue-100/80 sm:text-xl">
            Every morning, {businessName} monitors SAM.gov, all 50 state portals, and five city procurement sites for opportunities your
            8(a), SDVOSB, WOSB, or HUBZone certification qualifies for.
          </p>
          <div className="mt-4 mx-auto max-w-xl rounded-xl border border-amber-400/15 bg-amber-400/5 px-6 py-4 backdrop-blur-sm">
            <p className="text-base font-semibold text-amber-200">
              <span className="text-amber-400">Know what to bid before you write a word.</span>{" "}
              We pull 5 years of incumbent pricing so you're never guessing.
            </p>
          </div>
          <div className="mt-6 mx-auto max-w-xl">
            <p className="mb-3 text-sm font-medium text-blue-200">Try it now — no signup required</p>
            <form
              onSubmit={handleScoreSubmit}
              rel="nofollow"
              className="flex flex-col gap-2 sm:flex-row"
            >
              <input
                type="text"
                value={scoreText}
                onChange={(e) => setScoreText(e.target.value)}
                placeholder="Paste a solicitation title or description..."
                className="flex-1 rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-blue-300/60 backdrop-blur-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
              />
              <button
                type="submit"
                className="shrink-0 rounded-xl bg-white/15 px-5 py-3 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/25 sm:w-auto w-full"
              >
                Score it free →
              </button>
            </form>
            <p className="mt-3 text-center text-xs font-medium text-blue-200/80 sm:text-sm">
              <span className="font-semibold text-amber-300">3 free scores</span> — no login to try
            </p>
          </div>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <a
              href="/awards#feed"
              onClick={() => trackEvent("hero_cta_click", "hero_primary")}
              className="inline-flex items-center rounded-xl bg-amber-500 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 hover:shadow-xl hover:shadow-amber-500/30 active:scale-[0.98]"
            >
              Get Incumbent Intel
              <svg className="ml-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
            <a
              href="#how-it-works"
              className="inline-flex items-center rounded-xl px-6 py-4 text-base font-medium text-blue-100 transition-colors hover:text-white"
            >
              See how it works
              <svg className="ml-1.5 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </a>
          </div>
          <p className="mt-6 flex items-center justify-center gap-1.5 text-sm text-blue-200/70">
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
            Most contractors pay for Westlaw to search regulatory text.{" "}
            <span className="bg-gradient-to-r from-amber-500 to-amber-600 bg-clip-text text-transparent">
              Contrax has it built in.
            </span>
          </h2>
          <div className="flex items-center gap-8 sm:gap-12">
            <div className="text-center">
              <p className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
                {stats.total.toLocaleString()}
              </p>
              <p className="mt-2 text-sm font-medium text-gray-500">
                FAR &amp; DFARS clauses indexed
              </p>
            </div>
            <div className="h-14 w-px bg-gray-200" aria-hidden="true" />
            <div className="text-center">
              <p className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                {stats.far.toLocaleString()}
              </p>
              <p className="mt-2 text-sm font-medium text-gray-500">FAR clauses</p>
            </div>
            <div className="h-14 w-px bg-gray-200" aria-hidden="true" />
            <div className="text-center">
              <p className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                {stats.dfars.toLocaleString()}
              </p>
              <p className="mt-2 text-sm font-medium text-gray-500">DFARS clauses</p>
            </div>
          </div>
        </div>
        <p className="mt-8 text-center text-sm text-gray-500">
          Exact citations, refreshed daily — complete FAR (parts 1–53) and DFARS
          (201–253, 270) clause text.
        </p>
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

function LiveAwardFeed({ feed }: { feed: { awards: LiveAward[]; updatedAt: string | null } }) {
  const [activeId, setActiveId] = useState("all");
  const [certFeed, setCertFeed] = useState<{ awards: LiveAward[]; updatedAt: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0); // stale-response guard for rapid chip switches
  const allAwards = feed?.awards || [];
  if (!allAwards.length) return null; // graceful self-hide (FAR-strip pattern); hooks already run above

  const activeChip = CERT_CHIPS.find((c) => c.id === activeId) || CERT_CHIPS[0];
  const showAll = activeId === "all";
  const awards = showAll ? allAwards : certFeed?.awards || [];
  const updatedIso = showAll ? feed.updatedAt : certFeed?.updatedAt ?? null;
  const updated = updatedIso ? fmtFeedUpdated(updatedIso) : null;

  const selectChip = async (chip: (typeof CERT_CHIPS)[number]) => {
    if (chip.id === activeId) return; // already active — no event, no refetch
    trackEvent("feed_filter_click", chip.id); // fire-and-forget, never blocks UI
    const req = ++reqRef.current;
    setActiveId(chip.id);
    if (chip.id === "all") {
      setCertFeed(null);
      setLoading(false);
      return;
    }
    setCertFeed(null); // never show a previous cert's rows under a new headline
    setLoading(true);
    try {
      const result = await getLiveAwardsByCert({ data: chip.code as string });
      if (req === reqRef.current) setCertFeed(result);
    } catch {
      // API failure — honest empty state, never a 500 in the UI
      if (req === reqRef.current) setCertFeed({ awards: [], updatedAt: null });
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  };

  const subheadline = showAll
    ? `Recent set-aside awards · 8(a) · SDVOSB · WOSB · HUBZone · Source: USAspending.gov${updated ? ` · Updated ${updated}` : ""}`
    : `Recent ${activeChip.label} set-aside awards · Source: USAspending.gov${updated ? ` · Updated ${updated}` : ""}`;

  return (
    <section className="border-b border-gray-100 bg-white py-12 sm:py-16" aria-label="Live set-aside federal contract awards">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Live Award Feed</h2>
          </div>
          <p className="text-sm text-gray-500">{subheadline}</p>
        </div>

        {/* "I am a:" certification selector — wraps on mobile, no horizontal overflow */}
        <div className="mx-auto mt-8 flex max-w-4xl flex-wrap items-center justify-center gap-x-2 gap-y-2">
          <span className="mr-1 whitespace-nowrap text-sm font-semibold text-gray-500">I am a:</span>
          {CERT_CHIPS.map((chip) => {
            const isActive = chip.id === activeId;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => selectChip(chip)}
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
                onClick={() => selectChip(CERT_CHIPS[0])}
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
            Browse live opportunities →
          </a>
        </div>
      </div>
    </section>
  );
}

// ── Product Showcase ──────────────────────────────────────────────────────────

const showcaseItems = [
  {
    src: "/screenshots/score-tool.png",
    alt: "Can I Win This? — Contrax solicitation scoring tool",
    badge: "3 free scores",
    title: "Understand what the RFP really requires",
    description:
      "Paste any solicitation and get an instant win-probability analysis across 9 dimensions — GO, CAUTIOUS, or NO-GO — so you invest your hours where you actually have a shot. 3 free scores, no login to try.",
    href: "/score",
    cta: "Score a solicitation",
  },
  {
    src: "/screenshots/copilot.png",
    alt: "Contract Intelligence Copilot — Contrax strategist",
    badge: "Strategist",
    title: "Draft compliant responses faster",
    description:
      "The Copilot drafts proposal sections around the RFP's evaluation criteria and flags missing clauses before you submit — grounded in your certifications, active bids, and win/loss history.",
    href: "/copilot",
    cta: "Meet the copilot",
  },
  {
    src: "/screenshots/hero.png",
    alt: "Contrax full platform overview",
    badge: "Full platform",
    title: "Find set-asides you actually qualify for",
    description:
      "Set-aside-first matching filters SAM.gov and city opportunities by your 8(a), SDVOSB, WOSB, or HUBZone certification — and tracks your certification deadlines so eligibility never silently lapses.",
    href: "/signup",
    cta: "Get started",
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
              <div className="relative overflow-hidden border-b border-gray-100">
                <img
                  src={item.src}
                  alt={item.alt}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[1280/577] w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
                />
                <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-slate-900/80 px-2.5 py-1 text-xs font-medium text-amber-300 backdrop-blur-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  {item.badge}
                </span>
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
        {/* Bridge to the Live Award Feed */}
        <p className="mt-10 text-center text-sm text-gray-500">
          Real federal awards are posted every day — your next opportunity is waiting right below.
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
function TodaySolicitations({ todayBids }: { todayBids: { bids: TodayBid[]; count: number } }) {
  const { bids, count } = todayBids;
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
  return (
    <section className="bg-gradient-to-b from-slate-50 to-white py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Newest solicitations</h2>
          {count > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              {count} new contract{count !== 1 ? "s" : ""} posted in the last 24 hours
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-500">
              No new solicitations in the last 24 hours
            </span>
          )}
          <p className="text-lg leading-relaxed text-gray-600">
            Fresh set-aside opportunities from SAM.gov and city procurement — pulled in as they post. Browse titles free; full details are one signup away.
          </p>
        </div>
        {bids.length > 0 ? (
          <>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {bids.map((bid, i) => {
                const due = fmtDue(bid.due_date);
                const setAside = setAsideLabel(bid.set_aside);
                return (
                  <div key={i} className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:border-amber-300 hover:shadow-md">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                        {bid.agency && bid.agency.length > 40 ? bid.agency.slice(0, 40) + "..." : bid.agency || "Federal agency"}
                      </span>
                      {setAside && (
                        <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-700">
                          {setAside}
                        </span>
                      )}
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm font-semibold text-slate-800" title={bid.title}>{bid.title}</p>
                    <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                      {bid.location && <span className="truncate">📍 {bid.location}</span>}
                      {bid.location && due && <span className="text-gray-300">·</span>}
                      {due && <span className="shrink-0 font-medium text-amber-700">Due {due}</span>}
                    </div>
                    <div className="mt-auto pt-4">
                      <a
                        href={`/signup?today_bid=${encodeURIComponent(bid.title)}`}
                        className="inline-flex items-center text-sm font-semibold text-amber-600 transition-colors hover:text-amber-800"
                      >
                        Sign up to see details →
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-12 text-center">
              <a
                href="/signup"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition-all hover:bg-slate-800 hover:shadow-xl"
              >
                Get the full RFP details, AI analysis, and daily alerts →
              </a>
            </div>
          </>
        ) : (
          <div className="mt-10 rounded-xl border border-dashed border-gray-300 bg-white/60 px-6 py-12 text-center">
            <p className="text-base font-medium text-slate-700">Check back soon — new solicitations are posted throughout the day</p>
            <p className="mx-auto mt-2 max-w-xl text-sm text-gray-500">
              We monitor SAM.gov and city procurement portals continuously and pull new set-aside opportunities as they hit. Sign up and we&apos;ll alert you the moment one matches your certifications.
            </p>
            <a
              href="/signup"
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition-all hover:bg-slate-800"
            >
              Get the full RFP details, AI analysis, and daily alerts →
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
// ── Live Bid Ticker ───────────────────────────────────────────────────────────

function BidTicker({ bids }: { bids: Bid[] }) {
  // Do not expose an internal sync-status message when there are no bids yet.
  // The ticker is only useful when it has real opportunities to display.
  if (bids.length === 0) return null;

  // Dedupe by title + agency, then double for seamless scroll
  const seen = new Set<string>();
  const unique = bids.filter((b) => {
    const key = `${b.title}|${b.agency}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const tickerBids = unique.length > 0 ? [...unique, ...unique] : [];

  return (
    <section className="overflow-hidden bg-white py-14">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-8 flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          </span>
          <h2 className="text-2xl font-bold text-slate-900">Live Opportunities</h2>
        </div>
        <p className="mb-6 text-gray-500">Real government contracts being tracked right now</p>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes ticker-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-track {
          display: flex;
          gap: 1rem;
          width: max-content;
          animation: ticker-scroll 30s linear infinite;
        }
        .ticker-track:hover {
          animation-play-state: paused;
        }
      `}} />

      <div className="ticker-track px-6">
        {tickerBids.map((bid, i) => (
          <a
            key={i}
            href={`/signup?ticker_bid=${encodeURIComponent(bid.title)}&ticker_agency=${encodeURIComponent(bid.agency || "")}`}
            className="group w-72 flex-shrink-0 rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-all hover:border-amber-300 hover:shadow-md no-underline"
          >
            <span className="mb-2 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 group-hover:bg-amber-100 group-hover:text-amber-700">
              {bid.agency}
            </span>
            <p
              className="line-clamp-1 text-sm font-medium text-slate-800 group-hover:text-amber-700"
              title={bid.title}
            >
              {bid.title.length > 80 ? bid.title.slice(0, 80) + "..." : bid.title}
            </p>
            <div className="mt-2 flex items-center justify-between">
              {bid.estimated_value ? (
                <span className="text-xs font-semibold text-green-600">
                  {bid.estimated_value}
                </span>
              ) : (
                <span className="text-xs text-gray-400">Value TBD</span>
              )}
              {bid.location ? (
                <span className="ml-2 truncate text-xs text-gray-400">
                  {bid.location}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-xs font-medium text-amber-600 opacity-0 transition-opacity group-hover:opacity-100">
              View details & draft proposal →
            </p>
          </a>
        ))}
      </div>
    </section>
  );
}

// ── Healthcare Opportunities ───────────────────────────────────────────────────

function HealthcareOpportunities({ bids }: { bids: Bid[] }) {
  const formatValue = (value: string | null) => {
    if (!value) return null;
    const amount = Number(value);
    return Number.isFinite(amount)
      ? amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
      : value;
  };

  return (
    <section className="bg-gradient-to-br from-blue-50 to-white py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="text-2xl" aria-hidden="true">🏥</span>
            <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Healthcare Government Contracting</h2>
          </div>
          <p className="mt-4 text-lg leading-relaxed text-gray-600">
            The federal government is the largest healthcare purchaser in the United States — VA, HHS, DHA, and IHS spend billions annually on staffing, IT, supplies, and facilities contracts. Many are set aside for certified small businesses.
          </p>
          <p className="mt-4 text-sm font-semibold text-blue-700">
            {bids.length} active healthcare opportunities tracked
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bids.map((bid, i) => {
            const value = formatValue(bid.estimated_value);
            return (
              <div key={i} className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm transition-all hover:border-blue-300 hover:shadow-md">
                <span className="mb-3 inline-block rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  {bid.agency.length > 40 ? bid.agency.slice(0, 40) + "..." : bid.agency}
                </span>
                <p className="line-clamp-2 text-sm font-semibold text-slate-800" title={bid.title}>{bid.title}</p>
                <div className="mt-4 flex items-center justify-between gap-3">
                  {value ? <span className="text-sm font-bold text-emerald-600">{value}</span> : <span />}
                  {bid.due_date && <span className="text-sm font-semibold text-amber-700">Due {new Date(bid.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
                </div>
                {bid.location && <p className="mt-3 text-xs text-gray-500">📍 {bid.location}</p>}
              </div>
            );
          })}
        </div>
        {bids.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-500">
            We’re scanning federal healthcare opportunities now. Sign up to be among the first to hear when a strong-fit contract is found.
          </p>
        )}
        <div className="mt-10 text-center">
          <a href="/awards?search=healthcare" className="font-semibold text-blue-700 transition-colors hover:text-blue-900">
            View all healthcare opportunities →
          </a>
        </div>
      </div>
    </section>
  );
}

// ── How It Works ──────────────────────────────────────────────────────────────

function HowItWorks() {
  const steps = [
    {
      number: "01",
      title: "Tell us what you do",
      description:
        "Describe your business — like “We install commercial flooring” — and set your location and industry preferences. No complex setup required.",
      icon: (
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
        </svg>
      ),
    },
    {
      number: "02",
      title: "We find your matches",
      description:
        "Contrax monitors federal and city procurement sites daily, filtering thousands of opportunities to surface only the ones relevant to your business.",
      icon: (
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
      ),
    },
    {
      number: "03",
      title: "Win more contracts",
      description:
        "Get plain-English summaries, drafted proposal responses, and compliance checklists for every opportunity — so you submit faster and win more.",
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
            How It Works
          </h2>
          <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            From search to submission in three steps
          </h3>
          <p className="mt-4 text-lg text-gray-600">
            Stop spending hours digging through procurement portals. Contrax automates the entire
            workflow.
          </p>
        </div>

        <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.number}
              className="group relative rounded-2xl border border-gray-200/60 bg-white p-8 shadow-sm transition-all hover:shadow-md"
            >
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                {step.icon}
              </div>
              <span className="text-sm font-bold text-blue-600/60">{step.number}</span>
              <h3 className="mt-2 text-xl font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-3 text-gray-600 leading-relaxed">{step.description}</p>
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
  const categories = [
    { name: "Construction", icon: "🏗️" },
    { name: "IT Services", icon: "💻" },
    { name: "Landscaping", icon: "🌿" },
    { name: "Janitorial", icon: "🧹" },
    { name: "Security", icon: "🛡️" },
    { name: "HVAC", icon: "❄️" },
    { name: "Plumbing & Electrical", icon: "🔧" },
    { name: "Marketing Agencies", icon: "📊" },
    { name: "Manufacturing", icon: "🏭" },
    { name: "Healthcare", icon: "🏥" },
  ];

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

        <div className="mt-14 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {categories.map((cat) => (
            <div
              key={cat.name}
              className="flex flex-col items-center gap-3 rounded-xl border border-gray-200/60 bg-white p-6 text-center shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
            >
              <span className="text-2xl">{cat.icon}</span>
              <span className="text-sm font-semibold text-slate-800">{cat.name}</span>
            </div>
          ))}
        </div>

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

// ── ROI Calculator ────────────────────────────────────────────────────────────

function ROICalculator() {
  const [hoursPerWeek, setHoursPerWeek] = useState(10);
  const [bidsPerYear, setBidsPerYear] = useState(12);
  const [avgContractValue, setAvgContractValue] = useState(50000);

  const hourlyRate = 75;
  const contraxCost = 79;
  const timeSavingsPercent = 0.8;

  const monthlyTimeSavings = (hoursPerWeek * 4) * timeSavingsPercent;
  const monthlyManualCost = hoursPerWeek * 4 * hourlyRate;
  const annualSavings = (monthlyManualCost - contraxCost) * 12;

  const barMax = Math.max(monthlyManualCost, contraxCost);
  const manualBarPct = Math.min(100, (monthlyManualCost / barMax) * 100);
  const contraxBarPct = Math.min(100, (contraxCost / barMax) * 100);

  return (
    <section className="bg-gray-50 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-blue-600">
            ROI Calculator
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            What&rsquo;s bid searching costing you?
          </h2>
          <p className="mt-4 text-lg text-gray-600">
            See how much time and money Contrax saves your business
          </p>
        </div>

        <div className="mt-14 grid gap-8 lg:grid-cols-2">
          {/* Left: Inputs */}
          <div className="space-y-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
            {/* Slider 1: Hours per week */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  Hours per week spent searching for bids
                </label>
                <span className="text-sm font-bold text-blue-600">{hoursPerWeek}h</span>
              </div>
              <input
                type="range"
                min="1"
                max="40"
                step="1"
                value={hoursPerWeek}
                onChange={(e) => setHoursPerWeek(Number(e.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-blue-600"
              />
              <div className="mt-1 flex justify-between text-xs text-gray-400">
                <span>1h</span>
                <span>40h</span>
              </div>
            </div>

            {/* Slider 2: Bids per year */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  Bids submitted per year
                </label>
                <span className="text-sm font-bold text-blue-600">{bidsPerYear}</span>
              </div>
              <input
                type="range"
                min="1"
                max="100"
                step="1"
                value={bidsPerYear}
                onChange={(e) => setBidsPerYear(Number(e.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-blue-600"
              />
              <div className="mt-1 flex justify-between text-xs text-gray-400">
                <span>1</span>
                <span>100</span>
              </div>
            </div>

            {/* Slider 3: Average contract value */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  Average contract value
                </label>
                <span className="text-sm font-bold text-blue-600">
                  ${avgContractValue.toLocaleString()}
                </span>
              </div>
              <input
                type="range"
                min="5000"
                max="5000000"
                step="5000"
                value={avgContractValue}
                onChange={(e) => setAvgContractValue(Number(e.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-blue-600"
              />
              <div className="mt-1 flex justify-between text-xs text-gray-400">
                <span>$5K</span>
                <span>$5M</span>
              </div>
            </div>

            <p className="text-xs text-gray-400">
              Based on an internal hourly rate of <strong>$75/hr</strong>. Contrax saves
              an estimated <strong>80%</strong> of bid-searching time.
            </p>
          </div>

          {/* Right: Results */}
          <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-6 shadow-sm sm:p-8">
            <h3 className="mb-6 text-lg font-bold text-slate-900">
              Your Savings Breakdown
            </h3>

            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-blue-100 py-3">
                <span className="text-sm text-gray-600">Monthly time savings</span>
                <span className="text-sm font-bold text-slate-800">
                  {monthlyTimeSavings.toFixed(1)} hours/month
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-blue-100 py-3">
                <span className="text-sm text-gray-600">Monthly cost of manual searching</span>
                <span className="text-sm font-bold text-red-500">
                  ${monthlyManualCost.toLocaleString()}/mo
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-blue-100 py-3">
                <span className="text-sm text-gray-600">Your cost with Contrax Professional</span>
                <span className="text-sm font-bold text-green-600">$79/mo</span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-sm font-semibold text-slate-800">Annual savings</span>
                <span className="text-lg font-bold text-green-600">
                  ${annualSavings.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Visual comparison bars */}
            <div className="mt-6 rounded-xl bg-white p-4 shadow-sm">
              <p className="mb-3 text-center text-xs text-gray-500">
                Monthly cost comparison
              </p>
              <div className="flex items-end gap-4" style={{ height: "80px" }}>
                <div className="flex flex-1 flex-col items-center">
                  <span className="mb-1 text-xs font-bold text-red-500">
                    ${monthlyManualCost.toLocaleString()}
                  </span>
                  <div
                    className="w-full rounded-t-md bg-red-200"
                    style={{ height: `${manualBarPct}%` }}
                  />
                </div>
                <div className="flex flex-1 flex-col items-center">
                  <span className="mb-1 text-xs font-bold text-green-600">$79</span>
                  <div
                    className="w-full rounded-t-md bg-green-400"
                    style={{ height: `${contraxBarPct}%` }}
                  />
                </div>
              </div>
              <div className="mt-2 flex justify-between text-xs text-gray-500">
                <span>Manual searching</span>
                <span>With Contrax</span>
              </div>
            </div>

            <a
              href="/signup"
              className="mt-6 block w-full rounded-xl bg-amber-500 px-6 py-3 text-center text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-all hover:bg-amber-400 active:scale-[0.98]"
            >
              Get Started
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Competitor Comparison ─────────────────────────────────────────────────────

function CompetitorComparison() {
  const criteria = [
    {
      label: "Bid discovery",
      tooltip: "Who finds opportunities for you?",
      contrax: { value: "Scans federal and city procurement sites daily", positive: true },
      manual: { value: "You search SAM.gov, state portals & city sites manually", positive: false },
      consultant: { value: "Consultant checks known sources during business hours", positive: false },
      tools: { value: "Requires you to set up searches & filters yourself", positive: false },
    },
    {
      label: "Time to proposal",
      tooltip: "How fast from finding to submitting?",
      contrax: { value: "Hours — drafts in minutes", positive: true },
      manual: { value: "Days to weeks — research + writing from scratch", positive: false },
      consultant: { value: "Days — depends on their availability & backlog", positive: false },
      tools: { value: "Days — you still write the content", positive: false },
    },
    {
      label: "Monthly cost",
      tooltip: "What it costs per month",
      contrax: { value: "$19–$199/month", positive: true },
      manual: { value: "Hundreds in lost staff hours", positive: false },
      consultant: { value: "$3,000–$10,000+/month retainer", positive: false },
      tools: { value: "$200–$1,000/month", positive: false },
    },
    {
      label: "Proposal quality",
      tooltip: "Drafted vs. manual vs. template",
      contrax: { value: "Tailored drafts for each RFP", positive: true },
      manual: { value: "Depends entirely on your writing skills", positive: false },
      consultant: { value: "Professional — but expensive", positive: false },
      tools: { value: "Template-based — generic, not tailored", positive: false },
    },
    {
      label: "Learning curve",
      tooltip: "How easy to get started",
      contrax: { value: "Minutes — simple onboarding wizard", positive: true },
      manual: { value: "Steep — must learn each procurement system", positive: false },
      consultant: { value: "None — they handle it, but onboarding takes weeks", positive: false },
      tools: { value: "Moderate to steep — complex configuration required", positive: false },
    },
    {
      label: "Coverage",
      tooltip: "Federal, state, local?",
      contrax: { value: "Federal + state + local, all in one place", positive: true },
      manual: { value: "Limited to the sites you have time to check", positive: false },
      consultant: { value: "Usually focused on federal or their specialty", positive: false },
      tools: { value: "Varies — many only cover federal (SAM.gov)", positive: false },
    },
  ];

  const columns = [
    {
      name: "Contrax",
      subtitle: "Contract Intelligence",
      key: "contrax" as const,
      highlight: true,
      icon: (
        <img src="/logo-square.png" alt="Contrax" className="h-6 w-6 object-contain" />
      ),
    },
    {
      name: "Manual Bidding",
      subtitle: "DIY Approach",
      key: "manual" as const,
      highlight: false,
      icon: (
        <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
        </svg>
      ),
    },
    {
      name: "Consultant",
      subtitle: "Hired Help",
      key: "consultant" as const,
      highlight: false,
      icon: (
        <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
        </svg>
      ),
    },
    {
      name: "Other Tools",
      subtitle: "Generic RFP Software",
      key: "tools" as const,
      highlight: false,
      icon: (
        <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
        </svg>
      ),
    },
  ];

  const Check = () => (
    <svg className="h-5 w-5 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );

  const Cross = () => (
    <svg className="h-5 w-5 flex-shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );

  const Neutral = () => (
    <svg className="h-5 w-5 flex-shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
    </svg>
  );

  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        {/* Section heading */}
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">
            Why Contrax?
          </h2>
          <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Why small businesses choose Contrax
          </h3>
          <p className="mt-4 text-lg text-gray-600">
            See how Contrax stacks up against the alternatives — and why it&rsquo;s the fastest way from bid discovery to signed contract.
          </p>
        </div>

        {/* Desktop table */}
        <div className="mt-14 hidden overflow-hidden rounded-2xl border border-gray-200 shadow-sm lg:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-6 py-5 text-sm font-semibold text-slate-700">
                    <span className="sr-only">Criteria</span>
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-5 py-5 text-center ${col.highlight ? "bg-blue-50/60" : ""}`}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${col.highlight ? "bg-slate-900" : "bg-gray-100"}`}>
                          {col.icon}
                        </div>
                        <span className={`text-sm font-bold ${col.highlight ? "text-blue-700" : "text-slate-700"}`}>
                          {col.name}
                        </span>
                        <span className="text-xs text-gray-400">{col.subtitle}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {criteria.map((row) => (
                  <tr key={row.label} className="transition-colors hover:bg-gray-50/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">{row.label}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-400">{row.tooltip}</p>
                    </td>
                    {columns.map((col) => {
                      const cell = row[col.key];
                      return (
                        <td
                          key={col.key}
                          className={`px-5 py-4 text-center ${col.highlight ? "bg-blue-50/30" : ""}`}
                        >
                          <div className="flex flex-col items-center gap-1.5">
                            <div className="flex items-center justify-center gap-2">
                              {cell.positive ? <Check /> : <Cross />}
                            </div>
                            <p className={`text-xs leading-relaxed ${col.highlight ? "font-medium text-slate-800" : "text-gray-500"}`}>
                              {cell.value}
                            </p>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile cards */}
        <div className="mt-14 space-y-8 lg:hidden">
          {columns.map((col) => (
            <div
              key={col.key}
              className={`overflow-hidden rounded-2xl border shadow-sm ${
                col.highlight
                  ? "border-blue-500 ring-2 ring-blue-500/20 bg-gradient-to-br from-blue-50 to-white"
                  : "border-gray-200 bg-white"
              }`}
            >
              <div className={`flex items-center gap-3 px-6 py-4 ${col.highlight ? "bg-blue-100/50" : "bg-gray-50"}`}>
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${col.highlight ? "bg-slate-900" : "bg-gray-100"}`}>
                  {col.icon}
                </div>
                <div>
                  <p className={`text-base font-bold ${col.highlight ? "text-blue-700" : "text-slate-700"}`}>
                    {col.name}
                  </p>
                  <p className="text-xs text-gray-400">{col.subtitle}</p>
                </div>
                {col.highlight && (
                  <span className="ml-auto rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white shadow-sm">
                    Best choice
                  </span>
                )}
              </div>
              <div className="divide-y divide-gray-100 px-6 py-2">
                {criteria.map((row) => {
                  const cell = row[col.key];
                  return (
                    <div key={row.label} className="flex items-start gap-3 py-3">
                      {cell.positive ? (
                        <Check />
                      ) : (
                        <Neutral />
                      )}
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{row.label}</p>
                        <p className={`text-xs leading-relaxed ${col.highlight ? "text-slate-600" : "text-gray-500"}`}>
                          {cell.value}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-12 text-center">
          <a
            href="/pricing"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-900 px-8 py-3 text-sm font-semibold text-slate-900 transition-all hover:bg-slate-900 hover:text-white active:scale-[0.98]"
          >
            See plans
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}

// ── Lead Capture ──────────────────────────────────────────────────────────────
function LeadCapture() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = email.trim();
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setErrorMsg("Please enter a valid email address.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setErrorMsg("");
    try {
      const response = await fetch("/api/lead-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      const result = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Something went wrong. Please try again.");
      }
      setStatus("success");
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      setStatus("error");
    }
  };

  if (status === "success") {
    return (
      <section className="bg-slate-900 py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-900/50">
              <svg className="h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="mt-6 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Thanks! We&apos;ll be in touch.
            </h2>
            <p className="mt-3 text-lg text-blue-100/70">
              Your interest is on file. You can read the free guide now.
            </p>
            <div className="mt-8">
              <a href="/guide" className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 active:scale-[0.98]">
                Read the guide →
              </a>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-slate-900 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Free Guide: Win Your First Government Contract</h2>
          <p className="mt-4 text-lg text-blue-100/70">Get the step-by-step checklist for small businesses — from SAM.gov registration to your first award.</p>
          <form onSubmit={handleSubmit} className="mt-8 sm:mx-auto sm:max-w-md">
            <div className="flex flex-col gap-3 sm:flex-row">
              <label htmlFor="lead-email" className="sr-only">Email address</label>
              <input id="lead-email" type="email" required placeholder="you@company.com" value={email} onChange={(event) => { setEmail(event.target.value); if (status === "error") setStatus("idle"); }} className="flex-1 rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-base text-white placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30" />
              <button type="submit" disabled={status === "loading"} className="inline-flex items-center justify-center rounded-xl bg-amber-500 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
                {status === "loading" ? "Saving..." : "Get the Guide"}
              </button>
            </div>
            {status === "error" && errorMsg && <p className="mt-3 text-sm text-red-300">{errorMsg}</p>}
            <p className="mt-3 text-xs text-slate-400">We&apos;ll save your email and may follow up about Contrax. No fake delivery promises.</p>
          </form>
        </div>
      </div>
    </section>
  );
}

// ── Pricing ───────────────────────────────────────────────────────────────────

function Pricing() {
  const plans = [
    {
      name: "Starter",
      price: "19",
      period: "/month",
      description: "For small businesses getting started with government contracting.",
      features: [
        "SAM.gov bid matching (daily sync)",
        "AI-powered bid summaries",
        "Win probability scoring",
        "Certification guides & checklists",
        "Contract database access",
      ],
      cta: "Get Started",
      slug: "starter",
      featured: false,
    },
    {
      name: "Professional",
      price: "79",
      period: "/month",
      description: "For growing businesses that want to scale their contracting pipeline.",
      features: [
        "Everything in Starter",
        "Unlimited bid tracking",
        "Drafting Intelligence — AI-verified citations to protect your win against audits",
        "Win probability scoring",
        "Compliance tracking",
        "AI chat support",
      ],
      cta: "Get Started",
      slug: "professional",
      featured: true,
    },
    {
      name: "Agency",
      price: "199",
      period: "/month",
      description: "For firms managing multiple clients or large contract portfolios.",
      features: [
        "Everything in Professional",
        "Team roles & permissions",
        "Integration connectors",
        "Win/loss bid tracking",
        "Red Team proposal auditing",
        "Team collaboration tools",
        "Market trend analysis",
      ],
      cta: "Get Started",
      slug: "agency",
      featured: false,
    },
  ];

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
          <p className="mt-3 text-sm font-medium text-slate-500">All plans include a 21-day free trial. No hidden fees. Cancel anytime.</p>
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

// Soro blog embed: the embed script is an IIFE that renders into #soro-blog.
// Loading it with defer in <head> races React hydration — if the IIFE runs before
// hydration, React wipes its output. So inject the script client-side only, after
// hydration: this component's useEffect never runs during SSR (empty deps), and on
// the client it appends the script to document.head after React has taken over the
// DOM, guaranteeing the widget is never wiped. On re-mount (navigation away/back)
// the effect re-runs and re-injects, so the widget self-heals.
const SORO_EMBED_SRC =
  "https://app.trysoro.com/api/embed/b2c9be2b-b791-4ef2-94d0-8ffbbfebe411";

function SoroEmbed() {
  useEffect(() => {
    const script = document.createElement("script");
    script.src = SORO_EMBED_SRC;
    document.head.appendChild(script);
  }, []);
  return <div id="soro-blog"></div>;
}
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

      {/* Soro blog embed */}
      <section className="bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-6">
          <SoroEmbed />
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
