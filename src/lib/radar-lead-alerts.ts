import { sql } from "~/db";
import { US_STATES } from "~/lib/states";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { sendRadarMatchAlertEmail, type NewBidSummary } from "~/lib/email";
import { ensureRadarLeadsClickLog, buildOpportunityClickUrl, hashClickToken } from "~/lib/radar-lead-clicks";
import { expandTrade, tradeProvenanceFor } from "~/lib/trade-registry";

/**
 * Periodic match-alert sender for CONFIRMED Radar leads (owner 2026-09-06;
 * follow-up to PR #352's `radar_leads` capture + confirmation email).
 *
 * The owner's principle: "Once they voluntarily provide an email and consent to
 * updates, then you have a legitimate sales channel. You can send useful
 * follow-up such as new matching opportunities rather than cold-selling them."
 *
 * So this is a USEFUL, honest, OPT-IN channel — new matches against the lead's
 * OWN Radar profile (the exact criteria they searched), nothing cold, no
 * manufactured urgency, one-click unsubscribe in every email.
 *
 * ── Gates (enforced in SQL, never in app code) ─────────────────────────────
 *   confirmed_at IS NOT NULL  — the confirmation email proved a real address
 *   unsubscribed_at IS NULL   — one click, gone forever (never resurrected)
 *   consent = TRUE            — explicit opt-in at capture time
 *
 * ── Matching (OR semantics, mirrors bid-alerts / radar house patterns) ─────
 *   trade    → case-insensitive substring against title/agency/category/desc;
 *              6-digit NAICS → exact naics_code equality (radar's isNaics rule)
 *   cert     → bid `set_aside` OR the same text fields, using the cert →
 *              literal set-aside map from open-bids.ts (8(a)/8AN, SDVOSB, …)
 *   state    → bids.location state-code match (STATE_LOCATION_REGEX +
 *              locationMatchesStates semantics: nationwide bids always match)
 *   sizePref → only applied when the bid carries a stated value (never
 *              fabricated): under250k/under1m/under10m caps on the parsed
 *              estimated value (radar's SIZE_OPTS caps). Unknown value → no
 *              size signal → never a false negative, never a fabricated match.
 *   ANY matched field wins (OR), like bid-alerts.
 *
 * ── Dedupe ──────────────────────────────────────────────────────────────────
 *   A per-lead JSONB `sent_bid_ids` array on radar_leads (migration 032,
 *   self-healed here like every guard). A bid is only emailed once per lead:
 *   the WHERE … NOT sent and the sent-list append are atomic per lead, and a
 *   per-lead `radar_alerts_sent` log row makes a re-run crash-safe. The sent
 *   list is capped at 512 ids so an extremely active lead doesn't grow without
 *   bound (rotation: we drop the oldest half once past the cap).
 *
 * ── Delivery / tracking ─────────────────────────────────────────────────────
 *   ONE email per lead per run (matches capped at 10 per email; extras are
 *   listed as "…plus N more"). Fire-and-forget + fail-open per lead: a send
 *   failure is logged (PII-safe — never the raw address) and the sent-list is
 *   NOT advanced, so the SAME bids retry next run. A successful send records a
 *   `radar_alert_sent` funnel event (label in tracking-intake EVENT_LABELS) +
 *   a `radar_alerts_sent` row per (lead, bid) as the crash-safe sent-log.
 *
 * ── CTA click tracking (owner 2026-09-07) ───────────────────────────────────
 *   Each per-bid card's "View opportunity →" carries {why_line} (the concrete
 *   cert/category/size flags that actually fired — renderMatchWhyLine, NEVER
 *   invented; state-only matches fall back to the honest "your Radar profile")
 *   and {click_url} → https://www.contrax.company/api/radar/opportunity-click
 *   ?bid=<id>&token=<unsubscribe_token> (built by buildOpportunityClickUrl —
 *   ONE source of truth shared with the route). After a successful send we
 *   pre-insert the (lead, bid) pair into radar_lead_opportunity_clicks (mig
 *   033, self-healed): the redirect route's idempotent click-count then fires
 *   ONLY for pairs that were genuinely emailed, and a repeat click never
 *   double-counts (PK lead_id × bid_id). Raw email never in URLs or logs;
 *   only the sha256 token hash is stored.
 *
 * ── CLI ---------------------------------------------------------------
 *   bun run src/jobs/send-radar-lead-alerts.ts   (package.json "radar-alerts").
 *   Scheduling: sibling step in .github/workflows/sync-bids.yml right after
 *   "Run bid sync" — each 4h sync then emails only the matches that are NEW
 *   since the last run (the sync itself just produced them).
 */

