import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createServerFn } from "@tanstack/react-start";
import { setAsidePred } from "~/lib/open-bids";
import { certMatches, sbCertFragment, setAsideCardLabel } from "~/lib/cert-matching";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { US_STATES } from "~/lib/states";
import { NAICS_NAMES } from "~/lib/naics-names";
import { trackEvent } from "~/lib/track";
import { trackingIds } from "~/lib/visitor";
import { getTrackingUser } from "~/lib/identity";
import { SHOW_FREE_INCUMBENT, FREE_ANONYMOUS_RADAR_RESULTS } from "~/lib/radar-config";
import type { FPDSIntel } from "~/lib/fpds";
import {
  loadRadarIntel,
  type MatchIntelResult,
  type MatchIntelState,
  type MatchIntelStatus,
} from "~/lib/radar-intel";
import {
  getRadarAnswers,
  getRadarSeen,
  saveRadarSeen,
  saveRadarAnswers,
  type RadarCertId,
} from "~/lib/radar-session";
import { matchPriorLoss, type PriorLossBadge, type PriorLossRow } from "~/lib/award-autopsy";
import { expandTrade, tradeKeywordPred, tradeProvenanceFor, isStrongTradeMatch, RELATED_TRADE_TERMS, isCourierFamilyNaics, tradeExpresslyCourier, type TradeExpansion, type TradeMatchProvenance } from "~/lib/trade-registry";
import { TRADE_SUGGESTIONS } from "~/lib/trade-suggestions";
import {
  normalizeStateInput,
  resolveBidState,
  locationConflict,
  geoRelevant as geoRelevantByState,
  matchGeographyBucket,
  STATE_NAME_TO_CODE,
  displayPlaceOfPerformance,
} from "~/lib/location-state";
import {
  runKeywordScanQuery,
  runRelatedScanQuery,
  logScanFailure,
  collapseScanRows,
  loadNoticeDedupeKeys,
} from "~/lib/radar-scan-query";
import {
  raceRadarScan,
  RADAR_SCAN_TIMEOUT_MS,
  RADAR_SCAN_TIMEOUT_ERROR,
  type RadarScanRace,
} from "~/lib/radar-scan-runner";

/**
 * /radar — "Contract Radar" interactive lead-generation experience.
 *
 * A visitor answers four onboarding questions (trade/NAICS, state, set-aside
 * certification, preferred contract size), "Contract Radar scans the market",
 * and then results are revealed ONE AT A TIME with a REAL match percentage.
 *
 * HONESTY (owner-directed): every number traces to the LIVE `bids` table and to
 * real app logic. Match percentages are computed by a deterministic scorer
 * (docstring below) over real bid fields + the visitor's inputs — nothing is
 * fabricated. Estimated values come from the bid's `estimated_value` column.
 * Incumbent data (previous winner + award price) comes from FPDS/USAspending via
 * `~/lib/fpds.getFPDSIntel`, and is gated behind the single SHOW_FREE_INCUMBENT
 * flag (default: teaser — see ~/lib/radar-config.ts). Deadline countdowns use the
 * real `due_date` — no manufactured urgency beyond the actual deadline.
 *
 * GATE: anonymous visitors complete the FULL scan and land on a RESULTS screen
 * where the first FREE_ANONYMOUS_RADAR_RESULTS (3) REAL matches are revealed
 * immediately. Only when REAL matches exceed that cap does an honest
 * locked-results card appear ("X more matching opportunities" — always the real
 * count, never a manufactured wall; a visitor with ≤3 matches sees them ALL with
 * no locked card and no "X more" line). Authenticated users of ANY tier keep
 * normal entitlement — they are never gated. The unlock CTA routes to the
 * EXISTING /signup for now (PR1; PR2 adds the server/session restore).
 * Consistent with the existing Professional paywalls: Basic is free forever
 * (up to 3 saved bids); AI scoring + draft tools are on Professional.
 */

export const RADAR_CERTS = ["sdvosb", "8a", "wosb", "hubzone", "sb"] as const;
export type RadarCert = (typeof RADAR_CERTS)[number];

const CERT_LABEL: Record<string, string> = {
  sdvosb: "SDVOSB",
  "8a": "8(a)",
  wosb: "WOSB",
  hubzone: "HUBZone",
  sb: "Small Business",
};

export const SIZE_OPTS = [
  { id: "under250k", label: "< $250K", hint: "under $250,000" },
  { id: "under1m", label: "< $1M", hint: "under $1 million" },
  { id: "under10m", label: "< $10M", hint: "under $10 million" },
  { id: "any", label: "Any size", hint: "no preference" },
] as const;

export type SizeId = (typeof SIZE_OPTS)[number]["id"];

/**
 * R2: Contract Radar → signup CTA builder — carries the visitor's radar
 * criteria into /signup AND latches `/dashboard?brief=1` as the post-signup
 * return path so the new user lands on the dashboard with the "Run my first
 * Executive Brief" trial-start card surfaced (see src/lib/brief-mode.ts).
 *
 * The criteria ride as URL search params in the SAME `?source=radar&trade=&
 * cert=&state=&size=` shape /signup already parses (it runs a REAL server scan
 * for matches when no local radar session exists — never fabricated). The
 * `next` path is a same-site relative URL, so the existing safeNext() guard on
 * /signup's redirect accepts it (no open redirect).
 *
 * PR1 of the Radar Conversion Sprint (owner 2026-09-07) reuses this SAME href
 * for the anonymous locked-results card's "Unlock My N Matches →" CTA — a clean
 * hook point; PR2 adds server/session restore of the anonymous scan.
 */
export function radarSignupHref(answers: { trade: string; state: string; cert: RadarCertId | null; sizePref: SizeId | null }, opts?: { unlock?: boolean; cta?: boolean }): string {
  // PR2 (owner 2026-09-07): the anonymous locked-results card passes
  // source=radar_results_unlock so /signup can attribute the unlock handoff
  // (signed cookie restore + signup_viewed_from_radar). Owner 09-09: the
  // ≤3-match results CTA passes source=radar_results_cta, which /signup
  // handles IDENTICALLY to radar_results_unlock (same restore + attribution).
  // Every other caller keeps source=radar — no behavior change there.
  const source = opts?.unlock ? "radar_results_unlock" : opts?.cta ? "radar_results_cta" : "radar";
  const p = new URLSearchParams({ plan: "basic", source, next: "/dashboard?brief=1" });
  const trade = (answers.trade || "").trim();
  if (trade) p.set("trade", trade.slice(0, 120));
  const st = normalizeStateInput(answers.state);
  if (st) p.set("state", st);
  if (answers.cert) p.set("cert", answers.cert);
  if (answers.sizePref) p.set("size", answers.sizePref);
  return `/signup?${p.toString()}`;
}

/**
 * Deterministic match scorer — the single source of truth for the radar match %.
 * Computed over REAL bid fields + the visitor's inputs. Signals (total ≤ 100):
 *   NAICS/trade alignment  0–30   exact 6-digit NAICS === bid.naics_code → 30;
 *                                trade keyword in title/category → 22; else 8.
 *   Set-aside eligibility  0–20   the returned rows already satisfy the cert
 *                                filter, so a cert with a set-aside predicate is
 *                                credited 20; small-business/no-tag rows credit
 *                                20 only when the bid actually carries a
 *                                set_aside value.
 *   Geography              0–20   exact state match → 20; nationwide/unselected
 *                                → 12.
 *   Size fit               0–15   parsed estimated value fits preference → 15;
 *                                value unknown (not disclosed) → 15 (neutral);
 *                                clearly over the cap → 5.
 *   Closing-soon           0–15   due ≤30d → 15; ≤90d → 11; else 7.
 * Absent/incomplete signals are credited conservatively (a low unknown always
 * lowers the total); nothing is invented. Clamped to [0,100].
 *
 * TRADE EXPANSION (owner 2026-09-07): `isNaics` is derived ONLY from the
 * ORIGINAL trade input. The exact-NAICS 30pt branch stays on the ORIGINAL
 * input (never compares an expanded code). The 22pt keyword branch matches the
 * EXPANDED term set (trade-registry), so "trucking" scores 22 on a "freight
 * hauling" solicitation — honest because the expansion is curated procurement
 * language, and per-match provenance (match.trade_provenance) records WHICH
 * concept actually hit for the why-line (never claims the literal word
 * appeared).
 */
function computeMatch(
  bid: RadarBidRow,
  input: {
    trade: string;
    isNaics: boolean;
    expansion: TradeExpansion;
    state: string;
    cert: RadarCert;
    sizePref: SizeId;
  },
): { score: number; scoreLabel: "Strong Match" | "Good Match" | "Potential Match" } {
  const title = (bid.title || "").toLowerCase();
  const category = (bid.category || "").toLowerCase();

  // NAICS / trade alignment
  let naics = 8;
  if (input.isNaics && bid.naics_code && bid.naics_code.trim() === input.trade) naics = 30;
  else if (!input.isNaics && input.expansion.terms.some((t) => t.length >= 2 && (title.includes(t) || category.includes(t)))) naics = 22;

  // Set-aside eligibility
  const hasSetAside = !!bid.set_aside && String(bid.set_aside).trim().length > 0;
  let elig = 0;
  if (input.cert === "sb") elig = hasSetAside ? 20 : 0;
  else if (input.cert in { "8a": 1, sdvosb: 1, wosb: 1, hubzone: 1 }) elig = 20;

  // Geography (owner 09-13 breadth): resolve the bid's state from the
  // performance location, then the buyer/agency field when the location has no
  // state mention, then treat as nationwide/unknown. Contradictory-location
  // rows (a different state's place signal in the title/description) are
  // excluded earlier at scan time; the scorer never geocredits a conflict.
  let geo = 12;
  if (input.state) {
    // A NATIONAL-SCOPE location never earns the state-local geography credit
    // (owner 09-14): "United States"-located rows are eligible nationwide, not
    // local to the buyer's state. Routed through matchGeographyBucket — the ONE
    // geography decision — so the score can never disagree with the bucket the
    // card lands in; that also carries the narrow owner-ratified
    // agency-jurisdiction rule (Ohio Phase 3: the OH-ARNG rows bucket LOCAL for
    // Ohio even though their location is the "United States" placeholder).
    geo = matchGeographyBucket(input.state, bid.location, bid.agency) === "local" ? 20 : 12;
  }

  // Size fit
  let size = 15;
  const ev = parseValue(bid.estimated_value);
  if (ev != null && input.sizePref !== "any") {
    const cap = input.sizePref === "under250k" ? 250000 : input.sizePref === "under1m" ? 1_000_000 : 10_000_000;
    size = ev <= cap ? 15 : 5;
  }

  // Closing-soon
  let fresh = 7;
  const days = daysRemaining(bid.due_date);
  if (days != null) fresh = days <= 30 ? 15 : days <= 90 ? 11 : 7;

  const score = Math.max(0, Math.min(100, naics + elig + geo + size + fresh));
  const scoreLabel = score >= 80 ? "Strong Match" : score >= 65 ? "Good Match" : "Potential Match";
  return { score, scoreLabel };
}


/** Parse "$185,000", "185000", "1.2M", "800K" … → number or null. */
function parseValue(v: string | null | undefined): number | null {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  if (!s) return null;
  let mult = 1;
  if (s.endsWith("M")) { mult = 1_000_000; }
  else if (s.endsWith("K")) { mult = 1_000; }
  const digits = s.replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const n = parseFloat(digits);
  if (Number.isNaN(n)) return null;
  return Math.round(n * mult);
}

function daysRemaining(due: string | null): number | null {
  if (!due) return null;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86_400_000));
}

