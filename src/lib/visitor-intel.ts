import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { qaFunnelExclusionSQL, adminFunnelExclusionSQL } from "~/lib/qa-exclusion";

/**
 * Shared Visitor Intelligence logic (admin "Watch visitor" + intel panel).
 *
 * One canonical place for:
 *   - the `watched_visitors` table DDL guard (same self-heal pattern as
 *     tracking-intake.ts — CREATE TABLE IF NOT EXISTS so prod Neon gets it
 *     without a manual migration run; db/migrations/027 carries the same DDL
 *     for fresh environments),
 *   - rule-based interest inference from paths/events (honest, labeled
 *     "inferred" in the UI),
 *   - the 0–100 heuristic lead score with transparent per-reason breakdown.
 *
 * PII RULES (owner): no full emails (local-part@… only when known), no raw IPs
 * (never selected here), geo is always "approximate / IP-derived" in the UI.
 * No third-party enrichment — everything derives from first-party
 * funnel_events / page_views / radar_saves / visitors rows.
 */

/** DDL guard for the watched-visitors list. Idempotent — safe per request. */
export async function ensureWatchedVisitorsTable(): Promise<void> {
  await sql()`CREATE TABLE IF NOT EXISTS watched_visitors (
    visitor_id TEXT PRIMARY KEY,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_viewed_at TIMESTAMPTZ,
    note TEXT
  )`;
}

export interface WatchedInfo {
  watched: boolean;
  watched_since: string | null;
  /** True when the visitor was active AFTER the admin last viewed them. */
  returned_since_view: boolean;
}

/** Watched status for a set of visitor ids in one query. */
export async function getWatchedMap(visitorIds: string[]): Promise<
  Map<string, { added_at: string; last_viewed_at: string | null }>
> {
  const map = new Map<string, { added_at: string; last_viewed_at: string | null }>();
  const ids = [...new Set(visitorIds)].filter(Boolean);
  if (ids.length === 0) return map;
  try {
    await ensureWatchedVisitorsTable();
    const rows: any[] = await sql()`
      SELECT visitor_id, added_at, last_viewed_at FROM watched_visitors
      WHERE visitor_id = ANY(${ids})`;
    for (const r of rows) {
      map.set(String(r.visitor_id), {
        added_at: new Date(r.added_at).toISOString(),
        last_viewed_at: r.last_viewed_at ? new Date(r.last_viewed_at).toISOString() : null,
      });
    }
  } catch {
    // Fail-open: watching is an accelerator, never a gate.
  }
  return map;
}

// ── Interest inference (rule-based, honest) ──────────────────────────────────

export interface InferredInterest {
  key: string;
  label: string; // e.g. "Awards / incumbent intelligence"
  evidence: string; // short honest derivation, e.g. "5× /awards views + 1 incumbent view"
}

const PATH_INTERESTS: { match: (p: string) => boolean; key: string; label: string }[] = [
  { match: (p) => p === "/awards" || p.startsWith("/awards"), key: "awards", label: "Awards / incumbent intelligence" },
  { match: (p) => p === "/radar" || p.startsWith("/radar"), key: "radar", label: "Radar / bid matching" },
  { match: (p) => p.includes("/pricing"), key: "pricing", label: "Pricing" },
  { match: (p) => p.includes("/example-brief"), key: "briefs", label: "Executive Briefs" },
  { match: (p) => p === "/map" || p.startsWith("/map"), key: "map", label: "Opportunity map" },
  { match: (p) => p === "/score" || p.startsWith("/score"), key: "scoring", label: "AI Match Scoring" },
  { match: (p) => p === "/evaluate" || p.startsWith("/evaluate"), key: "evaluate", label: "Proposal evaluation" },
  { match: (p) => p.startsWith("/compare") || p.startsWith("/competitors"), key: "competitors", label: "Competitor intel" },
  { match: (p) => p.startsWith("/blog") || p.startsWith("/learn") || p.startsWith("/guide"), key: "learn", label: "Learning content" },
  { match: (p) => p.startsWith("/draft"), key: "draft", label: "Proposal drafting" },
];

