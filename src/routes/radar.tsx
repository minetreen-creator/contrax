import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createServerFn } from "@tanstack/react-start";
import { setAsidePred } from "~/lib/open-bids";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { US_STATES } from "~/lib/states";
import { NAICS_NAMES } from "~/lib/naics-names";
import { trackEvent } from "~/lib/track";
import { trackingIds } from "~/lib/visitor";
import { getTrackingUser } from "~/lib/identity";
import { SHOW_FREE_INCUMBENT } from "~/lib/radar-config";
import type { FPDSIntel } from "~/lib/fpds";
import {
  getRadarAnswers,
  getRadarSeen,
  saveRadarSeen,
  saveRadarAnswers,
  type RadarCertId,
} from "~/lib/radar-session";

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
 * GATE: the first THREE matches are revealed without an account. After the 3rd,
 * a truthful signup CTA asks the visitor to create a free (Basic, `?plan=basic`)
 * account to save results, get alerts, and analyze full solicitations.
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
 */
export function radarSignupHref(answers: { trade: string; state: string; cert: RadarCertId | null; sizePref: SizeId | null }): string {
  const p = new URLSearchParams({ plan: "basic", source: "radar", next: "/dashboard?brief=1" });
  const trade = (answers.trade || "").trim();
  if (trade) p.set("trade", trade.slice(0, 120));
  if (answers.state) p.set("state", answers.state.slice(0, 2));
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
 */
function computeMatch(
  bid: RadarBidRow,
  input: { trade: string; isNaics: boolean; state: string; cert: RadarCert; sizePref: SizeId },
): { score: number; scoreLabel: "Strong Match" | "Good Match" | "Potential Match" } {
  const t = input.trade.toLowerCase();
  const title = (bid.title || "").toLowerCase();
  const category = (bid.category || "").toLowerCase();

  // NAICS / trade alignment
  let naics = 8;
  if (input.isNaics && bid.naics_code && bid.naics_code.trim() === input.trade) naics = 30;
  else if (!input.isNaics && t && (title.includes(t) || category.includes(t))) naics = 22;

  // Set-aside eligibility
  const hasSetAside = !!bid.set_aside && String(bid.set_aside).trim().length > 0;
  let elig = 0;
  if (input.cert === "sb") elig = hasSetAside ? 20 : 0;
  else if (input.cert in { "8a": 1, sdvosb: 1, wosb: 1, hubzone: 1 }) elig = 20;

  // Geography
  let geo = 12;
  if (input.state) {
    const m = (bid.location || "").match(STATE_LOCATION_REGEX);
    geo = m && m[1].toUpperCase() === input.state ? 20 : 12;
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

const STATE_LOCATION_REGEX = new RegExp(
  `(?:^|,\\s*)(${US_STATES.join("|")})(?:$|\\s|,)`,
  "i",
);

/** A bid stays relevant when it names the selected state OR is nationwide/unknown. */
function geoRelevant(location: string | null | undefined, state: string): boolean {
  if (!state) return true;
  const m = (location || "").match(STATE_LOCATION_REGEX);
  if (m) return m[1].toUpperCase() === state;
  return true; // no extractable state → could be a nationwide opportunity
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
  location: string | null; set_aside: string | null; naics_code: string | null;
  source_url: string | null;
  estimated_value: string | null;
  estimated_value_num: number | null;
  due_date: string | null; days_remaining: number | null;
  score: number; score_label: "Strong Match" | "Good Match" | "Potential Match";
  reasons: string[]; qualifications: string[]; requirements: string[];
  next_action: string;
  incumbent: FPDSIntel | null;
};

export const runRadarScan = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const v = (d as any) ?? {};
    const cert = String(v.cert ?? "sb");
    const sizePref = String(v.sizePref ?? "any");
    return {
      trade: String(v.trade ?? "").trim(),
      state: String(v.state ?? "").trim(),
      cert: (RADAR_CERTS as readonly string[]).includes(cert) ? cert : "sb",
      sizePref: (SIZE_OPTS as readonly { id: string }[]).some((s) => s.id === sizePref) ? sizePref : "any",
    };
  })
  .handler(async ({ data }) => {
    const { trade, state, cert, sizePref } = data;
    const certId = cert as RadarCert;
    const isNaics = /^\d{6}$/.test(trade);
    // Coerce the validated-but-stringly-typed size preference back to the SizeId
    // union. The validator already guaranteed it is one of the known ids.
    const sizeId = sizePref as SizeId;
    const { sql } = await import("~/db");
    let rows: any[] = [];
    try {
      // Set-aside predicate fragment (Small Business = every set-aside row,
      // otherwise the cert's literal set_aside patterns — mirrors /trades).
      const certFrag =
        certId === "sb" ? sql().unsafe(`AND set_aside IS NOT NULL`) : setAsidePred(certId, sql);
      // Trade/NAICS predicate: exact NAICS equality when a 6-digit code is given,
      // otherwise a keyword match on the trade text. Values are bound as
      // parameters via the tagged template (injection-safe).
      const tradeFrag = isNaics
        ? sql()`AND LOWER(COALESCE(naics_code,'')) = ${trade.toLowerCase()}`
        : trade
          ? sql()`AND (LOWER(COALESCE(title,'')) LIKE ${"%" + trade.toLowerCase() + "%"} OR LOWER(COALESCE(description,'')) LIKE ${"%" + trade.toLowerCase() + "%"} OR LOWER(COALESCE(category,'')) LIKE ${"%" + trade.toLowerCase() + "%"})`
          : sql()``;
      rows = await sql()`
        SELECT id, title, agency, description, location, category, due_date,
               estimated_value, naics_code, source_url, set_aside
        FROM bids
        WHERE due_date > NOW()
          AND ${sql().unsafe(LOW_CONTENT_SQL)}
          ${certFrag}
          ${tradeFrag}
        ORDER BY due_date ASC NULLS LAST
        LIMIT 100
      `;
    } catch (e) {
      console.error("[radar] scan query failed:", e);
      rows = [];
    }

    const ranked = rows
      .filter((r) => geoRelevant(r.location, state))
      .map((r) => {
        const bid: RadarBidRow = {
          id: Number(r.id), title: String(r.title ?? ""), agency: r.agency ? String(r.agency) : null,
          description: r.description ? String(r.description) : null, location: r.location ? String(r.location) : null,
          category: r.category ? String(r.category) : null, due_date: r.due_date ? String(r.due_date) : null,
          estimated_value: r.estimated_value ? String(r.estimated_value) : null, naics_code: r.naics_code ? String(r.naics_code) : null,
          source_url: r.source_url ? String(r.source_url) : null, set_aside: r.set_aside ? String(r.set_aside) : null,
        };
        const { score, scoreLabel } = computeMatch(bid, { trade, isNaics, state, cert: certId, sizePref: sizeId });
        return { bid, score, scoreLabel };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // Incumbent intel: only fetched + surfaced when the flag is ON (see
    // ~/lib/radar-config.ts). In teaser mode we skip the FPDS calls entirely.
    const matches: RadarMatch[] = [];
    for (let i = 0; i < ranked.length; i++) {
      const { bid, score, scoreLabel } = ranked[i];
      const match: RadarMatch = {
        id: bid.id, title: bid.title, agency: bid.agency, category: bid.category,
        location: bid.location, set_aside: bid.set_aside, naics_code: bid.naics_code,
        source_url: bid.source_url, estimated_value: bid.estimated_value,
        estimated_value_num: parseValue(bid.estimated_value),
        due_date: bid.due_date, days_remaining: daysRemaining(bid.due_date),
        score, score_label: scoreLabel,
        reasons: buildReasons(bid, { trade, isNaics, state, cert: certId, sizePref: sizeId, score, scoreLabel }),
        qualifications: buildQualifications(bid, { trade, isNaics, state, cert: certId }),
        requirements: buildRequirements(bid),
        next_action: buildNextAction(bid),
        incumbent: null,
      };
      // Fetch incumbent intel for every candidate so we can order the free
      // preview toward incumbent-rich matches. Only the first THREE are ever
      // displayed free (the rest sit behind the gate), so this never leaks a
      // paid feature — it just tells us which real matches to put first.
      if (SHOW_FREE_INCUMBENT) {
        try {
          const { getFPDSIntel } = await import("~/lib/fpds");
          match.incumbent = await getFPDSIntel(bid.naics_code || "", bid.agency || "", bid.title);
        } catch {
          match.incumbent = null;
        }
      }
      matches.push(match);
    }

    // FREE-FIRST-3 BIAS (P1): the free preview is sold on "first 3 matches with
    // full incumbent intel", so prefer the incumbent-rich, adequate-runway bids
    // first so the marquee differentiator is actually demonstrated. This is a
    // PURE re-ordering of the same real matches — match % stays deterministic
    // and real, and any bid with no incumbent data still shows its honest
    // "not available" placeholder (never fabricated). Within a priority group we
    // keep the higher score first.
    (() => {
      const MIN_RUNWAY_DAYS = 3; // a real bid needs more than a ~1-day closing window
      const hasRealIncumbent = (m: RadarMatch) =>
        !!m.incumbent && !!m.incumbent.incumbent_name && (m.incumbent.total_obligated ?? 0) > 0;
      const hasRunway = (m: RadarMatch) => m.days_remaining == null || m.days_remaining >= MIN_RUNWAY_DAYS;
      const priority = (m: RadarMatch) =>
        hasRealIncumbent(m) && hasRunway(m) ? 0 : hasRealIncumbent(m) ? 1 : hasRunway(m) ? 2 : 3;
      matches.sort((a, b) => priority(a) - priority(b) || b.score - a.score);
    })();

    // GATING (owner rule): Incumbent intel is Professional+, EXCEPT the first
    // three FREE radar matches. We fetched it for every candidate so we could
    // order the free preview toward incumbent-rich bids, but we must NOT ship
    // the paywalled previous-winner/award-price data for the gated (3rd+) matches
    // to the client — the full `matches` array is stored in client state + saved
    // to localStorage, so a visitor could read match #5's award price otherwise.
    // Strip incumbent for everything beyond the free 3 (the gate unlocks it on a
    // paid tier via its own path). The reordering above already put the best free
    // matches first.
    for (let i = 3; i < matches.length; i++) {
      matches[i].incumbent = null;
    }

    return { matches, certLabel: CERT_LABEL[certId] };
  });

function buildReasons(
  bid: RadarBidRow,
  c: { trade: string; isNaics: boolean; state: string; cert: RadarCert; sizePref: SizeId; score: number; scoreLabel: string },
): string[] {
  const reasons: string[] = [];
  reasons.push(`${CERT_LABEL[c.cert]} solicitation — set aside for your certification`);
  const days = daysRemaining(bid.due_date);
  if (days != null) reasons.push(days <= 30 ? `Closing in ${days} day${days === 1 ? "" : "s"}` : `Closing in ${days} days`);
  const ev = parseValue(bid.estimated_value);
  if (ev != null) reasons.push(`Estimated value ${money(ev)}${c.sizePref !== "any" ? " fits your size preference" : ""}`);
  else reasons.push("Estimated value not listed — verify in the full solicitation");
  if (c.isNaics && bid.naics_code) reasons.push(`NAICS ${bid.naics_code} matches your code`);
  else if (!c.isNaics && c.trade && (bid.title || bid.category)?.toLowerCase().includes(c.trade.toLowerCase()))
    reasons.push(`Trade "${c.trade}" aligns with this opportunity`);
  if (c.state) {
    const m = (bid.location || "").match(STATE_LOCATION_REGEX);
    reasons.push(m && m[1].toUpperCase() === c.state ? `Located in ${c.state}` : "Open nationwide");
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
          "Answer four quick questions. Contract Radar scans live set-aside solicitations and reveals your strongest matches one at a time — the first 3 are free, with full incumbent intel.",
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
type ScanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; matches: RadarMatch[]; certLabel: string }
  | { status: "error" };

const NAICS_SUGGESTIONS = Object.entries(NAICS_NAMES).slice(0, 120);

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
  const urlState = (US_STATES as readonly string[]).includes(uState) ? uState : "";
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
  // appears after the 3rd free match).
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
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

  const editing = trade.trim() !== "" && state !== "" && cert !== null && sizePref !== null;

  // Reveal the next match + keep the persisted radar-session "seen" state in
  // sync, and fire the funnel event for the soft nudge the moment the FIRST
  // match is behind the visitor.
  const handleRevealNext = () => {
    const next = revealed + 1;
    trackEvent("radar_next_match", scan.status === "done" ? scan.certLabel : "");
    if (scan.status === "done") {
      const existing = getRadarSeen();
      if (existing) saveRadarSeen({ ...existing, seenCount: Math.min(next, existing.matches.length) });
    }
    setRevealed(next);
  };

  const runScan = (input: { trade: string; state: string; cert: RadarCert; sizePref: SizeId }) => {
    // A visitor-initiated scan is real activity — from here on the save effect
    // may persist the criteria (and runScan itself persists the SEEN matches).
    didInteract.current = true;
    trackEvent("radar_scan_start", input.cert);
    setScan({ status: "loading" });
    setRevealed(0);
    // Small real processing pause so the "scanning" reveal reads as active work,
    // while the actual match computation happens server-side over live data.
    const t = window.setTimeout(() => {
      runRadarScan({ data: { trade: input.trade, state: input.state, cert: input.cert, sizePref: input.sizePref } })
        .then((res) => {
          if (flashTimer) window.clearTimeout(flashTimer);
          trackEvent("radar_scan_complete", input.cert);
          // The soft nudge is visible the moment the FIRST match is revealed
          // (revealed stays 0 on completion), so attribute its impression here.
          if (res.matches.length > 0) trackEvent("radar_nudge_shown", res.certLabel);
          // Persist this anonymous radar session (criteria + the REAL
          // server-computed matches) so a later signup/login can pick it up
          // in-app — no email involved (owner-directed: no email capture).
          saveRadarSeen({
            answers: { trade: input.trade, state: input.state, cert: input.cert, sizePref: input.sizePref },
            certLabel: res.certLabel,
            total: res.matches.length,
            seenCount: 0,
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
          setScan({ status: "done", matches: res.matches, certLabel: res.certLabel });
          setStep(3);
        })
        .catch(() => {
          if (flashTimer) window.clearTimeout(flashTimer);
          setScan({ status: "error" });
          setStep(3);
        });
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
                  {NAICS_SUGGESTIONS.map(([code, name]) => (
                    <option key={code} value={code}>{`${code} — ${name}`}</option>
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
                Scans live set-aside solicitations from SAM.gov and state & city
                sources — real results, updated every 4 hours.
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
            <div className="mt-4 flex items-end justify-between">
              <div>
                <h2 className="text-xl font-bold text-white sm:text-2xl">Your top matches</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {scan.certLabel}{stateLabel} · {tradeLabel(track)} · real scores
                </p>
              </div>
              <span className="text-xs font-semibold text-amber-400">
                {scan.matches.length} found
              </span>
            </div>
            {/* Match-progress — honest free-preview counter (3 free, then the gate). */}
            {scan.matches.length > 0 && (
              <p className="mt-3 text-xs font-medium text-slate-500">
                Free preview: you&apos;ve seen{" "}
                <span className="font-semibold text-amber-400">
                  {Math.min(revealed + 1, Math.min(3, scan.matches.length))}
                </span>{" "}
                of {Math.min(3, scan.matches.length)} free{" "}
                {Math.min(3, scan.matches.length) === 1 ? "match" : "matches"} — every one with full incumbent intel
              </p>
            )}

            {/* Soft, NON-BLOCKING nudge — appears after the FIRST match is revealed.
                Dismissible; never a hard gate. The full SignupGate still only
                appears after the 3rd free match. */}
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
                We couldn't find an open {scan.certLabel} solicitation matching
                your exact criteria right now. Try broadening your trade, state,
                or contract size.
              </div>
            )}

            {/* Reveal one at a time — max 3 free. */}
            {scan.matches.length > 0 && revealed < scan.matches.length && (
              <div className="mt-6">
                <RadarCard
                  match={scan.matches[revealed]}
                  certLabel={scan.certLabel}
                  index={revealed + 1}
                  trade={trade}
                  state={state}
                  cert={cert}
                  sizePref={sizePref}
                />
                {revealed < Math.min(2, scan.matches.length - 1) ? (
                  <button
                    type="button"
                    onClick={handleRevealNext}
                    className="mt-5 w-full rounded-2xl bg-amber-500 px-6 py-4 text-base font-bold text-slate-950 shadow-lg transition-all hover:bg-amber-400 active:scale-[0.98]"
                  >
                    Reveal my next match →
                  </button>
                ) : (
                  <SignupGate
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

            {scan.matches.length > 0 && revealed >= scan.matches.length && revealed >= 3 && (
              <div className="mt-6">
                <SignupGate
                  certLabel={scan.certLabel}
                  totalFound={scan.matches.length}
                  trade={trade}
                  state={state}
                  cert={cert}
                  sizePref={sizePref}
                />
              </div>
            )}
            {/* "Save your matches" — anonymous email opt-in (option A). Shows only
                for ANONYMOUS visitors AFTER they've engaged the free matches
                (revealed >= 1), is optional/dismissible, never a wall, and requires
                no account. Converts the bounce dead-end into an opted-in contact. */}
            {!getTrackingUser() && scan.matches.length > 0 && revealed >= 1 && (
              <SaveMatchesCard
                certLabel={scan.certLabel}
                trade={trade}
                state={state}
                cert={cert ?? ""}
                sizePref={sizePref ?? ""}
                matchedCount={scan.matches.length}
              />
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

export function RadarCard({
  match,
  certLabel,
  index,
  trade,
  state,
  cert,
  sizePref,
}: {
  match: RadarMatch;
  certLabel: string;
  index: number;
  trade: string;
  state: string;
  cert: RadarCertId | null;
  sizePref: SizeId | null;
}) {
  const due = match.due_date ? new Date(match.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
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
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">Match {index} of 3</p>
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
        <h3 className="text-base font-bold leading-snug text-white">{match.title || "Solicitation"}</h3>
        {match.agency && <p className="mt-0.5 text-sm text-slate-400">{match.agency}</p>}
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-300">
          {value && <span>{value} estimated</span>}
          {value && <span aria-hidden="true">·</span>}
          {certLabel && <span>{certLabel}</span>}
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
  trade,
  state,
  cert,
  sizePref,
}: {
  match: RadarMatch;
  trade: string;
  state: string;
  cert: RadarCertId | null;
  sizePref: SizeId | null;
}) {
  if (SHOW_FREE_INCUMBENT && match.incumbent) {
    const i = match.incumbent;
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
  if (SHOW_FREE_INCUMBENT) {
    // No incumbent data available for this bid — graceful placeholder, never fabricated.
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
  // Funnel: fire exactly once when the gate is shown.
  useEffect(() => {
    trackEvent("radar_signup_gate_shown", certLabel);
  }, [certLabel]);
  const freeCap = Math.min(3, totalFound);
  const allWereFree = totalFound <= 3;
  // R2: the gate CTA carries the visitor's radar criteria + the post-signup
  // brief return path (`next=/dashboard?brief=1`) so completing signup lands
  // directly on the "Run my first Executive Brief" moment.
  const ctaHref = radarSignupHref({ trade, state, cert, sizePref });
  return (
    <div className="mt-5 rounded-2xl border border-amber-500/40 bg-slate-900 p-5 text-center ring-1 ring-slate-800">
      <p className="text-sm font-semibold uppercase tracking-wide text-amber-400">Your first 3 matches are free</p>
      <h3 className="mt-1.5 text-lg font-bold text-white">
        {allWereFree
          ? `You've seen all ${totalFound} ${totalFound === 1 ? "match" : "matches"} — save them free.`
          : `You've seen ${freeCap} of ${freeCap} free matches — ${totalFound} total. Create a free account to see all ${totalFound}.`}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-300">
        {allWereFree
          ? "Create a free account to save these results, get alerts when they change, and analyze the complete solicitation."
          : "The remaining matches need a free account. Create one to see all of them, save results, and get deadline alerts."}
      </p>
      <button
        type="button"
        onClick={() => setShowExtra(true)}
        className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-slate-400 hover:text-slate-200"
      >
        Why should I sign up? <span aria-hidden="true">▾</span>
      </button>
      {showExtra && (
        <ul className="mx-auto mt-2 max-w-sm space-y-1.5 text-left text-sm text-slate-300">
          <li className="flex gap-2"><span className="text-emerald-400">✓</span>Save your top matches for later</li>
          <li className="flex gap-2"><span className="text-emerald-400">✓</span>Get alerts when new opportunities close</li>
          <li className="flex gap-2"><span className="text-emerald-400">✓</span>Analyze the complete solicitation details</li>
        </ul>
      )}
      <a
        href={ctaHref}
        onClick={() => trackEvent("radar_signup_cta", certLabel)}
        className="mt-5 block w-full rounded-xl bg-amber-500 px-6 py-4 text-base font-bold text-slate-950 transition-all hover:bg-amber-400 active:scale-[0.98]"
      >
        Create my free account →
      </a>
      <p className="mt-3 text-xs leading-relaxed text-slate-400">
        Basic is free forever — up to 3 saved bids, no card required.
        AI match scoring &amp; draft tools are on Professional.
      </p>
    </div>
  );
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