const money = (n: number): string =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`;

// ── Server: run the actual scan over the live `bids` table ──────────────────
type RadarBidRow = {
  id: number; title: string; agency: string | null; description: string | null;
  location: string | null; category: string | null; due_date: string | null;
  estimated_value: string | null; naics_code: string | null;
  source_url: string | null; set_aside: string | null;
};

export type RadarMatch = {
  id: number; title: string; agency: string | null; category: string | null;
  location: string | null; set_aside: string | null;
  /** PR-C.0: honest card label — real set-aside text, or the exact
   *  "Set-aside not specified — verify solicitation" string for NULL. */
  set_aside_label: string | null;
  naics_code: string | null;
  source_url: string | null;
  estimated_value: string | null;
  estimated_value_num: number | null;
  due_date: string | null; days_remaining: number | null;
  score: number; score_label: "Strong Match" | "Good Match" | "Potential Match";
  reasons: string[]; qualifications: string[]; requirements: string[];
  next_action: string;
  /** Per-match provenance (owner 2026-09-07): WHICH expanded concept + NAICS
   *  actually caused the trade match — never claims the literal word matched
   *  when a curated synonym did. Null on NAICS-input matches (the code itself
   *  is the provenance) and when no trade signal fired. */
  trade_provenance: TradeMatchProvenance | null;
  incumbent: FPDSIntel | null;
  /** Contrax Learning ⚡ memory (PAID-ONLY, Professional+ — never Basic/Starter). */
  learned: PriorLossBadge | null;
};

export const runRadarScan = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const v = (d as any) ?? {};
    const cert = String(v.cert ?? "sb");
    const sizePref = String(v.sizePref ?? "any");
    return {
      trade: String(v.trade ?? "").trim(),
      state: normalizeStateInput(String(v.state ?? "").trim()),
      cert: (RADAR_CERTS as readonly string[]).includes(cert) ? cert : "sb",
      sizePref: (SIZE_OPTS as readonly { id: string }[]).some((s) => s.id === sizePref) ? sizePref : "any",
    };
  })
  .handler(async ({ data }) => {
    const { trade, state, cert, sizePref } = data;
    const certId = cert as RadarCert;
    // PR2 (owner 2026-09-07): read the request's visitor cookie so an anonymous
    // gated scan can mint a SIGNED first-party handoff cookie after the scan.
    // getRequest() runs inside this createServerFn handler — the build-safe
    // server scope per the tanstack-start-server-imports skill.
    let scanVisitorId = "";
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const cookie = getRequest().headers.get("cookie") ?? "";
      const hit = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("contrax_vid="));
      if (hit) scanVisitorId = decodeURIComponent(hit.slice("contrax_vid=".length)).trim().slice(0, 64);
    } catch {
      scanVisitorId = ""; // fail-open: no visitor id, no handoff cookie
    }
    const isNaics = /^\d{6}$/.test(trade);
    // Trade-query normalization (owner 2026-09-06/07): expand AFTER the isNaics
    // gate — isNaics is derived ONLY from the ORIGINAL trade; expansion drives
    // ONLY the non-NAICS keyword branch. The original is preserved verbatim
    // everywhere it displays/stores.
    const expansion = expandTrade(trade);
    // Contrax Learning ⚡ memory (PAID-ONLY, Professional+): the logged-in user's
    // own autopsied losses, loaded ONCE per scan. Anonymous visitors and Basic
    // users get NO memory — Basic never sees it (the accumulating reason not
    // to cancel). Failure → null → no banner, radar unaffected.
    let priorLossIndex: PriorLossRow[] | null = null;
    try {
      const { getCurrentUser } = await import("~/lib/auth");
      const { effectiveAutopsyTier, LEARNING_TIERS, getPriorLossIndex } = await import("~/lib/award-autopsy");
      const user = await getCurrentUser();
      if (user) {
        const tier = await effectiveAutopsyTier(user.id, user);
        if (LEARNING_TIERS.has(tier)) priorLossIndex = await getPriorLossIndex(user.email);
      }
    } catch (e) {
      console.error("[radar] learning memory load failed (no banner):", e);
      priorLossIndex = null;
    }
    // Coerce the validated-but-stringly-typed size preference back to the SizeId
    // union. The validator already guaranteed it is one of the known ids.
    const sizeId = sizePref as SizeId;
    const { sql } = await import("~/db");
    let rows: any[] = [];
    let relatedRows: any[] = [];
    try {
      // Set-aside predicate fragment (PR-C.0, owner 09-13: Small Business
      // DESCRIBES the user's business — the sb branch admits explicit SBA/
      // small-business markers, unrestricted rows, and state/local rows whose
      // portal publishes no set-aside metadata. The text-level include/exclude
      // decision runs in JS below via the same certMatches predicate. Non-sb
      // certs keep their literal set_aside patterns UNCHANGED (mirrors
      // /trades).
      const certFrag =
        certId === "sb" ? sbCertFragment(sql) : setAsidePred(certId, sql);
      // Trade/NAICS predicate: exact NAICS equality when a 6-digit code is given,
      // otherwise the EXPANDED keyword set (trade-registry: curated synonyms +
      // implied NAICS codes). isNaics is derived from the ORIGINAL input; the
      // expanded fragment is used on the non-NAICS branch only. Every term is a
      // bound `${...}` parameter (injection-safe by construction).
      const tradeFrag = isNaics
        ? sql()`AND LOWER(COALESCE(naics_code,'')) = ${trade.toLowerCase()}`
        : trade
          ? tradeKeywordPred(sql, expansion)
          : sql()``;
      // Keyword-scan execution moved to a shared lib that THROWS RadarScanError
      // on failure instead of letting it become a misleading 0 (owner v6) —
      // the forced-failure regression test drives this same function.
      rows = await runKeywordScanQuery(sql, { certFrag, tradeFrag }, LOW_CONTENT_SQL);
      // R5 DEDUPE, WIRED (QA F2): collapse the SAME notice re-ingested under
      // several source labels BEFORE scoring/ranking, so duplicate rows can no
      // longer fill the ≤5 default-match cap. Key = solicitation number (R2 /
      // migration 047) PLUS notice_type (FIX ①, owner-locked nationwide
      // correctness fix 2026-09-23: an Award Notice and a Justification share a
      // solicitation number and must stay two matches, matching the stored
      // 5-dim natural key of migration 048) else (title, agency, notice_type);
      // the key read is FAIL-SOFT, so a not-yet-applied 047 degrades to the
      // natural key instead of failing the scan. Never deletes anything — see
      // ~/lib/notice-dedupe.
      const collapsedScan = await collapseScanRows(rows, (ids) =>
        loadNoticeDedupeKeys(sql, ids),
      );
      if (collapsedScan.collapsed > 0) {
        console.log(
          `[radar] dedupe: ${rows.length} rows → ${collapsedScan.rows.length} distinct notices (${collapsedScan.collapsed} collapsed; keyed by ${collapsedScan.noticeKeyColumns ? "solicitation_number + notice_type else (title,agency,notice_type)" : "(title,agency,notice_type) — notice-key columns unavailable"})`,
        );
      }
      rows = collapsedScan.rows;
      // RELATED opportunities (owner v6.1): adjacent-work terms, pulled only
      // when a state is requested. Same open/low-content guards, but NO cert
      // and NO strict trade filter — deliberately: the DoD related rows
      // (134726 Norfolk remediation, 134575/134583 Alexandria epoxy) are
      // set_aside NULL and must still surface HERE, in the explicitly labeled
      // "Related opportunities" section, never as default matches. The section
      // label discloses the absent cert filter. State resolution + contradiction
      // exclusion happen in JS below (identical logic to the strict path).
      if (state) {
        relatedRows = await runRelatedScanQuery(
          sql,
          RELATED_TRADE_TERMS[trade.toLowerCase()] ?? [],
          LOW_CONTENT_SQL,
        );
      }
    } catch (e) {
      // Owner v6: NEVER swallow a query failure into a successful empty
      // result. Log with context (incl. the query name) and rethrow so the
      // client receives a NON-TRIVIAL error response and renders the existing
      // error state + retry (never "0 matches").
      logScanFailure(e, { trade, state, cert: certId, sizePref: sizeId });
      throw e;
    }

    const scored = rows
      .filter((r) => {
        // Contradictory-location exclusion (owner 09-13): a row whose own
        // title/description names a DIFFERENT state's place signal than its
        // resolved geography is FLAGGED and excluded from state matching —
        // computed at match time from EXISTING fields only (PR-A; the stored
        // PR-B columns are NOT read). Raw values stay visible.
        const resolved = resolveBidState(r.location, r.agency);
        const conflicted = locationConflict(r.title, r.description, resolved);
        return (
          !conflicted &&
          // PR-C.0: authoritative certification decision (see cert-matching.ts).
          certMatches(r.set_aside, [r.source], certId) === "include" &&
          geoRelevantByState(r.location, r.agency, state)
        );
      })
      .map((r) => {
        const bid: RadarBidRow = {
          id: Number(r.id), title: String(r.title ?? ""), agency: r.agency ? String(r.agency) : null,
          description: r.description ? String(r.description) : null, location: r.location ? String(r.location) : null,
          category: r.category ? String(r.category) : null, due_date: r.due_date ? String(r.due_date) : null,
          estimated_value: r.estimated_value ? String(r.estimated_value) : null, naics_code: r.naics_code ? String(r.naics_code) : null,
          source_url: r.source_url ? String(r.source_url) : null, set_aside: r.set_aside ? String(r.set_aside) : null,
        };
        const { score, scoreLabel } = computeMatch(bid, {
          trade, isNaics, expansion, state, cert: certId, sizePref: sizeId,
        });
        const bidText = `${bid.title || ""} ${bid.category || ""} ${bid.description || ""}`;
        const tradeProvenance = tradeProvenanceFor(bidText, expansion, bid.naics_code);
        return { bid, score, scoreLabel, tradeProvenance, strong: isStrongTradeMatch(bid.title, bid.category, bid.description, bid.naics_code, expansion) };
      })
      .sort((a, b) => b.score - a.score);
    // FIX 1 (owner 09-14): only TITLE/NAICS-corroborated rows are DEFAULT
    // matches. Description/category-only keyword hits (junk category stamps
    // like "Construction" on a food bid, stray "security" wording) are WEAK —
    // excluded from the default result set and handled under Related
    // opportunities below (state-local rows only). NAICS-input queries are
    // exact-code matches and are strong by construction.
    const ranked = scored.filter((m) => m.strong).slice(0, 5);
    const weakRowCandidates = scored.filter((m) => !m.strong);

    // OWNER 09-16 (Radar scan-latency fix, order #1): this handler performs NO
    // FPDS/USAspending work. Incumbent intel is loaded LAZILY, per displayed
    // opportunity, by getRadarMatchIntel below — the scan now returns on the
    // base path (~0.2 s measured) instead of 7.6–15.8 s (up to 5 sequential,
    // rate-limited upstream lookups used to run right here).
    const matches: RadarMatch[] = [];
    for (let i = 0; i < ranked.length; i++) {
      const { bid, score, scoreLabel, tradeProvenance } = ranked[i];
      const match: RadarMatch = {
        id: bid.id, title: bid.title, agency: bid.agency, category: bid.category,
        location: bid.location, set_aside: bid.set_aside,
        set_aside_label: setAsideCardLabel(bid.set_aside),
        naics_code: bid.naics_code,
        source_url: bid.source_url, estimated_value: bid.estimated_value,
        estimated_value_num: parseValue(bid.estimated_value),
        due_date: bid.due_date, days_remaining: daysRemaining(bid.due_date),
        score, score_label: scoreLabel,
        trade_provenance: tradeProvenance,
        reasons: buildReasons(bid, { trade, isNaics, expansion, state, cert: certId, sizePref: sizeId, score, scoreLabel, tradeProvenance }),
        qualifications: buildQualifications(bid, { trade, isNaics, state, cert: certId }),
        requirements: buildRequirements(bid),
        next_action: buildNextAction(bid),
        incumbent: null,
        learned: matchPriorLoss(priorLossIndex, bid.agency, bid.naics_code),
      };
      // No enrichment here (owner 09-16): the card's incumbent field stays
      // null in the scan payload and is filled in lazily on the results screen.
      matches.push(match);
    }

    // ORDERING (owner 09-16): the incumbent-rich "FREE-FIRST-3 BIAS" (P1) re-order
    // existed only because the scan held incumbent data for every candidate. With
    // enrichment moved out of the synchronous path that data does not exist at
    // scan time, so the free preview falls back to the deterministic SCORE order
    // (the pre-#231 order). Matching, scoring, bucketing and the free-preview CAP
    // are unchanged; only the now-impossible intel-based re-ordering is gone.
    //
    // GATING (owner rule, UNCHANGED): incumbent intel is Professional+ EXCEPT the
    // free ≤3 radar matches — the scan used to strip it for every match past the
    // free 3 so the paywalled award price could never reach the client. The scan
    // now ships no intel at all, so that boundary moves to the lazy endpoint,
    // which must be able to PROVE entitlement: mint a signed ticket naming exactly
    // the ids that were entitled before (the first FREE_ANONYMOUS_RADAR_RESULTS
    // matches). Fail-open for the scan, fail-CLOSED for the data: no ticket ⇒ the
    // cards render "unavailable", never data.
    let intelTicket: string | null = null;
    try {
      if (SHOW_FREE_INCUMBENT && matches.length > 0) {
        const { signRadarIntelTicket } = await import("~/lib/radar-handoff.server");
        intelTicket = signRadarIntelTicket(
          matches.slice(0, FREE_ANONYMOUS_RADAR_RESULTS).map((m) => m.id),
        );
      }
    } catch (err) {
      // Constant string only — never the secret, never the payload.
      if (err instanceof Error && err.message.includes("RADAR_HANDOFF_SECRET is required")) {
        console.error("[radar] incumbent intel unavailable: missing server configuration (RADAR_HANDOFF_SECRET)");
      }
      intelTicket = null;
    }

    // PR2 signed handoff (owner 2026-09-07): when REAL matches exceed the free
    // cap AND the scanner is anonymous AND a visitor id is present, mint the
    // HMAC-signed first-party handoff cookie (criteria + locked match ids,
    // NO PII/email) so /signup can restore this exact scan after account
    // creation. Authenticated users never get it (normal entitlement, no
    // gating); <=3-match scans never mint it (nothing locked, nothing to
    // restore). Matching/ranking/eligibility are untouched — this only signs
    // the ALREADY-COMPUTED result. Fail-open: never break the scan.
    try {
      if (scanVisitorId && matches.length > FREE_ANONYMOUS_RADAR_RESULTS) {
        const { getCurrentUser: scanUser } = await import("~/lib/auth");
        if (!(await scanUser())) {
          const { signRadarHandoff, RADAR_HANDOFF_COOKIE, RADAR_HANDOFF_MAX_AGE_S } = await import("~/lib/radar-handoff.server");
          const lockedIds = matches.slice(FREE_ANONYMOUS_RADAR_RESULTS).map((m) => m.id);
          const { setCookie } = await import("@tanstack/react-start/server");
          // Fail-closed: getRadarHandoffSecret THROWS when RADAR_HANDOFF_SECRET
          // is not configured — never mint an unsigned/forgable cookie. The
          // outer try/catch keeps this from breaking the scan.
          setCookie(RADAR_HANDOFF_COOKIE, signRadarHandoff({
            v: scanVisitorId,
            t: trade.slice(0, 120),
            c: certId,
            s: state.slice(0, 2),
            z: (sizePref as string).slice(0, 24),
            m: lockedIds,
            k: Date.now(),
          }), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: RADAR_HANDOFF_MAX_AGE_S });
        }
      }
    } catch (err) {
      // Fail-open (the mint must never break the scan) — but LOUD on the config
      // failure so a missing Vercel env var can't silently disable the handoff
      // (owner 09-07). Constant string only: never the secret value, never the
      // payload/cookie, never the visitor id, never err.stack.
      if (err instanceof Error && err.message.includes("RADAR_HANDOFF_SECRET is required")) {
        console.error("[radar-handoff] mint unavailable: missing server configuration (RADAR_HANDOFF_SECRET)");
      }
    }
    // THREE-WAY BUCKETING (owner v6.1): partition the ranked STRICT matches
    // into LOCAL (resolved geography == the requested state) vs NATIONWIDE
    // (no resolvable geography — national set-aside rows kept for every state
    // by design, per-card "Open nationwide" label; a different state's rows are
    // already excluded by geoRelevant above). RELATED is a separate bucket
    // built from the adjacent-work query; its rows NEVER join `matches` — an
    // adjacent item is never a default janitorial/trucking match.
    const local: RadarMatch[] = [];
    const nationwide: RadarMatch[] = [];
    for (const m of matches) {
      // OWNER 09-14 (FIX 2): a NATIONAL-SCOPE contract ("United States", "RC",
      // "Multiple locations"…) is NEVER a local match — even when the buyer/
      // agency field names a state. matchGeographyBucket is the single source
      // of truth (also exercised by the regression tests).
      if (matchGeographyBucket(state, m.location, m.agency) === "local") local.push(m);
      else nationwide.push(m);
    }
    // Related rows are state-local adjacent work with related provenance (no
    // strict trade term — the low score honestly reflects that), no incumbent
    // intel (paid feature; the section is informational and explicitly labeled).
    const related: RadarMatch[] = [];
    for (const r of relatedRows) {
      const bid: RadarBidRow = {
        id: Number(r.id), title: String(r.title ?? ""), agency: r.agency ? String(r.agency) : null,
        description: r.description ? String(r.description) : null, location: r.location ? String(r.location) : null,
        category: r.category ? String(r.category) : null, due_date: r.due_date ? String(r.due_date) : null,
        estimated_value: r.estimated_value ? String(r.estimated_value) : null, naics_code: r.naics_code ? String(r.naics_code) : null,
        source_url: r.source_url ? String(r.source_url) : null, set_aside: r.set_aside ? String(r.set_aside) : null,
      };
      const resolved = resolveBidState(bid.location, bid.agency);
      if (resolved !== state) continue; // related rows surface only for the requested state
      if (locationConflict(bid.title, bid.description, resolved)) continue;
      if (matches.some((m) => m.id === bid.id)) continue; // never duplicate a strict match
      const { score, scoreLabel } = computeMatch(bid, {
        trade, isNaics, expansion, state, cert: certId, sizePref: sizeId,
      });
      related.push({
        id: bid.id, title: bid.title, agency: bid.agency, category: bid.category,
        location: bid.location, set_aside: bid.set_aside,
        set_aside_label: setAsideCardLabel(bid.set_aside),
        naics_code: bid.naics_code,
        source_url: bid.source_url, estimated_value: bid.estimated_value,
        estimated_value_num: parseValue(bid.estimated_value),
        due_date: bid.due_date, days_remaining: daysRemaining(bid.due_date),
        score, score_label: scoreLabel,
        trade_provenance: null,
        reasons: [
          `Related opportunity — adjacent work, not a direct "${trade}" match`,
          `Located in ${state}${bid.set_aside ? ` — ${String(bid.set_aside)} set-aside` : " — no set-aside designation (listed for awareness)"}`,
        ],
        qualifications: [], requirements: buildRequirements(bid), next_action: buildNextAction(bid),
        incumbent: null, learned: null,
      });
    }
    // FIX 1 (owner 09-14): description/category-only keyword hits (WEAK —
    // no title term, no implied NAICS) join the explicitly labeled Related
    // section when they are state-local; identical guards to relatedRows
    // (state resolution, contradiction exclusion, no duplicate of a strict
    // match or of an adjacent-work row). Nationwide weak rows are dropped
    // entirely — they are not local and not adjacent-local work, so they must
    // not dilute any default bucket.
    for (const w of weakRowCandidates) {
      const bid = w.bid;
      const resolved = resolveBidState(bid.location, bid.agency);
      if (resolved !== state) continue;
      if (locationConflict(bid.title, bid.description, resolved)) continue;
      if (matches.some((m) => m.id === bid.id)) continue;
      if (related.some((m) => m.id === bid.id)) continue;
      related.push({
        id: bid.id, title: bid.title, agency: bid.agency, category: bid.category,
        location: bid.location, set_aside: bid.set_aside,
        set_aside_label: setAsideCardLabel(bid.set_aside),
        naics_code: bid.naics_code,
        source_url: bid.source_url, estimated_value: bid.estimated_value,
        estimated_value_num: parseValue(bid.estimated_value),
        due_date: bid.due_date, days_remaining: daysRemaining(bid.due_date),
        score: w.score, score_label: w.scoreLabel,
        trade_provenance: null,
        reasons: [
          `Related opportunity — "${trade}" appears only in the description/category, not the title/NAICS (listed as adjacent evidence, never a default match)`,
          `Located in ${state}${bid.set_aside ? ` — ${String(bid.set_aside)} set-aside` : " — no set-aside designation (listed for awareness)"}`,
        ],
        qualifications: [], requirements: buildRequirements(bid), next_action: buildNextAction(bid),
        incumbent: null, learned: null,
      });
    }
    related.sort((a, b) =>
      a.due_date && b.due_date
        ? new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
        : a.due_date ? -1 : b.due_date ? 1 : 0,
    );
    return { matches, certLabel: CERT_LABEL[certId], sections: { local, nationwide, related }, intelTicket };
  });

/**
 * RADAR INCUMBENT INTEL — LAZY, PER DISPLAYED OPPORTUNITY (owner 09-16 order #1).
 *
 * The owner's order: "Return Radar matches BEFORE FPDS enrichment: remove
 * getFPDSIntel from the synchronous scan path. Load incumbent intelligence
 * separately, for each displayed opportunity." This is that endpoint — the
 * results screen calls it once per card, after the matches have rendered.
 *
 * Contract / guarantees:
 *   - Entitlement is verified SERVER-SIDE against the scan's signed ticket
 *     (~/lib/radar-handoff.server): only the match ids the scan minted (the free
 *     ≤3) can be looked up, so the paywalled previous-winner/award-price data for
 *     gated (4th+) matches can never be fetched by a crafted call. Fail-closed.
 *   - The lookup inputs come from the bid's OWN row (naics/agency/title) plus its
 *     STABLE identifiers (source + external_id) for the cache key — the client
 *     supplies only the bid id, never fields that steer the lookup.
 *   - NEVER HANGS: the lookup is bounded by its own AbortSignal budget in
 *     ~/lib/fpds, and this handler additionally races a wall-clock guard so the
 *     request answers even if a dependency in front of the lookup stalls.
 *   - Three-way status so the card can be honest: ok / none / unavailable.
 */
export const getRadarMatchIntel = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const v = (d as any) ?? {};
    const bidId = Math.trunc(Number(v.bidId));
    return {
      bidId: Number.isFinite(bidId) && bidId > 0 ? bidId : 0,
      ticket: String(v.ticket ?? "").slice(0, 4096),
    };
  })
  .handler(async ({ data }): Promise<MatchIntelResult> => {
    const unavailable: MatchIntelResult = { status: "unavailable", intel: null };
    if (!SHOW_FREE_INCUMBENT || !data.bidId) return unavailable;
    const { lookupFPDSIntel, FPDS_RADAR_LOOKUP_TIMEOUT_MS } = await import("~/lib/fpds");
    const work = async (): Promise<MatchIntelResult> => {
      const { verifyRadarIntelTicket, intelTicketAllows } = await import("~/lib/radar-handoff.server");
      if (!intelTicketAllows(verifyRadarIntelTicket(data.ticket), data.bidId)) return unavailable;
      const { sql } = await import("~/db");
      let row: any = null;
      try {
        const rows: any[] = await sql()`
          SELECT id, title, agency, naics_code, source, external_id
          FROM bids WHERE id = ${data.bidId} LIMIT 1`;
        row = rows[0] ?? null;
      } catch (err) {
        console.error("[radar-intel] bid read failed:", err);
      }
      if (!row) return unavailable;
      const res = await lookupFPDSIntel(row.naics_code ?? "", row.agency ?? "", row.title ?? "", {
        totalTimeoutMs: FPDS_RADAR_LOOKUP_TIMEOUT_MS,
        key: { source: row.source, opportunityId: row.external_id },
      });
      return res.status === "ok" ? { status: "ok", intel: res.intel } : { status: res.status, intel: null };
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const guard = new Promise<MatchIntelResult>((resolve) => {
        timer = setTimeout(() => resolve(unavailable), FPDS_RADAR_LOOKUP_TIMEOUT_MS + 1_500);
      });
      const result = work().catch((err) => {
        console.error("[radar-intel] failed:", err);
        return unavailable;
      });
      return await Promise.race([result, guard]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  });

/**
 * ≤3-MATCH RESULTS CTA handoff mint (owner 2026-09-09, the one authorized
 * exception to the frozen Radar Conversion experiment). The scan mints the PR2
 * signed handoff cookie ONLY when real matches EXCEED the free cap — a ≤3-match
 * scan has nothing locked, so no cookie exists. This mints the SAME cookie
 * (same helper signRadarHandoff, same RADAR_HANDOFF_COOKIE name, same payload
 * shape, same setCookie options, same RADAR_HANDOFF_SECRET) ON CLICK so /signup
 * restores the scan identically to source=radar_results_unlock. m=[] because
 * nothing is locked — /signup's restore falls back to the first
 * FREE_ANONYMOUS_RADAR_RESULTS matches of the re-run scan, i.e. every match the
 * visitor saw. No second mechanism. Fail-open: a mint failure never blocks the
 * click — the CTA href carries the criteria in the URL and /signup recovers
 * through its normal source=radar path.
 */
const mintRadarResultsCtaHandoff = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const v = (d as any) ?? {};
    return {
      trade: String(v.trade ?? "").trim().slice(0, 120),
      state: normalizeStateInput(String(v.state ?? "").trim()),
      cert: (RADAR_CERTS as readonly string[]).includes(String(v.cert ?? "sb")) ? String(v.cert) : "sb",
      sizePref: (SIZE_OPTS as readonly { id: string }[]).some((s) => s.id === String(v.sizePref ?? "any")) ? String(v.sizePref) : "any",
    };
  })
  .handler(async ({ data }) => {
    const { trade, state, cert, sizePref } = data;
    // Read the request's visitor cookie exactly like the scan-time mint (same
    // build-safe server scope). No visitor id → nothing to attribute → no cookie.
    let scanVisitorId = "";
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const cookie = getRequest().headers.get("cookie") ?? "";
      const hit = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("contrax_vid="));
      if (hit) scanVisitorId = decodeURIComponent(hit.slice("contrax_vid=".length)).trim().slice(0, 64);
    } catch {
      scanVisitorId = ""; // fail-open: no visitor id, no handoff cookie
    }
    try {
      if (!scanVisitorId) return { minted: false };
      const { getCurrentUser } = await import("~/lib/auth");
      if (await getCurrentUser()) return { minted: false }; // authenticated visitors never get the handoff
      const { signRadarHandoff, RADAR_HANDOFF_COOKIE, RADAR_HANDOFF_MAX_AGE_S } = await import("~/lib/radar-handoff.server");
      const { setCookie } = await import("@tanstack/react-start/server");
      // Fail-closed: getRadarHandoffSecret THROWS when RADAR_HANDOFF_SECRET is
      // not configured — never mint an unsigned/forgable cookie. The outer
      // try/catch keeps this from blocking the CTA navigation.
      setCookie(RADAR_HANDOFF_COOKIE, signRadarHandoff({
        v: scanVisitorId,
        t: trade,
        c: cert,
        s: state,
        z: sizePref,
        m: [], // ≤3-match scan: nothing locked — restore shows all the matches
        k: Date.now(),
      }), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: RADAR_HANDOFF_MAX_AGE_S });
      return { minted: true };
    } catch (err) {
      // Fail-open: navigation still happens; /signup recovers from URL criteria.
      if (err instanceof Error && err.message.includes("RADAR_HANDOFF_SECRET is required")) {
        console.error("[radar-handoff] mint unavailable: missing server configuration (RADAR_HANDOFF_SECRET)");
      }
      return { minted: false };
    }
  });

/** v6.2 headline "Related: N" — related rows that ALSO satisfy the selected
 *  certification (the section itself lists adjacent work, incl. uncertified DoD
 *  rows, with an explicit awareness disclosure; the headline counts only what
 *  is cert-actionable). Mirrors setAsidePred's literal patterns (open-bids.ts). */
function setAsideUnderCert(cert: string | null, setAside: string | null): boolean {
  const s = String(setAside ?? "").toLowerCase().trim();
  if (cert === "sb" || cert === null) return s.length > 0;
  const pats: Record<string, string[]> = {
    "8a": ["8(a)", "8an"], sdvosb: ["sdvosb"], wosb: ["wosb", "edwosb"],
    hubzone: ["hubzone"], vosb: ["vosb"],
  };
  return (pats[cert] ?? []).some((p) => s.includes(p));
}

function buildReasons(
  bid: RadarBidRow,
  c: { trade: string; isNaics: boolean; expansion: TradeExpansion; state: string; cert: RadarCert; sizePref: SizeId; score: number; scoreLabel: string; tradeProvenance: TradeMatchProvenance | null },
): string[] {
  const reasons: string[] = [];
  reasons.push(`${CERT_LABEL[c.cert]} solicitation — set aside for your certification`);
  const days = daysRemaining(bid.due_date);
  if (days != null) reasons.push(days <= 30 ? `Closing in ${days} day${days === 1 ? "" : "s"}` : `Closing in ${days} days`);
  const ev = parseValue(bid.estimated_value);
  if (ev != null) reasons.push(`Estimated value ${money(ev)}${c.sizePref !== "any" ? " fits your size preference" : ""}`);
  else reasons.push("Estimated value not listed — verify in the full solicitation");
  if (c.isNaics && bid.naics_code) reasons.push(`NAICS ${bid.naics_code} matches your code`);
  else if (!c.isNaics && c.trade) {
    const prov = c.tradeProvenance;
    if (prov) {
      // Honest provenance: if the LITERAL original term matched, say so;
      // otherwise name the expanded concept (never claim the literal word
      // appeared in the solicitation).
      const label = prov.matchedConcept === c.trade.toLowerCase() ? c.trade : prov.matchedConcept;
      reasons.push(
        prov.matchedNaics
          ? `Trade "${label}" — ${prov.conceptLabel} (NAICS ${prov.matchedNaics}) aligns with this opportunity`
          : `Trade "${label}" aligns with this opportunity`,
      );
    }
  }
  if (c.state) {
    // v6.2: "nationalwide" is the card's ELIGIBILITY tag; this reason bullet
    // states eligibility plainly — never a location claim (the card shows the
    // real place of performance separately). Owner 09-14: a national-scope
    // location never borrows the buyer/agency state either. Asked of the single
    // geography decision (matchGeographyBucket) so the bullet cannot contradict
    // the section the card is rendered in — incl. the agency-jurisdiction rule.
    reasons.push(
      matchGeographyBucket(c.state, bid.location, bid.agency) === "local"
        ? `Located in ${STATE_CODE_TO_NAME[c.state] ?? c.state} (verified)`
        : "Eligible from any state — national set-aside row",
    );
  }
  if (bid.agency) reasons.push(`Agency: ${bid.agency}`);
  return reasons;
}

function buildQualifications(
  bid: RadarBidRow,
  c: { trade: string; isNaics: boolean; state: string; cert: RadarCert },
): string[] {
  const q: string[] = [`Eligible as a ${CERT_LABEL[c.cert]} set-aside opportunity`];
  if (c.isNaics && bid.naics_code) {
    const name = NAICS_NAMES[bid.naics_code];
    q.push(`Aligned with NAICS ${bid.naics_code}${name ? ` — ${name}` : ""}`);
  } else if (!c.isNaics && c.trade) {
    q.push(`Matching your trade: "${c.trade}"`);
  }
  if (bid.category) q.push(`Category: ${bid.category}`);
  if (bid.agency) q.push(`Issued by ${bid.agency}`);
  return q;
}

function buildRequirements(bid: RadarBidRow): string[] {
  const desc = (bid.description || "").trim();
  if (!desc) return [];
  // Heuristic: surface sentences that read like requirements. Real text only.
  const sentences = desc.split(/(?<=[.!?])\s+/);
  const reqs = sentences
    .filter((s) => /\b(require|requires|must|shall|responsible|provide|submit|bond|licensed|license|clearance|certif|insurance|sam\.gov|must have|shall have)\b/i.test(s))
    .slice(0, 3)
    .map((s) => s.replace(/\s+/g, " ").trim());
  return reqs;
}

function buildNextAction(bid: RadarBidRow): string {
  const due = bid.due_date ? new Date(bid.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
  const base = due ? `Review the full solicitation and prepare your response before the ${due} deadline.` : "Review the full solicitation and prepare your response before the deadline.";
  return bid.source_url ? `${base} Open the original notice on SAM.gov to confirm all requirements.` : `${base} The original notice link is not yet available in our system.`;
}

// ── Route ────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/radar")({
  component: RadarLanding,
  head: () => ({
    meta: [
      { title: "Contract Radar — Live Match Scores for Set-Aside Contracts | Contrax" },
      {
        name: "description",
        content:
          "Not sure which set-asides your certification qualifies you for? Contract Radar shows your strongest live matches — the first 3 free, with full Incumbent Intelligence (previous winner and award price).",
      },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: "Contract Radar — Find contracts you can actually win | Contrax" },
      {
        property: "og:description",
        content:
          "Answer four quick questions. Contract Radar scans live federal, state and local solicitations and reveals your strongest matches one at a time — the first 3 are free, with full incumbent intel.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Contract Radar — Find contracts you can actually win | Contrax" },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/radar" }],
  }),
});

type Step = 1 | 2 | 3;
/** Three-way result buckets (owner v6.1): LOCAL / NATIONWIDE / RELATED are
 *  separate, explicitly labeled sections. RELATED items are adjacent work —
 *  NEVER default janitorial/trucking matches. */
export interface RadarSections {
  local: RadarMatch[];
  nationwide: RadarMatch[];
  related: RadarMatch[];
}
type ScanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; matches: RadarMatch[]; certLabel: string; sections: RadarSections; intelTicket: string | null }
  | { status: "error" };
/** Resolved payload of a successful runRadarScan call (handler return shape).
 *  `intelTicket` (owner 09-16): the signed, server-minted list of the match ids
 *  entitled to incumbent intel — the lazy getRadarMatchIntel endpoint requires
 *  it. null = no ticket (missing server config) ⇒ the cards show an honest
 *  "unavailable", never a fabricated "no previous winner". */
type ScanResult = {
  matches: RadarMatch[];
  certLabel: string;
  sections: RadarSections;
  intelTicket: string | null;
};
/** USPS code → full state name (for section labels). */
const STATE_CODE_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAME_TO_CODE).map(([name, code]) => [code, name]),
);

// OWNER 09-15/09-16 (everyday-service trades + canonical NAICS presentation):
// the datalist suggestions come from ONE shared source (~/lib/trade-suggestions)
// instead of the old `slice(0, 120)` window over NAICS_NAMES. That window
// stopped inside the support-services sector, so Facilities Support 561210,
// Security Guards 561612, Janitorial 561720, Landscaping 561730 and Solid Waste
// Collection 562111 (positions 129-148 of 184) never reached the public
// dropdown. The shared list leads with the curated TRADES (search term + curated
// label), then the curated codes (each ONCE under its official NAICS_NAMES
// title — 492110 canonical-once), then the COMPLETE code set. HeroRadar renders
// the exact same list. The trade field stays free text; presentation-only.

function RadarLanding() {
  const [step, setStep] = useState<Step>(1);
  // Deep-link initial state (owner-directed): /radar accepts `?trade=&state=&cert=&size=`
  // so CTAs (homepage hero, Example Brief section) can drop a visitor straight
  // onto a personalized scan with their trade / certification preselected. Each
  // param is validated against its known set (cert ids, size ids, two-letter US
  // states); invalid or absent params fall through to saved answers / defaults.
  // The form is PRE-FILLED but NOT auto-scanned — the visitor still owns the
  // "Scan" click (honesty + intent: they confirm the criteria).
  //
  // Directive order per field: URL param (an explicit deep link) > saved radar
  // answers (localStorage) > empty defaults.
  const searchParams = Route.useSearch() as {
    trade?: unknown;
    state?: unknown;
    cert?: unknown;
    size?: unknown;
  };
  const uTrade = String(searchParams?.trade ?? "").trim();
  const uState = String(searchParams?.state ?? "").trim().toUpperCase();
  const uCert = String(searchParams?.cert ?? "").trim();
  const uSize = String(searchParams?.size ?? "").trim();
  const urlTrade = uTrade;
  const urlState = normalizeStateInput(uState);
  const urlCert = (RADAR_CERTS as readonly string[]).includes(uCert)
    ? (uCert as RadarCert)
    : null;
  const urlSizePref = (SIZE_OPTS as readonly { id: string }[]).some((s) => s.id === uSize)
    ? (uSize as SizeId)
    : null;
  const hasDeepLink = !!(urlTrade || urlState || urlCert || urlSizePref);
  const [trade, setTrade] = useState(urlTrade);
  const [state, setState] = useState(urlState);
  const [cert, setCert] = useState<RadarCert | null>(urlCert);
  const [sizePref, setSizePref] = useState<SizeId | null>(urlSizePref);
  const [scan, setScan] = useState<ScanState>({ status: "idle" });
  const [revealed, setRevealed] = useState(0);
  const [flashTimer, setFlashTimer] = useState<number | null>(null);
  // Soft, dismissible "keep these matches" nudge shown after the FIRST match is
  // revealed (non-blocking — never a hard gate; the real gate still only
  // appears after the free cap).
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  // RADAR CONVERSION SPRINT PR1 (owner 2026-09-07): anonymous visitors no
  // longer stop at the free cap mid-scan — they complete the FULL scan and see
  // ALL their matches on the results screen (authenticated users keep normal
  // entitlement). VISIBLE = real total capped at FREE_ANONYMOUS_RADAR_RESULTS;
  // the locked card (with the REAL locked count) renders only when real matches
  // exceed the cap.
  const isAnonymous = !getTrackingUser();
  const totalMatches = scan.status === "done" ? scan.matches.length : 0;
  const visibleCount = Math.min(totalMatches, FREE_ANONYMOUS_RADAR_RESULTS);
  /** Real locked count — ONLY non-zero when genuine matches exceed the free cap. */
  const locked = Math.max(totalMatches - FREE_ANONYMOUS_RADAR_RESULTS, 0);

  // PR1 funnel: fires exactly once when an ANONYMOUS visitor's results screen
  // first renders after a completed scan (guarded so a refresh/re-render cannot
  // double-fire; the server also collapses same-event+visitor+path within 1s).
  const resultsViewedFired = useRef(false);
  useEffect(() => {
    if (!isAnonymous) return;
    if (resultsViewedFired.current) return;
    if (scan.status !== "done") return;
    resultsViewedFired.current = true;
    trackEvent("radar_results_viewed", scan.certLabel);
  }, [scan.status, scan.certLabel, isAnonymous]);
  // Guards against re-prefilling and against persisting the mount-time prefill.
  // Starts TRUE when a deep link carried params (their initial-state prefill is
  // not a visitor action and must not be written to localStorage), FALSE
  // otherwise so a returning visitor's saved answers can still restore.
  const prefilledRef = useRef(hasDeepLink);
  // True once the visitor actually changes a form value or starts a scan. Used to
  // distinguish a mount-time deep-link prefill (no localStorage write) from real
  // visitor activity (persist as they answer).
  const didInteract = useRef(false);
  // Deep-link prefill note: the URL params are applied as INITIAL STATE above
  // (so SSR and first paint carry the prefill), not via an effect — no
  // localStorage write happens on mount for a deep link. Saved-answer restore
  // (localStorage) only applies when no deep-link params are present, so the
  // directive order URL > saved > default is honored per field.

  useEffect(() => {
    return () => {
      if (flashTimer) window.clearTimeout(flashTimer);
    };
  }, [flashTimer]);

  // OWNER 09-14 HARDENING: the Radar screen can never be left stuck on
  // "scanning…". scanCancelledRef flips true on unmount and every success /
  // failure handler checks it before touching state; scanRaceRef holds the
  // active scan race so unmount can clear the 15s timeout timer too.
  const scanCancelledRef = useRef(false);
  const scanRaceRef = useRef<RadarScanRace<ScanResult> | null>(null);
  useEffect(() => {
    return () => {
      scanCancelledRef.current = true;
      scanRaceRef.current?.clearTimer();
    };
  }, []);

  // Persist the visitor's radar criteria as they answer (no email involved).
  // Saved only once they're complete (cert + size chosen). /signup and /radar
  // both read this to make resuming a ~10s continuation instead of a restart.
  useEffect(() => {
    if (!cert || !sizePref) return;
    if (prefilledRef.current && !didInteract.current) return; // mount-time prefill snapshot is not a visitor action
    saveRadarAnswers({ trade: trade.trim(), state, cert, sizePref });
  }, [trade, state, cert, sizePref]);

  // Prefill the radar form from a previous anonymous session (e.g. returning
  // from /dashboard's "see them again"), so a revisit restores the answers.
  // Only applies when no deep-link params handled the prefill (prefilledRef is
  // already set once the URL-prefill effect runs, with or without params).
  useEffect(() => {
    if (prefilledRef.current || cert || sizePref) return;
    const ra = getRadarAnswers();
    if (ra) {
      prefilledRef.current = true;
      setTrade(ra.trade);
      setState(ra.state);
      if ((RADAR_CERTS as readonly string[]).includes(ra.cert)) setCert(ra.cert as RadarCert);
      if ((SIZE_OPTS as readonly { id: string }[]).some((s) => s.id === ra.sizePref)) {
        setSizePref(ra.sizePref as SizeId);
      }
    }
  }, [cert, sizePref]);

  // LAZY incumbent intel (owner 09-16): nothing is fetched during the scan; the
  // results screen pulls it per displayed opportunity once matches are on screen.
  const matchIntel = useRadarIntel(
    scan.status === "done" ? scan.matches : [],
    scan.status === "done" ? scan.intelTicket : null,
  );

  const editing = trade.trim() !== "" && cert !== null && sizePref !== null;

  // Reveal the next match + keep the persisted radar-session "seen" state in
  // sync, and fire the funnel event for the soft nudge the moment the FIRST
  // match is behind the visitor. Bounded: authenticated users can reveal any
  // match; anonymous visitors stop at the REAL free cap (the locked card takes
  // over at that point — it is only ever shown when real matches exceed the cap).
  const handleRevealNext = () => {
    const total = scan.status === "done" ? scan.matches.length : 0;
    const cap = getTrackingUser() ? total : Math.min(total, FREE_ANONYMOUS_RADAR_RESULTS);
    const next = revealed + 1;
    trackEvent("radar_next_match", scan.status === "done" ? scan.certLabel : "");
    if (scan.status === "done") {
      const existing = getRadarSeen();
      const seenCap = getTrackingUser() ? total : Math.min(total, FREE_ANONYMOUS_RADAR_RESULTS);
      if (existing) saveRadarSeen({ ...existing, seenCount: Math.min(Math.min(next, seenCap), existing.matches.length) });
    }
    setRevealed(Math.min(next, Math.max(cap, 0)));
  };

  const runScan = (
    input: { trade: string; state: string; cert: RadarCert; sizePref: SizeId },
    opts?: { timeoutMs?: number },
  ) => {
    // A visitor-initiated scan is real activity — from here on the save effect
    // may persist the criteria (and runScan itself persists the SEEN matches).
    didInteract.current = true;
    trackEvent("radar_scan_start", input.cert);
    setScan({ status: "loading" });
    setRevealed(0);

    // OWNER 09-14 HARDENING — the "scanning…" screen can NEVER stay stuck:
    //  1. the runRadarScan invocation is wrapped in a try/catch so a
    //     synchronous throw cannot leave scan.status="loading";
    //  2. a 15s client timeout (RADAR_SCAN_TIMEOUT_MS) races the real scan via
    //     Promise.race (lib raceRadarScan — owner-verbatim structure, unit
    //     tested for all four exit paths);
    //  3. on timeout OR any error: state moves to the existing error/retry
    //     screen and a radar_scan_failed event logs reason "timeout" |
    //     "request_error" — a failed request never shows an honest-zero result;
    //  4. the race timer is cleared on BOTH success and failure (clearTimer in
    //     .then and .catch) and on unmount (scanCancelledRef / scanRaceRef).
    // Latency note (for review): representative real scans can take 10-30s+
    // cold/heavier trades, so the 15s cap will surface the error screen +
    // Try again for slow scans — by design per owner spec (see PR body).
    const handleSuccessfulScan = (res: ScanResult) => {
      // Success path — clear the 15s timer, then guard against unmount.
      scanRaceRef.current?.clearTimer();
      if (scanCancelledRef.current) return;
      if (flashTimer) window.clearTimeout(flashTimer);
      trackEvent("radar_scan_complete", input.cert);
      // The soft nudge is visible the moment the FIRST match is revealed
      // (revealed stays 0 on completion), so attribute its impression here.
      if (res.matches.length > 0) trackEvent("radar_nudge_shown", res.certLabel);
      // Persist this anonymous radar session (criteria + the REAL
      // server-computed matches) so a later signup/login can pick it up
      // in-app — no email involved (owner-directed: no email capture).
      //
      // PR1 seenCount: anonymous visitors see the first FREE matches up
      // front (no more reveal-one-at-a-time until match 4); the count is
      // set to how many they are entitled to see now (min(total, free cap))
      // — /dashboard + /signup read this to show their matches.
      const seenCap = getTrackingUser() ? res.matches.length : Math.min(res.matches.length, FREE_ANONYMOUS_RADAR_RESULTS);
      saveRadarSeen({
        answers: { trade: input.trade, state: input.state, cert: input.cert, sizePref: input.sizePref },
        certLabel: res.certLabel,
        total: res.matches.length,
        seenCount: seenCap,
        matches: res.matches.map((m) => ({
          id: m.id,
          title: m.title,
          agency: m.agency,
          score: m.score,
          score_label: m.score_label,
          due_date: m.due_date,
          source_url: m.source_url,
        })),
      });
      setScan({
        status: "done",
        matches: res.matches,
        certLabel: res.certLabel,
        sections: res.sections,
        intelTicket: res.intelTicket ?? null,
      });
      setStep(3);
    };

    const handleFailedScan = (error: unknown) => {
      // Failure path — clear the 15s timer, then guard against unmount.
      scanRaceRef.current?.clearTimer();
      if (scanCancelledRef.current) return;
      if (flashTimer) window.clearTimeout(flashTimer);
      // NEVER an honest-zero result: a failed request only ever lands on the
      // error/retry screen, with the cause logged for the funnel.
      setScan({ status: "error" });
      setStep(3);
      trackEvent(
        "radar_scan_failed",
        error instanceof Error && error.message === RADAR_SCAN_TIMEOUT_ERROR
          ? "timeout"
          : "request_error",
      );
    };

    // Small real processing pause so the "scanning" reveal reads as active work,
    // while the actual match computation happens server-side over live data.
    const t = window.setTimeout(() => {
      try {
        const race = raceRadarScan<ScanResult>(
          () =>
            runRadarScan({
              data: {
                trade: input.trade,
                state: input.state,
                cert: input.cert,
                sizePref: input.sizePref,
              },
            }),
          opts?.timeoutMs ?? RADAR_SCAN_TIMEOUT_MS,
        );
        scanRaceRef.current = race;
        race.promise.then(handleSuccessfulScan).catch(handleFailedScan);
      } catch (error) {
        // Synchronous throw from the invocation itself — same failure path,
        // so status can never remain "loading".
        handleFailedScan(error);
      }
    }, 1100);
    setFlashTimer(t);
    setStep(2);
  };

  const startScan = () => {
    if (!editing) return;
    runScan({ trade: trade.trim(), state, cert: cert!, sizePref: sizePref! });
  };
  const track = (trade.trim() || "any");
  const stateLabel = state ? ` / ${state}` : "";

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 py-8">
        <a
          href="/"
          onClick={() => trackEvent("hero_cta_click", "radar_logo")}
          className="self-start text-sm font-bold tracking-tight text-amber-400 hover:text-amber-300"
        >
          ⬢ CONTRAX — Contract Radar
        </a>

        {step === 1 && (
          <section className="flex flex-1 flex-col justify-center py-8">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Contract Radar</p>
            <h1 className="mt-2 text-2xl font-bold leading-tight text-white sm:text-3xl">
              Wondering which set-asides you actually qualify for? Your first 3 matches are free.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              Answer four quick questions and we'll reveal your strongest live
              set-aside matches — one at a time, with a real match score and full
              Incumbent Intelligence (previous winner &amp; award price).
            </p>

            <div className="mt-8 flex flex-col gap-6">
              {/* Trade / NAICS */}
              <div>
                <label htmlFor="radar-trade" className="text-sm font-semibold text-slate-200">
                  1. Your trade or NAICS code
                </label>
                <input
                  id="radar-trade"
                  list="radar-naics-list"
                  value={trade}
                  onChange={(e) => {
                    didInteract.current = true;
                    setTrade(e.target.value);
                  }}
                  placeholder='e.g. "HVAC" or a 6-digit NAICS like 238220'
                  className="mt-2 w-full rounded-2xl border-2 border-slate-700 bg-slate-900 px-5 py-4 text-base text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                />
                <datalist id="radar-naics-list">
                  {TRADE_SUGGESTIONS.map(([value, text]) => (
                    <option key={value} value={value}>{text}</option>
                  ))}
                </datalist>
              </div>

              {/* State */}
              <div>
                <label htmlFor="radar-state" className="text-sm font-semibold text-slate-200">
                  2. Your state
                </label>
                <select
                  id="radar-state"
                  value={state}
                  onChange={(e) => {
                    didInteract.current = true;
                    setState(e.target.value);
                  }}
                  className="mt-2 w-full rounded-2xl border-2 border-slate-700 bg-slate-900 px-5 py-4 text-base text-white focus:border-amber-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  <option value="">Any state (nationwide)</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Certification */}
              <div>
                <p className="text-sm font-semibold text-slate-200">3. Your set-aside certification</p>
                <div role="list" className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {RADAR_CERTS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="listitem"
                      onClick={() => {
                        didInteract.current = true;
                        setCert(c);
                        trackEvent("radar_cert_selected", c);
                      }}
                      aria-pressed={cert === c}
                      className={`rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold transition-all active:scale-[0.98] ${
                        cert === c
                          ? "border-amber-500 bg-amber-500/15 text-amber-300"
                          : "border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500"
                      }`}
                    >
                      {CERT_LABEL[c]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Size */}
              <div>
                <p className="text-sm font-semibold text-slate-200">4. Preferred contract size</p>
                <div role="list" className="mt-2 grid grid-cols-2 gap-2">
                  {SIZE_OPTS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="listitem"
                      onClick={() => {
                        didInteract.current = true;
                        setSizePref(s.id);
                        trackEvent("radar_size_selected", s.id);
                      }}
                      aria-pressed={sizePref === s.id}
                      className={`rounded-xl border-2 px-4 py-3 text-left transition-all active:scale-[0.98] ${
                        sizePref === s.id
                          ? "border-amber-500 bg-amber-500/15"
                          : "border-slate-700 bg-slate-900 hover:border-slate-500"
                      }`}
                    >
                      <span className="block text-sm font-semibold text-white">{s.label}</span>
                      <span className="block text-xs text-slate-400">{s.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                disabled={!editing}
                onClick={startScan}
                className="mt-2 w-full rounded-2xl bg-amber-500 px-6 py-4 text-base font-bold text-slate-950 shadow-lg transition-all hover:bg-amber-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Scan the market for my matches →
              </button>
              <p className="text-center text-xs text-slate-500">
                Scans live federal, state and local solicitations.
              </p>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="flex flex-1 flex-col justify-center py-10" aria-live="polite">
            <div className="rounded-2xl border-2 border-amber-500 bg-amber-500/10 px-6 py-12 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 animate-pulse items-center justify-center rounded-full border-2 border-amber-400 bg-slate-900 text-2xl">
                <span aria-hidden="true">📡</span>
              </div>
              <p className="text-2xl font-extrabold tracking-tight text-amber-400 sm:text-3xl">
                Contract Radar is scanning the market…
              </p>
              <p className="mt-3 text-sm text-slate-300">
                Matching live solicitation data against your{" "}
                {cert ? CERT_LABEL[cert] : ""} certification
                {state ? ` in ${state}` : " nationwide"}.
              </p>
            </div>
          </section>
        )}

        {step === 3 && scan.status === "error" && (
          <section className="flex flex-1 flex-col justify-center py-10" role="alert">
            <p className="text-center text-amber-400">
              We couldn't scan the market right now. Please try again in a moment.
            </p>
            <button
              type="button"
              onClick={startScan}
              className="mx-auto mt-6 w-full rounded-2xl bg-amber-500 px-6 py-4 font-bold text-slate-950 hover:bg-amber-400"
            >
              Try again
            </button>
          </section>
        )}

        {step === 3 && scan.status === "done" && (
          <section className="flex flex-1 flex-col py-6">
            <button
              type="button"
              onClick={() => { setStep(1); setScan({ status: "idle" }); setRevealed(0); setNudgeDismissed(false); }}
              className="self-start text-sm text-slate-400 hover:text-slate-200"
            >
              ← Adjust my answers
            </button>
            <div className="mt-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-white sm:text-2xl">Your top matches</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {scan.certLabel}{stateLabel} · {tradeLabel(track)} · real scores
                </p>
              </div>
              {state !== "" ? (
                <span className="shrink-0 text-right text-xs font-semibold text-amber-400">
                  {(scan.sections?.local ?? []).length} local ·{" "}
                  {(scan.sections?.nationwide ?? []).length} nationwide · Related:{" "}
                  {(scan.sections?.related ?? []).filter((m) => setAsideUnderCert(cert, m.set_aside)).length}
                </span>
              ) : (
                <span className="text-xs font-semibold text-amber-400">
                  {scan.matches.length} found
                </span>
              )}
            </div>
{/* THREE-WAY BUCKETS (owner v6.1): LOCAL / NATIONWIDE / RELATED are
                separate, explicitly labeled sections. Nationwide rows are kept
                for every state by design and carry the per-card "Open
                nationwide" label; related items are adjacent work and are NEVER
                default janitorial/trucking matches. */}
            {state !== "" && (
              <section
                aria-label={`${STATE_CODE_TO_NAME[state] ?? state}-local opportunities`}
                className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/50 px-5 py-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-200">
                    📍 {STATE_CODE_TO_NAME[state] ?? state}-local opportunities
                  </h3>
                  <span className="text-xs font-semibold text-slate-400">
                    {(scan.sections?.local ?? []).length} found
                  </span>
                </div>
                {scan.sections && scan.sections.local.length > 0 ? (
                  <div className="mt-4 flex flex-col gap-4">
                    {scan.sections.local.map((m, i) => (
                      <RadarCard
                        key={m.id}
                        match={m}
                        intel={matchIntel[m.id]}
                        certLabel={scan.certLabel}
                        index={i + 1}
                        total={scan.sections.local.length}
                        trade={trade}
                        state={state}
                        cert={cert}
                        sizePref={sizePref}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">
                    No open {STATE_CODE_TO_NAME[state] ?? state}-local{" "}
                    {trade.trim() ? `"${trade.trim()}" ` : ""}opportunities right now — this is the
                    honest, unfiltered result: the database currently has no open state-located
                    row matching your trade and certification.
                  </p>
                )}
              </section>
            )}
            {state !== "" && (scan.sections?.nationwide ?? []).length > 0 && (
              <div className="mt-8 flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-200">
                  🌎 Open nationwide
                </h3>
                <span className="text-xs font-semibold text-amber-400">
                  {(scan.sections?.nationwide ?? []).length} found
                </span>
              </div>
            )}
            {/* PR1 (owner 2026-09-07): anonymous visitors see their first
                FREE_ANONYMOUS_RADAR_RESULTS REAL matches up front on the results
                screen (no mid-flow gate). The lined count is always the real
                total; the per-card "of N" index uses the visible cap so a
                4th+ match can never claim "of 3". */}
            {scan.matches.length > 0 && (
              <p className="mt-3 text-xs font-medium text-slate-500">
                {isAnonymous
                  ? `Here are your strongest ${Math.min(scan.matches.length, FREE_ANONYMOUS_RADAR_RESULTS)} ${
                      Math.min(scan.matches.length, FREE_ANONYMOUS_RADAR_RESULTS) === 1 ? "match" : "matches"
                    } — every one with full incumbent intel`
                  : state !== ""
                    ? `${(scan.sections?.local ?? []).length} local · ${(scan.sections?.nationwide ?? []).length} nationwide set-aside opportunities`
                    : `${scan.matches.length} ${scan.matches.length === 1 ? "match" : "matches"} found for you`}
              </p>
            )}

            {/* Soft, NON-BLOCKING nudge — appears after the FIRST match is revealed.
                Dismissible; never a hard gate. The full locked-results card still
                only appears past the free cap (anonymous, real matches > cap). */}
            {scan.matches.length > 0 && revealed >= 0 && !nudgeDismissed && (
              <div className="mt-5 flex items-start justify-between gap-3 rounded-xl border border-amber-500/40 bg-slate-900 px-4 py-3">
                <p className="text-sm leading-relaxed text-slate-200">
                  <span className="font-semibold text-amber-400">Keep these matches.</span>{" "}
                  Create a free account to save them and get deadline alerts.
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={radarSignupHref({ trade, state, cert, sizePref })}
                    onClick={() => trackEvent("radar_nudge_cta", scan.certLabel)}
                    className="whitespace-nowrap rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 transition-colors hover:bg-amber-400"
                  >
                    Create free account
                  </a>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={() => { setNudgeDismissed(true); trackEvent("radar_nudge_dismiss", scan.certLabel); }}
                    className="px-1 text-slate-400 transition-colors hover:text-slate-200"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            {scan.matches.length === 0 && (
              <div className="mt-8 rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-5 py-10 text-center text-sm text-slate-300">
                <p className="text-base font-semibold text-white">No strong matches yet.</p>
                <p className="mx-auto mt-2 max-w-md text-slate-300">
                  Try broadening your criteria, or leave your email and Contrax
                  can notify you when a matching opportunity appears.
                </p>
                <button
                  type="button"
                  onClick={() => { setStep(1); setScan({ status: "idle" }); setRevealed(0); setNudgeDismissed(false); }}
                  className="mt-6 w-full rounded-2xl border border-slate-600 bg-slate-800 px-6 py-3 text-base font-bold text-white transition-all hover:bg-slate-700 active:scale-[0.98]"
                >
                  Adjust Radar
                </button>
              </div>
            )}

            {/* ANONYMOUS results (PR1): the first min(total, free cap) REAL
                matches render up front; the locked-results card renders ONLY
                when real matches exceed the cap (never a manufactured wall). */}
            {isAnonymous && scan.matches.length > 0 && (
              <div className="mt-6 flex flex-col gap-5">
                {scan.matches.slice(0, visibleCount).map((m, i) => (
                  <RadarCard
                    key={m.id}
                    match={m}
                    intel={matchIntel[m.id]}
                    certLabel={scan.certLabel}
                    index={i + 1}
                    total={visibleCount}
                    trade={trade}
                    state={state}
                    cert={cert}
                    sizePref={sizePref}
                  />
                ))}
                {locked > 0 && (
                  <SignupGate
                    certLabel={scan.certLabel}
                    totalFound={scan.matches.length}
                    trade={trade}
                    state={state}
                    cert={cert}
                    sizePref={sizePref}
                  />
                )}
                {/* Owner 09-09 (the ONE authorized exception to the frozen
                    experiment): anonymous visitors with 1..=3 real matches see
                    ALL of them — no locked card — so give them the signup CTA
                    here instead (never authenticated, never 0 matches, never
                    >3 — those keep the locked card above unchanged). */}
                {locked === 0 && (
                  <RadarResultsCta
                    certLabel={scan.certLabel}
                    totalFound={scan.matches.length}
                    trade={trade}
                    state={state}
                    cert={cert}
                    sizePref={sizePref}
                  />
                )}
              </div>
            )}

            {/* AUTHENTICATED results (normal entitlement — NEVER gated): reveal
                one at a time, unbounded by the anonymous free cap. */}
            {!isAnonymous && scan.matches.length > 0 && revealed < scan.matches.length && (
              <div className="mt-6">
                <RadarCard
                  match={scan.matches[revealed]}
                  intel={matchIntel[scan.matches[revealed].id]}
                  certLabel={scan.certLabel}
                  index={revealed + 1}
                  total={scan.matches.length}
                  trade={trade}
                  state={state}
                  cert={cert}
                  sizePref={sizePref}
                />
                {revealed < scan.matches.length - 1 ? (
                  <button
                    type="button"
                    onClick={handleRevealNext}
                    className="mt-5 w-full rounded-2xl bg-amber-500 px-6 py-4 text-base font-bold text-slate-950 shadow-lg transition-all hover:bg-amber-400 active:scale-[0.98]"
                  >
                    Reveal my next match →
                  </button>
                ) : null}
              </div>
            )}
            {/* "Save your matches" — anonymous email opt-in (option A). Shows only
                for ANONYMOUS visitors on a COMPLETED scan with matches (post-scan
                results screen), is optional/dismissible, never a wall, and requires
                no account. Converts the bounce dead-end into an opted-in contact. */}
            {isAnonymous && scan.matches.length > 0 && (
              <SaveMatchesCard
                certLabel={scan.certLabel}
                trade={trade}
                state={state}
                cert={cert ?? ""}
                sizePref={sizePref ?? ""}
                matchedCount={scan.matches.length}
              />
            )}
            {/* "Want new matches when we find them?" — anonymous match-ALERT
                capture (owner 2026-09-06). ONLY for anonymous visitors, ONLY after
                a COMPLETED scan with matches. SECONDARY in the PR1 results
                hierarchy under the locked-card CTA (phrased as the
                "by email instead?" alternative, per owner 09-07). Optional,
                dismissible, never a wall — a voluntary email with explicit
                consent to be alerted when new matching opportunities open (no
                account required). Sends only the ONE confirmation email; the
                periodic match-alert sender is a separately queued follow-up. */}
            {isAnonymous && scan.matches.length > 0 && (
              <MatchAlertsCard
                certLabel={scan.certLabel}
                trade={trade}
                state={state}
                cert={cert ?? ""}
                sizePref={sizePref ?? ""}
              />
            )}
            {/* RELATED opportunities (owner v6.1) — adjacent work in the
                requested state, explicitly labeled, NEVER default matches. An
                empty section is an honest, documented outcome (current data/
                cert filters may legitimately leave it empty). */}
            {state !== "" && (
              <section
                aria-label="Related opportunities"
                className="mt-8 rounded-2xl border border-dashed border-amber-500/40 bg-slate-900/40 px-5 py-5"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-amber-300">
                    Related opportunities
                  </h3>
                  <span className="text-xs font-semibold text-slate-400">
                    {(scan.sections?.related ?? []).length}{" "}
                    {scan.sections && scan.sections.related.length === 1 ? "item" : "items"}
                  </span>
                </div>
                {scan.sections && scan.sections.related.length > 0 ? (
                  <div className="mt-3 flex flex-col gap-3">
                    {scan.sections.related.map((m) => (
                      <article
                        key={m.id}
                        className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3"
                      >
                        <p className="text-sm font-semibold text-white">{m.title}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {displayPlaceOfPerformance(m.title, m.location, m.agency) ??
                            "Place of performance not specified"}
                          {m.agency ? ` · ${m.agency}` : ""}
                          {m.due_date
                            ? ` · Due ${new Date(m.due_date).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}`
                            : ""}
                        </p>
                        {m.reasons.slice(0, 2).map((r) => (
                          <p key={r} className="mt-1 text-xs text-slate-300">
                            {r}
                          </p>
                        ))}
                      </article>
                    ))}
                    <p className="mt-1 text-xs text-slate-500">
                      Adjacent work is shown ONLY here — it is never a default{" "}
                      {`"${trade.trim() || "trade"}"`} match.
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">
                    No adjacent work currently matches in {STATE_CODE_TO_NAME[state] ?? state} —
                    an honest, documented outcome for this trade/state right now.
                  </p>
                )}
              </section>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function tradeLabel(t: string): string {
  if (!t || t === "any") return "broad market";
  return `"${t}"`;
}

/**
 * LAZY INCUMBENT-INTEL HOOK (owner 09-16) — the client half of the fix.
 *
 * The scan returns matches immediately and ships NO intel; this hook fills it in
 * AFTER the results render, per DISPLAYED opportunity (the free ≤3 the scan
 * minted a ticket for — the same matches that were enriched before), through the
 * bounded getRadarMatchIntel server fn. Every card state is one of
 * loading / ok / none / unavailable; the "loading" state is bounded client-side
 * by RADAR_INTEL_CLIENT_TIMEOUT_MS (~/lib/radar-intel), so a card can never sit
 * in a loading state and no request can hang. The 15 s scan cap is untouched.
 *
 * EXPORTED (owner 09-16, homepage-hero follow-up): the homepage hero
 * (HeroRadar) runs this SAME scan and shows the same intel on its displayed
 * free <=3 cards, so it reuses THIS hook and the getRadarMatchIntel server fn
 * verbatim instead of growing a parallel loader. Only the first
 * FREE_ANONYMOUS_RADAR_RESULTS ids - the ones the scan's signed intel ticket
 * covers - are ever requested, so gated cards still cost zero requests.
 */
export function useRadarIntel(
  matches: RadarMatch[],
  intelTicket: string | null,
): Record<number, MatchIntelState> {
  const [intel, setIntel] = useState<Record<number, MatchIntelState>>({});
  // Bounded, serializable dependency: the entitled (first ≤3) match ids.
  const eligibleIds = matches.slice(0, FREE_ANONYMOUS_RADAR_RESULTS).map((m) => m.id);
  const eligibleKey = eligibleIds.join(",");
  useEffect(() => {
    if (!SHOW_FREE_INCUMBENT || !eligibleKey) return;
    const ids = eligibleKey.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) return;
    if (!intelTicket) {
      // No entitlement ticket (e.g. missing server configuration): honest
      // "unavailable" — never a fabricated "no previous winner".
      setIntel(Object.fromEntries(ids.map((id) => [id, { status: "unavailable" as MatchIntelStatus, intel: null }])));
      return;
    }
    let cancelled = false;
    setIntel(Object.fromEntries(ids.map((id) => [id, { status: "loading" as MatchIntelStatus, intel: null }])));
    const ticket = intelTicket;
    for (const id of ids) {
      loadRadarIntel(() => getRadarMatchIntel({ data: { bidId: id, ticket } })).then((state) => {
        if (cancelled) return;
        setIntel((prev) => ({ ...prev, [id]: state }));
      });
    }
    return () => { cancelled = true; };
  }, [eligibleKey, intelTicket]);
  return intel;
}

export function RadarCard({
  match,
  certLabel,
  index,
  total,
  trade,
  state,
  cert,
  sizePref,
  intel,
}: {
  match: RadarMatch;
  certLabel: string;
  index: number;
  /** Lazy incumbent-intel state for THIS card (owner 09-16). Absent for cards
   *  that are not entitled to / not part of the lazy load (Related section,
   *  gated matches) — they keep the honest "not available" placeholder. */
  intel?: MatchIntelState;
  /** How many matches this card is part of (real count; anonymous visitors see
   *  min(total, FREE_ANONYMOUS_RADAR_RESULTS) up front). */
  total: number;
  trade: string;
  state: string;
  cert: RadarCertId | null;
  sizePref: SizeId | null;
}) {
  const due = match.due_date ? new Date(match.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
  // v6.2: the REAL place of performance + whether this card is in the
  // nationwide-eligibility bucket (never a location claim — see the tag below).
  // Owner 09-14: a national-scope location is never state-local — the card's
  // "nationalwide" eligibility tag must show even when the buyer/agency field
  // names the requested state. Same single source of truth as the bucketing that
  // put this card in the local/nationwide section (matchGeographyBucket), so the
  // tag, the section and the score can never disagree; the narrow
  // agency-jurisdiction rule (Ohio Phase 3) flows through it.
  const isStateLocal = matchGeographyBucket(state, match.location, match.agency) === "local";
  const place = displayPlaceOfPerformance(match.title, match.location, match.agency);
  const courierSubtype = isCourierFamilyNaics(match.naics_code) && !tradeExpresslyCourier(trade);
  const rawVal = (match.estimated_value || "").trim();
  const VALUE_PLACEHOLDER = /^(not specified|not available|n\/a|unknown|tbd|none|to be determined|available upon request|see solicitation)$/i;
  const value =
    match.estimated_value_num != null
      ? money(match.estimated_value_num)
      : rawVal && !VALUE_PLACEHOLDER.test(rawVal)
        ? rawVal
        : null;

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900" aria-label={`Match ${index} — ${match.title}`}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 bg-gradient-to-r from-amber-500/15 to-transparent px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">Match {index} of {total}</p>
          <p className={`mt-0.5 text-lg font-extrabold text-white ${match.score >= 80 ? "text-emerald-300" : match.score >= 65 ? "text-amber-300" : "text-blue-300"}`}>
            {match.score_label} — {match.score}%
          </p>
        </div>
        {match.days_remaining != null && (
          <div className="rounded-xl bg-slate-800 px-3 py-2 text-center">
            <p className="text-xl font-extrabold text-white">{match.days_remaining}</p>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">
              {match.days_remaining === 1 ? "day" : "days"} left
            </p>
          </div>
        )}
      </div>

      <div className="px-5 py-4">
        {/* Contrax Learning ⚡ memory (Professional+ only — server-gated, PAID-ONLY).
            One line + the real % from the user's own autopsied loss. */}
        {match.learned && (
          <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
            <p className="text-sm font-semibold text-amber-300">⚡ Contrax learned from your previous loss</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-100/90">
              This opportunity resembles the contract you lost in {match.learned.month}. Your previous bid was{" "}
              {match.learned.priceDiffPct.toFixed(1)}% {match.learned.direction} the winning price. Suggested action:{" "}
              {match.learned.direction === "above" ? "Review pricing before pursuing." : "Price was competitive — review scope and past performance."}
            </p>
          </div>
        )}
        <h3 className="text-base font-bold leading-snug text-white">{match.title || "Solicitation"}</h3>
        {match.agency && <p className="mt-0.5 text-sm text-slate-400">{match.agency}</p>}
        {/* v6.2: ACTUAL place of performance + eligibility tag — "nationalwide"
            is a separate ELIGIBILITY tag, never the location. State-local cards
            show their verified state. */}
        {(place || !isStateLocal) && (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {place ? (
              <span className="text-xs font-medium text-slate-300">📍 {place}</span>
            ) : (
              <span className="text-xs font-medium text-slate-500">Place of performance not specified — see solicitation</span>
            )}
            {!isStateLocal && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                nationalwide
              </span>
            )}
          </p>
        )}
        {courierSubtype && (
          <p className="mt-1.5">
            <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300">
              Related logistics — courier delivery
            </span>
          </p>
        )}
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-300">
          {value && <span>{value} estimated</span>}
          {value && <span aria-hidden="true">·</span>}
          {(match.set_aside_label ?? certLabel) && (
            <span>{match.set_aside_label ?? certLabel}</span>
          )}
          {due && (
            <>
              <span aria-hidden="true">·</span>
              <span>Due {due}</span>
            </>
          )}
        </p>

        {/* AI RFP Executive Summary — deep-link to the per-bid detail page that
            hosts RfpSummaryCard (logged-in users generate the brief there). */}
        <a
          href={`/bid/${match.id}`}
          onClick={() => trackEvent("radar_brief_cta", String(match.id))}
          className="mt-4 inline-flex w-full items-center justify-center gap-1 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-300 transition-colors hover:bg-amber-500/20"
        >
          ✦ Get the AI Executive Brief <span aria-hidden="true">→</span>
        </a>

        {/* Why the business qualifies */}
        {match.qualifications.length > 0 && (
          <RadarSection title="Why you qualify">
            <ul className="space-y-1.5">
              {match.qualifications.map((q, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-300">
                  <span className="text-emerald-400" aria-hidden="true">✓</span>
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          </RadarSection>
        )}

        {/* Why Contrax considers it a strong match */}
        {match.reasons.length > 0 && (
          <RadarSection title="Why this is a strong match">
            <ul className="space-y-1.5">
              {match.reasons.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-300">
                  <span className="text-amber-400" aria-hidden="true">→</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </RadarSection>
        )}

        {/* Previous winner + award price — SINGLE flagged code path */}
        <RadarSection title="Previous winner & award price">
          <IncumbentBlock
            match={match}
            intel={intel}
            trade={trade}
            state={state}
            cert={cert}
            sizePref={sizePref}
          />
        </RadarSection>

        {/* Important requirements */}
        <RadarSection title="Important requirements">
          {match.requirements.length > 0 ? (
            <ul className="space-y-1.5">
              {match.requirements.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-300">
                  <span className="text-blue-400" aria-hidden="true">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-300">
              Full requirements are listed in the original solicitation —{" "}
              <a
                href={radarSignupHref({ trade, state, cert, sizePref })}
                onClick={() => trackEvent("radar_requirements_cta", String(match.id))}
                className="font-semibold text-amber-400 hover:text-amber-300"
              >
                sign up free to analyze the complete document
              </a>
              .
            </p>
          )}
        </RadarSection>

        {/* Recommended next action */}
        <div className="mt-4 rounded-xl bg-slate-800 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recommended next action</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-200">{match.next_action}</p>
          {match.source_url && (
            <a
              href={match.source_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent("radar_source_click", String(match.id))}
              className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-amber-400 hover:text-amber-300"
            >
              Open original notice <span aria-hidden="true">↗</span>
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export function RadarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/** Single render path gated by SHOW_FREE_INCUMBENT (see ~/lib/radar-config.ts). */
function IncumbentBlock({
  match,
  intel,
  trade,
  state,
  cert,
  sizePref,
}: {
  match: RadarMatch;
  /** Lazy per-card intel state (owner 09-16); undefined ⇒ fall back to the
   *  (now always null) scan-payload field, preserving the honest placeholder. */
  intel?: MatchIntelState;
  trade: string;
  state: string;
  cert: RadarCertId | null;
  sizePref: SizeId | null;
}) {
  if (SHOW_FREE_INCUMBENT) {
    // OWNER 09-16: the scan ships NO incumbent data any more — each card loads
    // it lazily (useRadarIntel → getRadarMatchIntel). Four honest states; a card
    // is never a stuck spinner and never claims "no previous winner" when we
    // simply could not find out.
    const status: MatchIntelStatus = intel?.status ?? (match.incumbent ? "ok" : "none");
    const i = intel ? intel.intel : match.incumbent;
    if (status === "loading") {
      return (
        <p className="text-sm text-slate-400">Checking previous winner &amp; award price…</p>
      );
    }
    if (status === "unavailable") {
      return (
        <p className="text-sm text-slate-400">
          Previous winner &amp; award price unavailable right now — we couldn&rsquo;t reach the award database.
        </p>
      );
    }
    if (status === "ok" && i) {
      return (
        <div className="space-y-1.5">
          <p className="flex gap-2 text-sm text-slate-300">
            <span className="text-amber-400" aria-hidden="true">→</span>
            <span>Previous winner: <strong className="text-white">{i.incumbent_name}</strong></span>
          </p>
          <p className="flex gap-2 text-sm text-slate-300">
            <span className="text-amber-400" aria-hidden="true">→</span>
            <span>Prior award value: <strong className="text-white">{money(i.total_obligated)}</strong></span>
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Powered by FPDS / USASpending.gov</p>
        </div>
      );
    }
    // status "none" (upstream answered: no record for this notice), or an "ok"
    // state that carries no data — graceful placeholder, never fabricated.
    return (
      <p className="text-sm text-slate-400">
        Previous winner &amp; award price not available for this notice.
      </p>
    );
  }
  // DEFAULT (SHOW_FREE_INCUMBENT = false): teaser that preserves the
  // Professional+ paywall. No data is fetched; this line makes no factual claim
  // about this specific bid — it frames the feature behind a free account.
  return (
    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/60 px-4 py-3">
      <p className="text-sm text-slate-300">
        Previous winner + award price —{" "}
        <a
          href={radarSignupHref({ trade, state, cert, sizePref })}
          onClick={() => trackEvent("radar_incumbent_teaser_cta", String(match.id))}
          className="font-semibold text-amber-400 hover:text-amber-300"
        >
          unlock with your free account
        </a>
      </p>
      <p className="mt-1 text-[11px] text-slate-500">
        Incumbent Intelligence &amp; past pricing are included with a free account
        and full contract history on Professional.
      </p>
    </div>
  );
}

/**
 * RADAR CONVERSION SPRINT PR1 (owner 2026-09-07) — ANONYMOUS RESULTS GATING.
 *
 * THREE rendering modes, driven by the real server-computed match count:
 *
 *   TOTAL  = scan.matches.length (real total, as produced today)
 *   VIS    = min(TOTAL, FREE_ANONYMOUS_RADAR_RESULTS)
 *   LOCKED = max(TOTAL − FREE_ANONYMOUS_RADAR_RESULTS, 0)
 *
 *   TOTAL ≤ FREE   → show ALL matches, NO locked card, NEVER "X more matches"
 *                    (no manufactured wall).
 *   TOTAL > FREE   → show the first FREE matches (full cards), then one honest
 *                    locked-results card with REAL numbers + "Unlock My N
 *                    Matches →" CTA routed to the EXISTING /signup for PR1
 *                    (PR2 adds the server/session restore — this href already
 *                    carries criteria + `?source=radar`, the hook point).
 *   TOTAL = 0      → "No strong matches yet." + Adjust Radar + email capture.
 *
 * Authenticated users of ANY tier NEVER see the anonymous gating (only
 * anonymous visitors get it). Events fire once per completed scan, guarded by
 * the app's existing dedupe approach (the intake server also collapses
 * same-event+visitor+path within 1s):
 *   radar_results_viewed        — first anonymous results render after a scan
 *   radar_results_unlock_shown  — ONLY when the locked card actually renders
 *   radar_results_unlock_clicked— CTA click
 * (owner 09-09, additive): the ≤3-match results CTA fires its OWN two events —
 * radar_results_cta_shown / radar_results_cta_clicked — see RadarResultsCta
 * below. Neither is part of the frozen 9-stage funnel map.
 */
export function SignupGate({
  certLabel,
  totalFound,
  trade,
  state,
  cert,
  sizePref,
}: {
  certLabel: string;
  totalFound: number;
  trade: string;
  state: string;
  cert: RadarCertId | null;
  sizePref: SizeId | null;
}) {
  const [showExtra, setShowExtra] = useState(false);
  // Funnel: fire exactly once when the gate is shown (a shown gate IS a real
  // locked-card display — the old `radar_signup_gate_shown` name is kept so the
  // historical funnel is not re-labeled; the new name is additive).
  useEffect(() => {
    trackEvent("radar_signup_gate_shown", certLabel);
    if (totalFound > FREE_ANONYMOUS_RADAR_RESULTS) trackEvent("radar_results_unlock_shown", certLabel);
  }, [certLabel, totalFound]);
  // R2: the gate CTA carries the visitor's radar criteria + the post-signup
  // brief return path (`next=/dashboard?brief=1`) so completing signup lands
  // directly on the "Run my first Executive Brief" moment.
  const ctaHref = radarSignupHref({ trade, state, cert, sizePref }, { unlock: true });
  const locked = Math.max(totalFound - FREE_ANONYMOUS_RADAR_RESULTS, 0);
  // Never render a wall for ≤3 real matches. (The component lifecycle already
  // gates the caller, but this stays as a second guard against the impossible.)
  if (totalFound <= FREE_ANONYMOUS_RADAR_RESULTS) return null;
  return (
    <div className="mt-5 rounded-2xl border border-amber-500/40 bg-slate-900 p-5 text-center ring-1 ring-slate-800">
      <p className="text-sm font-semibold uppercase tracking-wide text-amber-400">
        We found {totalFound} opportunities for your business.
      </p>
      <h3 className="mt-1.5 text-lg font-bold text-white">
        You can see {FREE_ANONYMOUS_RADAR_RESULTS} now.
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-300">
        🔒 {locked} more matching {locked === 1 ? "opportunity" : "opportunities"}
      </p>
      <button
        type="button"
        onClick={() => setShowExtra(true)}
        className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-slate-400 hover:text-slate-200"
      >
        What&apos;s included? <span aria-hidden="true">▾</span>
      </button>
      {showExtra && (
        <ul className="mx-auto mt-2 max-w-sm space-y-1.5 text-left text-sm text-slate-300">
          <li className="flex gap-2"><span className="text-emerald-400">✓</span>All {totalFound} matching opportunities</li>
          <li className="flex gap-2"><span className="text-emerald-400">✓</span>Save this Radar and keep tracking it</li>
          <li className="flex gap-2"><span className="text-emerald-400">✓</span>Deadline alerts when new opportunities close</li>
        </ul>
      )}
      <a
        href={ctaHref}
        onClick={() => trackEvent("radar_results_unlock_clicked", certLabel)}
        className="mt-5 block w-full rounded-xl bg-amber-500 px-6 py-4 text-base font-bold text-slate-950 transition-all hover:bg-amber-400 active:scale-[0.98]"
      >
        {locked > 0 ? `Unlock My ${locked} Matches →` : `Create my free account →`}
      </a>
      <p className="mt-3 text-xs leading-relaxed text-slate-400">
        Free account · No credit card required. Save this Radar, see all{" "}
        {totalFound}, and continue tracking opportunities.
      </p>
    </div>
  );
}

/**
 * Owner 09-09 — the ONE authorized exception to the frozen Radar Conversion
 * experiment: an anonymous signup CTA below the results list for visitors whose
 * REAL match count is 1..=FREE_ANONYMOUS_RADAR_RESULTS (they see ALL matches —
 * no manufactured wall — but had no signup prompt at all). Additive ONLY:
 *   - shown to anonymous visitors exactly when 1 <= totalFound <= 3; never for
 *     authenticated users (the caller only renders in the anonymous block),
 *     never for totalFound = 0, never for totalFound > 3 (those keep the
 *     locked card — unchanged).
 *   - two NEW events, NOT added to the frozen 9-stage funnel map:
 *       radar_results_cta_shown    — first render of the CTA (ref-guard)
 *       radar_results_cta_clicked  — CTA click (ref-guard)
 *   - click mints the SAME PR2 signed handoff cookie via
 *     mintRadarResultsCtaHandoff (which reuses signRadarHandoff exactly — no
 *     second mechanism), then navigates to the signup href with the new
 *     source=radar_results_cta — which /signup handles IDENTICALLY to
 *     source=radar_results_unlock (restore criteria + re-resolve matches +
 *     identity backfill attributes the anonymous journey).
 */
export function RadarResultsCta({
  certLabel,
  totalFound,
  trade,
  state,
  cert,
  sizePref,
}: {
  certLabel: string;
  totalFound: number;
  trade: string;
  state: string;
  cert: RadarCertId | null;
  sizePref: SizeId | null;
}) {
  const shownRef = useRef(false);
  const clickedRef = useRef(false);
  const ctaHref = radarSignupHref({ trade, state, cert, sizePref }, { cta: true });
  // Exactly-once impression (mirrors the results_viewed ref-guard pattern; the
  // intake server also collapses same-event+visitor+path within 1s).
  useEffect(() => {
    if (shownRef.current) return;
    if (totalFound < 1 || totalFound > FREE_ANONYMOUS_RADAR_RESULTS) return;
    shownRef.current = true;
    trackEvent("radar_results_cta_shown", certLabel);
  }, [certLabel, totalFound]);
  // Second guard against the impossible (caller already ensures it): this CTA
  // never renders outside the 1..=3 real-match anonymous window.
  if (totalFound < 1 || totalFound > FREE_ANONYMOUS_RADAR_RESULTS) return null;
  const handleClick = () => {
    if (clickedRef.current) return;
    clickedRef.current = true;
    trackEvent("radar_results_cta_clicked", certLabel);
    // Mint the SAME PR2 signed handoff cookie (helper + payload shape + cookie
    // name + setCookie options reused exactly; m=[] — nothing is locked on a
    // ≤3 scan, so /signup's restore falls back to all the matches the visitor
    // saw). Fail-open: a mint failure still navigates — the href carries the
    // criteria in the URL, so /signup recovers via its normal source=radar path.
    mintRadarResultsCtaHandoff({ data: { trade, state, cert: cert || "sb", sizePref: sizePref || "any" } })
      .catch(() => ({ minted: false }))
      .finally(() => {
        window.location.assign(ctaHref);
      });
  };
  return (
    <div className="mt-5 rounded-2xl border border-amber-500/40 bg-slate-900 p-5 text-center ring-1 ring-slate-800">
      <p className="text-sm font-semibold uppercase tracking-wide text-amber-400">
        Found {totalFound} matching {totalFound === 1 ? "opportunity" : "opportunities"} for your business.
      </p>
      <button
        type="button"
        onClick={handleClick}
        className="mt-4 block w-full rounded-xl bg-amber-500 px-6 py-4 text-base font-bold text-slate-950 transition-all hover:bg-amber-400 active:scale-[0.98]"
      >
        Create your free account
      </button>
      <p className="mt-3 text-xs leading-relaxed text-slate-400">
        Save these matches and unlock full opportunity details.
      </p>
    </div>
  );
}

/**
 * Helper: true when REAL matches exceed the anonymous free cap — the only
 * condition under which the locked-results card may be shown (never a
 * manufactured wall). Every consumer computes TOTAL from the real
 * server-computed `matches.length`.
 */
export function hasLockedMatches(totalFound: number): boolean {
  return totalFound > FREE_ANONYMOUS_RADAR_RESULTS;
}

/**
 * "Save your matches" — anonymous email opt-in (option A, owner-approved).
 *
 * Shown ONLY to anonymous visitors (never signed-in) AFTER they've engaged the
 * free radar matches. Low-friction: just an email (phone optional), no account.
 * Submitting creates a REAL row in `radar_saves` (unique on email, ON CONFLICT
 * update) storing the visitor's radar criteria so that when they create an
 * account with the same email, their saved matches are surfaced IN-APP on the
 * dashboard (never emailed to them). Honest copy — no bait-and-switch, no
 * false promise of email delivery. Fires the `radar_save` funnel event on
 * success so we can measure this capture against the FB drop-off.
 */
export function SaveMatchesCard({
  certLabel,
  trade,
  state,
  cert,
  sizePref,
  matchedCount,
}: {
  certLabel: string;
  trade: string;
  state: string;
  cert: string;
  sizePref: string;
  matchedCount: number;
}) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState("");

  if (dismissed) return null;

  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      setError("Please enter a valid email address.");
      setStatus("error");
      return;
    }
    setError("");
    setStatus("submitting");
    const ids = trackingIds();
    try {
      const res = await fetch("/api/radar-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalized,
          phone: phone.trim() || undefined,
          trade: trade || undefined,
          state: state || undefined,
          cert: cert || undefined,
          sizePref: sizePref || undefined,
          matchedCount,
          visitor_id: ids.visitor_id || undefined,
          visit_id: ids.visit_id || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as { success?: boolean } | null;
      if (!res.ok || !data?.success) {
        setStatus("error");
        setError("Something went wrong. Please try again.");
        return;
      }
      trackEvent("radar_save", certLabel);
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  };

  if (status === "done") {
    return (
      <div className="mt-6 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-center">
        <p className="text-base font-bold text-emerald-300">You&apos;re in ✓</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-300">
          Saved. When you sign in with this email, we&apos;ll show you the bids matching
          your saved search on your dashboard.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Save your matches"
      className="mt-6 rounded-2xl border border-slate-700 bg-slate-900 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-white">Save your matches</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">
            Leave your email — when you create a free account with it, these
            matches and deadline alerts are waiting in your dashboard.
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="-mt-0.5 px-1 text-slate-500 transition-colors hover:text-slate-200"
        >
          ✕
        </button>
      </div>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <div>
          <label htmlFor="radar-save-email" className="sr-only">
            Email address
          </label>
          <input
            id="radar-save-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-400"
          />
        </div>
        <div>
          <label htmlFor="radar-save-phone" className="sr-only">
            Phone (optional)
          </label>
          <input
            id="radar-save-phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone (optional)"
            className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-400"
          />
        </div>
        {status === "error" && error && (
          <p className="text-sm font-medium text-red-400" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={status === "submitting"}
          className="w-full rounded-xl bg-amber-500 px-6 py-3 text-base font-bold text-slate-950 transition-all hover:bg-amber-400 active:scale-[0.98] disabled:opacity-60"
        >
          {status === "submitting" ? "Saving…" : "Save my matches →"}
        </button>
      </form>
    </section>
  );
}

/**
 * "Want new matches when we find them?" — anonymous Radar match-alert capture
 * (owner's "feature I particularly want", 2026-09-06).
 *
 * Shown ONLY to anonymous visitors (never signed-in — they have accounts, out
 * of scope) AFTER a COMPLETED Radar scan (revealed >= 1; the owner framing is
 * post-scan, not mid-scan). A voluntary email — NO account required — opts the
 * visitor into FUTURE match-alert emails:
 *
 *   - explicit consent is given by submitting (the microcopy promises "We'll
 *     email you matching opportunities — unsubscribe anytime"),
 *   - on submit the visitor sees "You're on the list — check your inbox to
 *     confirm." — we do NOT send matches yet, only the ONE confirmation email
 *     (deliverability + real-address verification),
 *   - the endpoint is idempotent (no double confirmation, no resurrection of
 *     an unsubscribed address) and fail-open (email-send failure never blocks
 *     the capture or the Radar UX),
 *   - the same token powers the confirmation link AND the honest one-click
 *     unsubscribe the microcopy promises.
 *
 * This is the foundation for the queued abandoned-signup recovery email and
 * the periodic match-alert sender.
 */
export function MatchAlertsCard({
  certLabel,
  trade,
  state,
  cert,
  sizePref,
}: {
  certLabel: string;
  trade: string;
  state: string;
  cert: string;
  sizePref: string;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState("");

  if (dismissed) return null;

  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized) || normalized.length > 254) {
      setError("Please enter a valid email address.");
      setStatus("error");
      return;
    }
    setError("");
    setStatus("submitting");
    const ids = trackingIds();
    try {
      const res = await fetch("/api/radar/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalized,
          trade: trade || undefined,
          state: state || undefined,
          cert: cert || undefined,
          sizePref: sizePref || undefined,
          visitor_id: ids.visitor_id || undefined,
          visit_id: ids.visit_id || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as { success?: boolean; status?: string } | null;
      if (!res.ok || !data?.success) {
        setStatus("error");
        setError("Something went wrong. Please try again.");
        return;
      }
      // Funnel event — measured against the anonymous-bounce drop-off. The
      // display label lives in tracking-intake EVENT_LABELS.
      trackEvent("radar_lead_captured", certLabel);
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  };

  if (status === "done") {
    return (
      <div className="mt-6 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-center">
        <p className="text-base font-bold text-emerald-300">You&apos;re on the list ✓</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-300">
          Check your inbox to confirm. No account required — and you can
          unsubscribe anytime with one click.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Get match alerts"
      className="mt-6 rounded-2xl border border-slate-700 bg-slate-900 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-white">Want new matches by email instead?</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">
            Leave your email and we&apos;ll send you matching opportunities as
            they open. No account required.
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="-mt-0.5 px-1 text-slate-500 transition-colors hover:text-slate-200"
        >
          ✕
        </button>
      </div>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <div>
          <label htmlFor="radar-lead-email" className="sr-only">
            Email address
          </label>
          <input
            id="radar-lead-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-400"
          />
        </div>
        <p className="text-xs leading-relaxed text-slate-500">
          No account required. We&apos;ll email you matching opportunities —
          unsubscribe anytime.
        </p>
        {status === "error" && error && (
          <p className="text-sm font-medium text-red-400" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={status === "submitting"}
          className="w-full rounded-xl bg-amber-500 px-6 py-3 text-base font-bold text-slate-950 transition-all hover:bg-amber-400 active:scale-[0.98] disabled:opacity-60"
        >
          {status === "submitting" ? "Sending…" : "Send My Matches →"}
        </button>
      </form>
    </section>
  );
}