const EVENT_INTERESTS: { match: (e: string) => boolean; key: string; label: string }[] = [
  { match: (e) => e.includes("incumbent") || e.includes("award"), key: "awards", label: "Awards / incumbent intelligence" },
  { match: (e) => e.includes("radar"), key: "radar", label: "Radar / bid matching" },
  { match: (e) => e.includes("pricing"), key: "pricing", label: "Pricing" },
  { match: (e) => e.includes("brief"), key: "briefs", label: "Executive Briefs" },
  { match: (e) => e.includes("score"), key: "scoring", label: "AI Match Scoring" },
  { match: (e) => e.includes("signup"), key: "signup", label: "Signup intent" },
  { match: (e) => e.includes("save_") || e.includes("alert_created"), key: "pipeline", label: "Pipeline / saved bids" },
  { match: (e) => e.includes("draft"), key: "draft", label: "Proposal drafting" },
  { match: (e) => e.includes("evaluat"), key: "evaluate", label: "Proposal evaluation" },
];

/** /bid/<numeric-id> extraction — the only contract-detail path shape. */
export function bidIdsFromPaths(paths: (string | null | undefined)[]): number[] {
  const ids: number[] = [];
  for (const p of paths) {
    if (!p) continue;
    const m = p.match(/^\/bid\/(\d+)/);
    if (m) ids.push(parseInt(m[1], 10));
  }
  return [...new Set(ids)].filter((n) => Number.isFinite(n));
}

export function inferInterests(
  paths: string[],
  events: string[],
  bidViewCount: number,
): InferredInterest[] {
  const hits = new Map<string, { label: string; n: number }>();
  const bump = (key: string, label: string) => {
    const h = hits.get(key) ?? { label, n: 0 };
    h.n += 1;
    hits.set(key, h);
  };
  for (const p of paths) {
    for (const rule of PATH_INTERESTS) {
      if (rule.match(p)) {
        bump(rule.key, rule.label);
        break;
      }
    }
  }
  for (const e of events) {
    for (const rule of EVENT_INTERESTS) {
      if (rule.match(e)) {
        bump(rule.key, rule.label);
        break;
      }
    }
  }
  const out: InferredInterest[] = [...hits.entries()].map(([key, h]) => ({
    key,
    label: h.label,
    evidence: `${h.n} related ${h.n === 1 ? "signal" : "signals"}`,
  }));
  if (bidViewCount > 0 && !hits.has("bids")) {
    out.push({
      key: "bids",
      label: "Solicitation details",
      evidence: `${bidViewCount} contract page ${bidViewCount === 1 ? "view" : "views"}`,
    });
  }
  out.sort((a, b) => b.evidence.localeCompare(a.evidence));
  return out;
}

// ── Lead score (heuristic, transparent) ──────────────────────────────────────

export interface ScoreReason {
  points: number;
  reason: string;
}

export interface LeadScore {
  score: number; // 0–100, capped
  level: "High" | "Medium" | "Low"; // High ≥70, Medium 40–69, Low <40
  reasons: ScoreReason[];
}

export interface ScoreSignals {
  returnedMultiDay: boolean;
  sessions: number;
  radarStarted: boolean;
  radarCompleted: boolean;
  incumbentViewed: boolean;
  briefViewed: boolean;
  briefGenerated: boolean;
  pricingViewed: boolean;
  signupStarted: boolean;
  signedUp: boolean;
  savedBid: boolean;
  distinctBidsViewed: number;
  steps: number;
}

export function computeLeadScore(s: ScoreSignals): LeadScore {
  const reasons: ScoreReason[] = [];
  const add = (points: number, reason: string) => {
    if (points > 0) reasons.push({ points, reason });
  };
  if (s.signedUp) add(15, "Signed up for an account");
  if (s.savedBid) add(15, "Saved a bid to pipeline");
  if (s.incumbentViewed) add(15, "Viewed incumbent intelligence");
  if (s.radarCompleted) add(20, "Completed a Radar scan");
  else if (s.radarStarted) add(5, "Started a Radar scan");
  if (s.returnedMultiDay) add(20, "Returned on a later day");
  else if (s.sessions >= 2) add(10, "Multiple sessions");
  if (s.briefGenerated) add(10, "Generated an AI Executive Brief");
  else if (s.briefViewed) add(10, "Viewed Executive Brief content");
  if (s.pricingViewed) add(10, "Viewed pricing");
  if (s.signupStarted && !s.signedUp) add(10, "Started signup (hasn't finished)");
  if (s.distinctBidsViewed > 0)
    add(Math.min(15, s.distinctBidsViewed * 5), `Viewed ${s.distinctBidsViewed} contract${s.distinctBidsViewed === 1 ? "" : "s"} in depth`);
  if (s.steps >= 6) add(5, "High engagement (6+ steps)");
  const total = reasons.reduce((a, r) => a + r.points, 0);
  const score = Math.min(100, total);
  return {
    score,
    level: score >= 70 ? "High" : score >= 40 ? "Medium" : "Low",
    reasons: reasons.sort((a, b) => b.points - a.points),
  };
}