// The cert → literal set-aside map mirrors open-bids.ts setAsidePredMulti, so
// the email matcher's cert semantics are IDENTICAL to every listing surface.
const CERT_TO_SET_ASIDE: Record<string, string[]> = {
  "8a": ["8(a)", "8AN"],
  sdvosb: ["SDVOSB"],
  wosb: ["WOSB", "EDWOSB"],
  hubzone: ["HUBZone"],
  vosb: ["VOSB"],
};
const CERT_KEYS = Object.keys(CERT_TO_SET_ASIDE);

/** Honest human label per lead cert key — used ONLY for a reason that fired. */
const CERT_LABELS: Record<string, string> = {
  "8a": "8(a)",
  sdvosb: "SDVOSB",
  wosb: "WOSB",
  hubzone: "HUBZone",
  vosb: "VOSB",
  sb: "Small-business",
};

/** Honest human cap label per sizePref — shown ONLY when a stated bid value
 *  actually fell within the cap (never fabricated, never for "any"). */
const SIZE_CAP_LABELS: Record<string, string> = {
  under250k: "Under $250K",
  under1m: "Under $1M",
  under10m: "Under $10M",
};

const SIZE_PREFS = new Set(["under250k", "under1m", "under10m", "any"]);
const SIZE_CAPS: Record<string, number> = {
  under250k: 250_000,
  under1m: 1_000_000,
  under10m: 10_000_000,
};

/** Bids per email (the rest ride as a truncation note). */
const MAX_MATCHES_PER_EMAIL = 10;
/** Cap on the per-lead sent_bid_ids JSONB array (oldest half rotated when past). */
const SENT_LIST_CAP = 512;

const STATE_LOCATION_REGEX = new RegExp(
  `(?:^|,\\s*)(${US_STATES.join("|")})(?:$|\\s|,)`,
  "i",
);

/**
 * Parse "$185,000", "185000", "1.2M", "800K" … → number or null. Mirrors the
 * radar route's parseValue (single source of truth stays in radar.tsx; this is
 * the same deterministic logic used by the sync-time matcher).
 */
export function parseRadarValue(v: string | null | undefined): number | null {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  if (!s) return null;
  let mult = 1;
  if (s.endsWith("M")) mult = 1_000_000;
  else if (s.endsWith("K")) mult = 1_000;
  const digits = s.replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const n = parseFloat(digits);
  if (Number.isNaN(n)) return null;
  return Math.round(n * mult);
}

export interface RadarLeadRow {
  id: number;
  email: string;
  visitor_id: string | null;
  radar_profile: {
    trade: string | null;
    state: string | null;
    cert: string | null;
    sizePref: string | null;
    /** Expansion snapshot (migration 034); sender recomputes fresh (single source of truth). */
    expanded?: { terms: string[]; naicsCodes: string[] } | null;
  } | null;
  unsubscribe_token: string;
  /** Per-lead already-alerted bid id array (migration 032) — the sender's dedupe. */
  sent_bid_ids?: unknown[] | null;
}

interface BidRow {
  id: number;
  title: string;
  agency: string | null;
  category: string | null;
  description: string | null;
  location: string | null;
  set_aside: string | null;
  naics_code: string | null;
  due_date: string | null;
  estimated_value: string | null;
  source_url: string | null;
}

export interface RadarAlertRunResult {
  leadsChecked: number;
  emailsSent: number;
  matchesEmailed: number;
  leadsWithMatches: number;
  errors: number;
}