// ── Radar profile labels (voluntarily-entered criteria only) ─────────────────

export const RADAR_CERT_LABELS: Record<string, string> = {
  sdvosb: "SDVOSB",
  "8a": "8(a)",
  wosb: "WOSB",
  hubzone: "HUBZone",
  sb: "Small Business",
};

export const RADAR_SIZE_LABELS: Record<string, string> = {
  under250k: "< $250K",
  under1m: "< $1M",
  under10m: "< $10M",
  any: "Any size",
};

export function radarCertLabel(raw: string | null): string | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase();
  return RADAR_CERT_LABELS[k] ?? raw;
}

export function radarSizeLabel(raw: string | null): string | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase();
  return RADAR_SIZE_LABELS[k] ?? raw;
}

// ── Visitor intel aggregation (per-visitor panel) ────────────────────────────

/**
 * Lazy index guard for the per-visitor detail lookups. funnel_events already has
 * idx_funnel_events_visitor_id (tracking-intake.ts); page_views historically has
 * NO visitor_id index — every per-visitor panel open would full-scan it. Created
 * here (fail-open) AND in db/migrations/027_watched_visitors.sql.
 */
export async function ensureVisitorIntelIndexes(): Promise<void> {
  try {
    await sql()`CREATE INDEX IF NOT EXISTS idx_page_views_visitor_id ON page_views (visitor_id)`;
  } catch {
    // Fail-open: the queries below still work, just slower, on a locked-down role.
  }
}

/** Mark a watched visitor as viewed NOW (resets the "returned since view" flag). */
export async function updateWatchedViewedAt(visitorId: string): Promise<void> {
  await ensureWatchedVisitorsTable();
  await sql()`
    INSERT INTO watched_visitors (visitor_id, added_at, last_viewed_at)
    VALUES (${visitorId}, NOW(), NOW())
    ON CONFLICT (visitor_id) DO UPDATE SET last_viewed_at = NOW()`;
}

/** Persist a watch/unwatch. Returns the resulting watched state. */
export async function setWatched(
  visitorId: string,
  watch: boolean,
): Promise<{ watched: boolean; added_at: string | null }> {
  await ensureWatchedVisitorsTable();
  if (watch) {
    const rows: any[] = await sql()`
      INSERT INTO watched_visitors (visitor_id, added_at)
      VALUES (${visitorId}, NOW())
      ON CONFLICT (visitor_id) DO NOTHING
      RETURNING visitor_id, added_at`;
    if (rows.length > 0) {
      return { watched: true, added_at: new Date(rows[0].added_at).toISOString() };
    }
    const existing: any[] = await sql()`
      SELECT added_at FROM watched_visitors WHERE visitor_id = ${visitorId}`;
    return {
      watched: true,
      added_at: existing[0]?.added_at ? new Date(existing[0].added_at).toISOString() : null,
    };
  }
  await sql()`DELETE FROM watched_visitors WHERE visitor_id = ${visitorId}`;
  return { watched: false, added_at: null };
}

export interface ContractView {
  bid_id: number;
  path: string;
  title: string | null;
  agency: string | null;
  set_aside: string | null;
  naics_code: string | null;
  location: string | null;
  views: number;
  last_viewed_at: string | null;
}

export interface VisitorIntel {
  visitor_id: string;
  known_identity: {
    status: "Anonymous" | "Known";
    email_masked: string | null; // local-part@… — never a full email
    user_id: string | null;
    first_linked_at: string | null;
    plan_tier: string | null;
    subscription_status: string | null;
  };
  acquisition: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    referrer_host: string | null;
    landing_path: string | null;
    first_seen: string | null;
    last_seen: string | null;
    sessions: number;
    visits_distinct: number;
  };
  location: {
    city: string | null;
    region: string | null;
    approximate: true; // UI must render the "approximate / IP-derived" label
  };
  device: { device_type: string | null; browser_label: string | null };
  engagement: {
    steps: number;
    sessions: number;
    returning: boolean; // active on a later day than first seen
    first_path: string | null;
    last_path: string | null;
    last_action: string | null;
    last_action_at: string | null;
    first_seen: string | null;
    last_seen: string | null;
  };
  interests: InferredInterest[]; // rule-based — UI must label as inferred
  contracts_viewed: ContractView[];
  radar_profile: {
    trade: string | null;
    state: string | null;
    cert: string | null;
    cert_label: string | null;
    size: string | null;
    size_label: string | null;
    email_captured: boolean; // via "Save your matches" (radar_saves)
  } | null;
  lead_score: LeadScore;
  conversion_signals: {
    returned: boolean;
    radar_used: boolean;
    brief_viewed: boolean;
    incumbent_viewed: boolean;
    saved_bids: boolean;
    pricing_viewed: boolean;
    started_signup: boolean;
    signed_up: boolean;
    activated: boolean;
  };
}

/** local-part@… — the only email shape that may leave the server. */
function maskEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  if (!e || !e.includes("@")) return null;
  const [local] = e.split("@");
  return `${local}@…`;
}

/** Host-only referrer (no path/query — never a raw URL with potential tokens). */
function referrerHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function iso(v: unknown): string | null {
  if (v == null || v === "") return null;
  try {
    return new Date(v as string).toISOString();
  } catch {
    return null;
  }
}

function sameUtcDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

/**
 * Full per-visitor intel for the admin panel. Every query is targeted by
 * visitor_id (indexes: funnel_events(visitor_id), page_views(visitor_id) via
 * ensureVisitorIntelIndexes, visitors PK, radar_saves needs a lookup — small
 * table, still bounded by a WHERE). Applies the SAME bot/QA/admin exclusions as
 * the journeys board so a row always agrees with its panel.
 *
 * PII: no ip / user_agent / referrer-url columns are selected anywhere; the
 * only email-shaped value is masked to local-part@….
 */