/** Self-healing DDL guard — identical to db/migrations/032_radar_leads_alerts.sql. */
export async function ensureRadarLeadsAlertColumns(): Promise<void> {
  await sql()`ALTER TABLE radar_leads ADD COLUMN IF NOT EXISTS sent_bid_ids JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql()`ALTER TABLE radar_leads ADD COLUMN IF NOT EXISTS last_alerted_at TIMESTAMPTZ`;
  // NOTE: distinct table name `radar_leads_alerts_sent` — migration 019 already
  // owns `radar_alerts_sent` (radar_save_id × bid_id, legacy radar_saves alerts),
  // so reusing that name would silently no-op CREATE TABLE and the lead_id
  // INSERT/index would crash. The 019 table must never be touched by this path.
  const cols = (await sql()`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'radar_leads_alerts_sent' AND table_schema = 'public'
  `) as Array<{ column_name: string }>;
  if (cols.length === 0) {
    await sql()`CREATE TABLE IF NOT EXISTS radar_leads_alerts_sent (
      lead_id BIGINT NOT NULL REFERENCES radar_leads(id) ON DELETE CASCADE,
      bid_id INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      sent_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (lead_id, bid_id)
    )`;
    await sql()`CREATE INDEX IF NOT EXISTS radar_leads_alerts_sent_lead_idx ON radar_leads_alerts_sent (lead_id)`;
  }
}

/**
 * Per-bid WHY flags — the ACTUAL match reasons that fired for one bid against
 * one lead profile (owner 2026-09-06; "Why it matches: CERT · Category ·
 * Size"). Each flag recomputes the EXACT same predicate as
 * bidMatchesLeadProfile below (same text blob, same cert map, same size rule):
 * a reason appears ONLY when it genuinely fired. Omits reasons that did not
 * fire; the email falls back to the honest "your Radar profile" ONLY when no
 * concrete flag fired. NEVER invent a reason that did not fire.
 *
 *   cert     → e.g. "SDVOSB" (the lead's cert label, via the cert→set-aside map)
 *   category → the lead's trade text as searched (or the 6-digit NAICS code)
 *   size     → e.g. "Under $1M" (only when the bid STATED a value within cap)
 */
export interface MatchWhyFlags {
  cert: string | null;
  category: string | null;
  size: string | null;
}

export function whyBidMatchesLeadProfile(
  p: RadarLeadRow["radar_profile"],
  bid: BidRow,
): MatchWhyFlags {
  const why: MatchWhyFlags = { cert: null, category: null, size: null };
  if (!p) return why;
  const trade = (p.trade ?? "").trim();
  const cert = (p.cert ?? "").trim();
  const sizePref = (p.sizePref ?? "").trim();

  const text = `${bid.title || ""} ${bid.agency || ""} ${bid.category || ""} ${bid.description || ""}`.toLowerCase();

  // trade → substring against the EXPANDED term set (trade-registry); exact
  // NAICS equality for a 6-digit code (expansion never touches NAICS input).
  const isNaics = /^\d{6}$/.test(trade);
  const tradeFired = isNaics
    ? !!bid.naics_code && bid.naics_code.trim() === trade
    : trade.length > 0 && expandTrade(trade).terms.some((t) => t.length >= 2 && text.includes(t));
  if (tradeFired) {
    // HONEST provenance: the register synonym that actually hit (e.g. "freight
    // hauling") or the literal original term - never a fabricated reason.
    const prov = tradeProvenanceFor(text, expandTrade(trade), bid.naics_code);
    why.category = prov ? prov.matchedConcept : trade;
  }

  // cert → literal set-aside map against set_aside OR the bid text.
  if (cert && (CERT_KEYS.includes(cert) || cert === "sb")) {
    let fired = false;
    if (cert === "sb") {
      fired = !!bid.set_aside && String(bid.set_aside).trim().length > 0;
    } else {
      const pats = CERT_TO_SET_ASIDE[cert] ?? [];
      fired = pats.some((pat) => {
        const pLow = pat.toLowerCase();
        return (
          text.includes(pLow) ||
          (!!bid.set_aside && String(bid.set_aside).toLowerCase().includes(pLow))
        );
      });
    }
    if (fired) why.cert = CERT_LABELS[cert] ?? cert;
  }

  // sizePref → ONLY when the bid carries a stated value within the cap (never
  // fabricated; "any" has no cap so it never produces a size reason).
  if (sizePref && SIZE_PREFS.has(sizePref) && SIZE_CAPS[sizePref] != null) {
    const ev = parseRadarValue(bid.estimated_value);
    if (ev != null && ev <= (SIZE_CAPS[sizePref] ?? 0)) {
      why.size = SIZE_CAP_LABELS[sizePref] ?? null;
    }
  }

  return why;
}

/** Render the WHY flags as the owner-exact "CERT · Category · Size" line, or
 *  null when nothing concrete fired (caller falls back to the honest
 *  "your Radar profile"). */
export function renderMatchWhyLine(why: MatchWhyFlags): string | null {
  const parts: string[] = [];
  if (why.cert) parts.push(why.cert);
  if (why.category) parts.push(why.category);
  if (why.size) parts.push(why.size);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Whether a single bid matches a lead's radar profile. OR semantics — ANY
 * populated profile field that matches wins (like bid-alerts). Unknown/gated
 * signals never fabricate a match (sizePref only when the bid states a value;
 * a cert we don't map never matches).
 */
export function bidMatchesLeadProfile(p: RadarLeadRow["radar_profile"], bid: BidRow): boolean {
  if (!p) return false;
  const trade = (p.trade ?? "").trim();
  const state = (p.state ?? "").trim();
  const cert = (p.cert ?? "").trim();
  const sizePref = (p.sizePref ?? "").trim();

  const text = `${bid.title || ""} ${bid.agency || ""} ${bid.category || ""} ${bid.description || ""}`.toLowerCase();

  // trade → substring against the EXPANDED term set (trade-registry); exact
  // NAICS equality for a 6-digit code (expansion never touches NAICS input).
  const isNaics = /^\d{6}$/.test(trade);
  const tradeMatch = isNaics
    ? !!bid.naics_code && bid.naics_code.trim() === trade
    : trade.length > 0 && expandTrade(trade).terms.some((t) => t.length >= 2 && text.includes(t));

  // cert → literal set-aside map against set_aside OR the bid text.
  let certMatch = false;
  if (cert && (CERT_KEYS.includes(cert) || cert === "sb")) {
    if (cert === "sb") {
      certMatch = !!bid.set_aside && String(bid.set_aside).trim().length > 0;
    } else {
      const pats = CERT_TO_SET_ASIDE[cert] ?? [];
      certMatch = pats.some((pat) => {
        const pLow = pat.toLowerCase();
        return (
          text.includes(pLow) ||
          (!!bid.set_aside && String(bid.set_aside).toLowerCase().includes(pLow))
        );
      });
    }
  }

  // state → locationMatchesStates semantics: an extractable state must be the
  // lead's; nationwide/unknown-location bids always match (never dropped).
  let stateMatch = false;
  if (state) {
    const m = (bid.location || "").match(STATE_LOCATION_REGEX);
    stateMatch = !m || m[1].toUpperCase() === state;
  }

  // sizePref → ONLY when the bid carries a stated value (never fabricate);
  // unknown value → no size signal → neutral (never a false negative).
  let sizeMatch = false;
  if (sizePref && SIZE_PREFS.has(sizePref)) {
    const ev = parseRadarValue(bid.estimated_value);
    if (ev != null) sizeMatch = ev <= (SIZE_CAPS[sizePref] ?? 0);
  }

  return tradeMatch || certMatch || stateMatch || sizeMatch;
}

/**
 * One full run of the periodic sender: load confirmed, not-unsubscribed leads;
 * match them against OPEN bids they have NOT already been alerted about; email
 * each lead ONE digest of its NEW matches; record `radar_alert_sent` funnel
 * events + `radar_alerts_sent` sent-rows; advance the per-lead sent_bid_ids.
 *
 * Fail-open + fire-and-forget PER LEAD: a send/record failure on one lead is
 * logged (PII-safe) and skipped — it can never abort the run or block other
 * leads. Returns a summary for the job log.
 */
export async function sendRadarLeadMatchAlerts(): Promise<RadarAlertRunResult> {
  const result: RadarAlertRunResult = {
    leadsChecked: 0,
    emailsSent: 0,
    matchesEmailed: 0,
    leadsWithMatches: 0,
    errors: 0,
  };

  // Self-heal the dedupe columns/log (same guard pattern as every route).
  try {
    await ensureRadarLeadsAlertColumns();
  } catch (e) {
    console.error("[radar-lead-alerts] ensure columns failed:", (e as Error).message);
    return result;
  }

  // 1) Confirmed, not-unsubscribed, consenting leads ONLY — enforced in SQL.
  const leadRows = (await sql()`
    SELECT id, email, visitor_id, radar_profile, unsubscribe_token, sent_bid_ids
    FROM radar_leads
    WHERE confirmed_at IS NOT NULL
      AND unsubscribed_at IS NULL
      AND consent = TRUE
    ORDER BY id ASC
  `) as unknown as RadarLeadRow[];
  result.leadsChecked = leadRows.length;

  if (leadRows.length === 0) {
    console.log("[radar-lead-alerts] no confirmed leads to alert (0)");
    return result;
  }

  for (const lead of leadRows) {
    try {
      const sent = await sendForOneLead(lead);
      if (sent.emailsSent > 0) {
        result.emailsSent += sent.emailsSent;
        result.matchesEmailed += sent.matchesEmailed;
        result.leadsWithMatches += 1;
      }
    } catch (e) {
      // PII-safe — never include the lead's address in the log line.
      result.errors += 1;
      console.error(
        "[radar-lead-alerts] lead alert run failed (skipped, continuing):",
        (e as Error).message,
      );
    }
  }

  console.log(
    `[radar-lead-alerts] run complete — leads=${result.leadsChecked} emails=${result.emailsSent} matches=${result.matchesEmailed} leadsWithMatches=${result.leadsWithMatches} errors=${result.errors}`,
  );
  return result;
}

async function sendForOneLead(
  lead: RadarLeadRow,
): Promise<{ emailsSent: number; matchesEmailed: number }> {
  if (!lead.radar_profile) return { emailsSent: 0, matchesEmailed: 0 };

  // 2) Open bids the lead has NOT already been alerted about (dedupe via the
  //    per-lead sent_bid_ids JSONB array + the crash-safe sent-log).
  // Dedupe via the lead's OWN sent_bid_ids array, bound as a literal JSONB —
  // NEVER an unqualified column reference: sent_bid_ids lives on radar_leads,
  // not on bids; an unqualified ref here was the cause of the prod "column
  // sent_bid_ids does not exist" send-failure. `?` checks the JSONB array for
  // the string element per row; `'[]'::jsonb ? id` is always false, so a fresh
  // lead passes every bid. The sent-log below is the crash-safe backstop.
  // NO pre-filter LIMIT on this query: with thousands of open bids, a naive
  // `LIMIT 500 ORDER BY due_date ASC` silently drops any match past the window
  // (QA-proven: a trucking lead's real open match at due Sep 08 wasn't in the
  // first 500 by due date → radar_alert_sent never fired). The profile match
  // below is selective and caps at MAX_MATCHES_PER_EMAIL per lead, so scanning
  // ALL open bids per lead is correct and bounded in practice.
  const sentArr: string[] = Array.isArray(lead.sent_bid_ids)
    ? (lead.sent_bid_ids as unknown[]).map((v) => String(v))
    : [];
  const bids = (await sql()`
    SELECT id, title, agency, category, description, location, set_aside,
           naics_code, due_date, estimated_value, source_url
    FROM bids
    WHERE due_date > NOW()
      AND ${sql().unsafe(LOW_CONTENT_SQL)}
      AND NOT (${JSON.stringify(sentArr)}::jsonb ? CAST(id AS text))
    ORDER BY due_date ASC NULLS LAST
  `) as unknown as BidRow[];

  const matched: BidRow[] = [];
  for (const bid of bids) {
    if (bidMatchesLeadProfile(lead.radar_profile, bid)) matched.push(bid);
  }
  if (matched.length === 0) return { emailsSent: 0, matchesEmailed: 0 };

  const emailBids = matched.slice(0, MAX_MATCHES_PER_EMAIL);
  const truncatedCount = matched.length - emailBids.length;

  // 4) One email per lead, honest subject, one-click unsubscribe. Returns TRUE
  //    only when Resend accepted — the sent-log advances ONLY on TRUE so a
  //    failed email retries next run (fire-and-forget, never throws).
  //    Each bid card's "View opportunity →" CTA points at the PII-safe click
  //    redirect (owner 2026-09-07): {why_line} shows ONLY the concrete flags
  //    that actually fired for this bid (renderMatchWhyLine → null falls back
  //    to the honest "your Radar profile" inside the email), and {click_url}
  //    routes through /api/radar/opportunity-click so we can measure CTA clicks
  //    without ever putting the raw email in a URL or log (token-only).
  const sentOk = await sendRadarMatchAlertEmail(
    lead.email,
    lead.unsubscribe_token,
    emailBids.map((b): NewBidSummary => {
      const why = renderMatchWhyLine(whyBidMatchesLeadProfile(lead.radar_profile, b));
      return {
        title: b.title,
        agency: b.agency ?? "",
        source_url: b.source_url ?? "",
        location: b.location ?? "",
        due_date: b.due_date ? String(b.due_date) : null,
        set_aside: b.set_aside ?? null,
        bid_id: Number(b.id),
        // Always present for radar leads — click-tracking redirect (token-only,
        // never the raw email). Falls back to source_url inside email.ts when
        // a bid has no id (defensive; every matches-path bid does have one).
        why_line: why,
        click_url: Number.isFinite(Number(b.id)) ? buildOpportunityClickUrl(Number(b.id), lead.unsubscribe_token) : null,
      };
    }),
    truncatedCount,
  );
  if (!sentOk) return { emailsSent: 0, matchesEmailed: 0 };

  // 5) Advance the per-lead sent list. The sync workflow is SERIAL (one job at
  //    a time — concurrency group), so a read-merge-write per lead is race-free;
  //    the radar_alerts_sent sent-log below is the crash-safe backstop. Cap at
  //    SENT_LIST_CAP, rotating out the oldest half when past so an extremely
  //    active lead's list stays bounded.
  const emailBidIds = emailBids.map((b) => Number(b.id));
  const cur = (await sql()`
    SELECT sent_bid_ids FROM radar_leads WHERE id = ${lead.id}
  `) as unknown as Array<{ sent_bid_ids: unknown }>;
  const curArr: string[] = Array.isArray(cur[0]?.sent_bid_ids)
    ? (cur[0].sent_bid_ids as unknown[]).map((v) => String(v))
    : [];
  const merged = [...curArr];
  for (const id of emailBidIds.map(String)) {
    if (!merged.includes(id)) merged.push(id);
  }
  const capped =
    merged.length > SENT_LIST_CAP ? merged.slice(merged.length - SENT_LIST_CAP) : merged;
  await sql()`
    UPDATE radar_leads
    SET sent_bid_ids = CAST(${JSON.stringify(capped)} AS JSONB),
        last_alerted_at = NOW(),
        updated_at = NOW()
    WHERE id = ${lead.id}
  `;

  // 6) Crash-safe sent-log — one row per (lead, bid) — so a re-run after a
  //    mid-write crash still won't re-email a bid already in the log.
  for (const bidId of emailBidIds) {
    try {
      await sql()`
        INSERT INTO radar_leads_alerts_sent (lead_id, bid_id)
        VALUES (${lead.id}, ${bidId})
        ON CONFLICT (lead_id, bid_id) DO NOTHING
      `;
    } catch (e) {
      console.error("[radar-lead-alerts] sent-log insert failed:", (e as Error).message);
    }
  }
  // 6b) The email's per-bid click CTAs are live now (the send succeeded), so
  //  tell the click log the (lead, bid) pairs were actually emailed — the
  //  opportunity-click route counts a click ONLY against an existing pair
  //  (PK lead_id × bid_id), which keeps the funnel click strictly inside the
  //  mailed set. Same table the route self-heals (migration 033) and a distinct
  //  name from migration 019's radar_alerts_sent. Idempotent; fail-open.
  try {
    await ensureRadarLeadsClickLog();
  } catch (e) {
    console.error("[radar-lead-alerts] ensureRadarLeadsClickLog failed:", (e as Error).message);
  }
  for (const bidId of emailBidIds) {
    try {
      await sql()`
        INSERT INTO radar_lead_opportunity_clicks (lead_id, bid_id, clicked_at, token_hash)
        VALUES (${lead.id}, ${bidId}, NOW(), ${hashClickToken(lead.unsubscribe_token)})
        ON CONFLICT (lead_id, bid_id) DO NOTHING
      `;
    } catch (e) {
      console.error("[radar-lead-alerts] click-log preinsert failed:", (e as Error).message);
    }
  }

  // 7) Light funnel tracking — consistent with radar_lead_captured. Server-side
  //    (no visitor_id at job time), so it carries the lead's visitor_id if we
  //    have one; the Admin Journeys board reads it the same way. Fire-and-log.
  for (const bidId of emailBidIds) {
    try {
      await sql()`
        INSERT INTO funnel_events (event_name, label, path, user_agent, visitor_id)
        VALUES ('radar_alert_sent', ${String(bidId)}, 'radar-alerts-job', 'radar-alerts-job', ${lead.visitor_id})
        ON CONFLICT DO NOTHING
      `;
    } catch (e) {
      console.error("[radar-lead-alerts] funnel event failed:", (e as Error).message);
    }
  }

  return { emailsSent: 1, matchesEmailed: emailBidIds.length };
}