export async function getVisitorIntel(visitorId: string): Promise<VisitorIntel | null> {
  const vid = visitorId.trim();
  if (!vid || vid.length > 64) return null;

  const humanFilter = `AND NOT COALESCE((${BOT_EXCLUSION_SQL}), false)`;
  const qaFilter = `AND ${qaFunnelExclusionSQL("")}`;
  const adminFilter = `AND ${adminFunnelExclusionSQL("")}`;

  await ensureVisitorIntelIndexes();

  // ── Summary cache row (PK lookup) ──
  let v: any = null;
  try {
    const vRows: any[] = await sql()`
      SELECT visitor_id, first_seen_at, last_seen_at, first_path, last_path, city, region,
             device_type, browser_label, source, radar, signup, activated, steps, sessions,
             last_action, last_action_at, converted_user_id, saw_pricing, saw_brief
      FROM visitors WHERE visitor_id = ${vid}`;
    v = vRows[0] ?? null;
  } catch {
    v = null; // cache table missing — build purely from details below
  }

  // ── Detail rows (indexed by visitor_id, exclusion-filtered) ──
  let eventRows: any[] = [];
  let pageRows: any[] = [];
  const detailErr = null;
  try {
    eventRows = await sql()`
      SELECT created_at, event_name, label, path, source, medium, campaign, user_email, visit_id
      FROM funnel_events
      WHERE visitor_id = ${vid} AND visitor_id <> ''
        ${sql().unsafe(humanFilter)} ${sql().unsafe(qaFilter)} ${sql().unsafe(adminFilter)}
      ORDER BY created_at ASC`;
  } catch {
    eventRows = [];
  }
  try {
    pageRows = await sql()`
      SELECT created_at, path, source, medium, campaign, referrer, user_email, visit_id
      FROM page_views
      WHERE visitor_id = ${vid} AND visitor_id <> ''
        ${sql().unsafe(humanFilter)} ${sql().unsafe(qaFilter)} ${sql().unsafe(adminFilter)}
      ORDER BY created_at ASC`;
  } catch {
    pageRows = [];
  }
  void detailErr;

  if (!v && eventRows.length === 0 && pageRows.length === 0) return null; // unknown visitor — no fabrication

  // ── Radar "Save your matches" capture (voluntary criteria) ──
  let radarSave: any = null;
  try {
    const rsRows: any[] = await sql()`
      SELECT trade, state, cert, size_pref, created_at FROM radar_saves
      WHERE visitor_id = ${vid} ORDER BY created_at DESC LIMIT 1`;
    radarSave = rsRows[0] ?? null;
  } catch {
    radarSave = null;
  }

  // ── Known identity: live linked account, else detail-row email backfill ──
  const convertedId = v?.converted_user_id ? String(v.converted_user_id) : null;
  let userRow: any = null;
  if (convertedId) {
    try {
      const uRows: any[] = await sql()`
        SELECT id, email, created_at, plan_tier, subscription_status
        FROM users WHERE id = ${convertedId} LIMIT 1`;
      userRow = uRows[0] ?? null;
    } catch {
      userRow = null;
    }
  }
  const detailEmails = [...eventRows, ...pageRows]
    .map((r) => r.user_email)
    .filter((e): e is string => !!e && e.includes("@"));
  const detailEmail = detailEmails.length > 0 ? detailEmails[detailEmails.length - 1] : null;
  const knownEmail = userRow?.email ?? detailEmail ?? null;
  const emailMasked = maskEmail(knownEmail);

  // ── Paths / events / visits ──
  const paths: string[] = [];
  const eventNames: string[] = [];
  const visitIds = new Set<string>();
  let landingPath: string | null = null;
  let lastDetailPath: string | null = null;
  for (const r of pageRows) {
    if (r.path) {
      paths.push(String(r.path));
      if (landingPath === null && r.path !== "/") landingPath = String(r.path);
      lastDetailPath = String(r.path);
    }
    if (r.visit_id) visitIds.add(String(r.visit_id));
  }
  for (const r of eventRows) {
    eventNames.push(String(r.event_name));
    if (r.path) paths.push(String(r.path));
    if (r.visit_id) visitIds.add(String(r.visit_id));
  }
  const source =
    v?.source ??
    pageRows.find((r) => r.source)?.source ??
    eventRows.find((r) => r.source)?.source ??
    null;
  const medium = pageRows.find((r) => r.medium)?.medium ?? eventRows.find((r) => r.medium)?.medium ?? null;
  const campaign =
    pageRows.find((r) => r.campaign)?.campaign ?? eventRows.find((r) => r.campaign)?.campaign ?? null;
  const referrerHost_ = referrerHost(pageRows.find((r) => r.referrer)?.referrer);

  const firstSeen = iso(v?.first_seen_at) ?? iso(pageRows[0]?.created_at) ?? iso(eventRows[0]?.created_at);
  const lastSeen =
    iso(v?.last_seen_at) ??
    iso(pageRows[pageRows.length - 1]?.created_at) ??
    iso(eventRows[eventRows.length - 1]?.created_at);
  const returning = !!(firstSeen && lastSeen && !sameUtcDay(firstSeen, lastSeen));

  const steps = Math.max(Number(v?.steps) || 0, pageRows.length + eventRows.length);
  const sessions = Math.max(Number(v?.sessions) || 0, visitIds.size);

  // ── Contracts viewed (real /bid/<id> paths only) ──
  const bidCounts = new Map<number, { views: number; last: string | null }>();
  for (const r of pageRows) {
    const ids = bidIdsFromPaths([r.path]);
    if (ids.length === 0) continue;
    const id = ids[0];
    const t = iso(r.created_at);
    const cur = bidCounts.get(id) ?? { views: 0, last: null };
    cur.views += 1;
    if (!cur.last || (t && t > cur.last)) cur.last = t;
    bidCounts.set(id, cur);
  }
  const eventBidIds = bidIdsFromPaths(eventRows.map((r) => r.path));
  for (const id of eventBidIds) {
    if (!bidCounts.has(id)) bidCounts.set(id, { views: 0, last: null });
  }
  const bidIds = [...bidCounts.keys()];
  const bidsById = new Map<number, any>();
  if (bidIds.length > 0) {
    try {
      const bidRows: any[] = await sql()`
        SELECT id, title, agency, set_aside, naics_code, location
        FROM bids WHERE id = ANY(${bidIds})`;
      for (const b of bidRows) bidsById.set(Number(b.id), b);
    } catch {
      // fail-open: slug-only contract rows below
    }
  }
  const contracts_viewed: ContractView[] = bidIds
    .sort((a, b) => (bidCounts.get(b)?.views ?? 0) - (bidCounts.get(a)?.views ?? 0))
    .map((id) => {
      const b = bidsById.get(id);
      const c = bidCounts.get(id)!;
      return {
        bid_id: id,
        path: `/bid/${id}`,
        title: b?.title ?? null,
        agency: b?.agency ?? null,
        set_aside: b?.set_aside ?? null,
        naics_code: b?.naics_code ?? null,
        location: b?.location ?? null,
        views: c.views,
        last_viewed_at: c.last,
      };
    });

  // ── Interests (rule-based, labeled inferred in the UI) ──
  const interests = inferInterests(paths, eventNames, bidIds.length);

  // ── Signal extraction for score + conversion flags ──
  const has = (needle: string) => eventNames.some((e) => e.includes(needle));
  const sawPath = (needle: string) => paths.some((p) => p.includes(needle));
  const radarCompleted = eventNames.includes("radar_scan_complete");
  const radarUsed = !!v?.radar || eventNames.some((e) => e.startsWith("radar_")) || sawPath("/radar");
  const incumbentViewed = has("incumbent");
  const briefGenerated = eventNames.includes("rfp_brief_result");
  const briefViewed = briefGenerated || !!v?.saw_brief || sawPath("/example-brief");
  const pricingViewed = !!v?.saw_pricing || sawPath("/pricing");
  const signupStarted =
    eventNames.some((e) => ["signup_start", "signup_submit", "signup_abandon"].includes(e));
  const signupViewed = eventNames.some((e) => e.startsWith("signup_view"));
  const signedUp = (v?.signup === "Success" && (!!userRow || detailEmails.some((e) => eventRows.some((r) => r.event_name === "signup_success" && r.user_email === e)))) || false;
  const savedBid = eventNames.includes("save_success") || eventNames.includes("radar_login_notify_save");
  const activated = !!v?.activated;
  const signedUpFinal = signedUp || !!userRow;

  const lead_score = computeLeadScore({
    returnedMultiDay: returning,
    sessions,
    radarStarted: radarUsed,
    radarCompleted,
    incumbentViewed,
    briefViewed,
    briefGenerated,
    pricingViewed,
    signupStarted,
    signedUp: signedUpFinal,
    savedBid: savedBid,
    distinctBidsViewed: bidIds.length,
    steps,
  });

  const radar_profile = radarSave
    ? {
        trade: radarSave.trade ?? null,
        state: radarSave.state || null,
        cert: radarSave.cert ?? null,
        cert_label: radarCertLabel(radarSave.cert ?? null),
        size: radarSave.size_pref ?? null,
        size_label: radarSizeLabel(radarSave.size_pref ?? null),
        email_captured: true,
      }
    : null;

  return {
    visitor_id: vid,
    known_identity: {
      status: emailMasked ? "Known" : "Anonymous",
      email_masked: emailMasked,
      user_id: userRow ? String(userRow.id) : null,
      first_linked_at: iso(userRow?.created_at),
      plan_tier: userRow?.plan_tier ?? null,
      subscription_status: userRow?.subscription_status ?? null,
    },
    acquisition: {
      source: source ?? null,
      medium: medium ?? null,
      campaign: campaign ?? null,
      referrer_host: referrerHost_,
      landing_path: landingPath,
      first_seen: firstSeen,
      last_seen: lastSeen,
      sessions,
      visits_distinct: visitIds.size,
    },
    location: {
      city: v?.city ?? null,
      region: v?.region ?? null,
      approximate: true,
    },
    device: {
      device_type: v?.device_type ?? null,
      browser_label: v?.browser_label ?? null,
    },
    engagement: {
      steps,
      sessions,
      returning,
      first_path: v?.first_path ?? landingPath,
      last_path: v?.last_path ?? lastDetailPath,
      last_action: v?.last_action ?? null,
      last_action_at: iso(v?.last_action_at),
      first_seen: firstSeen,
      last_seen: lastSeen,
    },
    interests,
    contracts_viewed,
    radar_profile,
    lead_score,
    conversion_signals: {
      returned: returning,
      radar_used: radarUsed,
      brief_viewed: briefViewed,
      incumbent_viewed: incumbentViewed,
      saved_bids: savedBid,
      pricing_viewed: pricingViewed,
      started_signup: signupStarted || signupViewed,
      signed_up: signedUpFinal,
      activated,
    },
  };
}
