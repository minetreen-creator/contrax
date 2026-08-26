import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createServerFn } from "@tanstack/react-start";
import { setAsidePred } from "~/lib/open-bids";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { US_STATES } from "~/lib/states";
import { NAICS_NAMES } from "~/lib/naics-names";
import { trackEvent } from "~/lib/track";
import { SHOW_FREE_INCUMBENT } from "~/lib/radar-config";
import type { FPDSIntel } from "~/lib/fpds";
import {
  getRadarAnswers,
  getRadarSeen,
  saveRadarSeen,
  saveRadarAnswers,
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

const RADAR_CERTS = ["sdvosb", "8a", "wosb", "hubzone", "sb"] as const;
type RadarCert = (typeof RADAR_CERTS)[number];

const CERT_LABEL: Record<string, string> = {
  sdvosb: "SDVOSB",
  "8a": "8(a)",
  wosb: "WOSB",
  hubzone: "HUBZone",
  sb: "Small Business",
};

const SIZE_OPTS = [
  { id: "under250k", label: "< $250K", hint: "under $250,000" },
  { id: "under1m", label: "< $1M", hint: "under $1 million" },
  { id: "under10m", label: "< $10M", hint: "under $10 million" },
  { id: "any", label: "Any size", hint: "no preference" },
] as const;

type SizeId = (typeof SIZE_OPTS)[number]["id"];

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

const runRadarScan = createServerFn({ method: "POST" })
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
      if (SHOW_FREE_INCUMBENT && i < 3) {
        try {
          const { getFPDSIntel } = await import("~/lib/fpds");
          match.incumbent = await getFPDSIntel(bid.naics_code || "", bid.agency || "", bid.title);
        } catch {
          match.incumbent = null;
        }
      }
      matches.push(match);
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
          "Answer four quick questions and Contract Radar scans thousands of live set-aside solicitations to surface your strongest matches — with real match scores, estimated values and deadline countdowns.",
      },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: "Contract Radar — Find contracts you can actually win | Contrax" },
      {
        property: "og:description",
        content:
          "Tell us your trade, state, certification and preferred size. Contract Radar scans the live market and reveals your strongest matches one at a time.",
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
  const [trade, setTrade] = useState("");
  const [state, setState] = useState("");
  const [cert, setCert] = useState<RadarCert | null>(null);
  const [sizePref, setSizePref] = useState<SizeId | null>(null);
  const [scan, setScan] = useState<ScanState>({ status: "idle" });
  const [revealed, setRevealed] = useState(0);
  const [flashTimer, setFlashTimer] = useState<number | null>(null);
  // Soft, dismissible "keep these matches" nudge shown after the FIRST match is
  // revealed (non-blocking — never a hard gate; the real gate still only
  // appears after the 3rd free match).
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const prefilledRef = useRef(false);

  useEffect(() => {
    return () => {
      if (flashTimer) window.clearTimeout(flashTimer);
    };
  }, [flashTimer]);

  // Persist the visitor's radar criteria as they answer (no email involved).
  // Saved only once they're complete (cert + size chosen). /signup and /radar
  // both read this to make resuming a ~10s continuation instead of a restart.
  useEffect(() => {
    if (cert && sizePref) saveRadarAnswers({ trade: trade.trim(), state, cert, sizePref });
  }, [trade, state, cert, sizePref]);

  // Prefill the radar form from a previous anonymous session (e.g. returning
  // from /dashboard's "see them again"), so a revisit restores the answers.
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

  const startScan = () => {
    if (!editing) return;
    trackEvent("radar_scan_start", cert || "");
    setScan({ status: "loading" });
    setRevealed(0);
    // Small real processing pause so the "scanning" reveal reads as active work,
    // while the actual match computation happens server-side over live data.
    const t = window.setTimeout(() => {
      runRadarScan({ data: { trade: trade.trim(), state, cert: cert!, sizePref: sizePref! } })
        .then((res) => {
          if (flashTimer) window.clearTimeout(flashTimer);
          trackEvent("radar_scan_complete", cert || "");
          // The soft nudge is visible the moment the FIRST match is revealed
          // (revealed stays 0 on completion), so attribute its impression here.
          if (res.matches.length > 0) trackEvent("radar_nudge_shown", res.certLabel);
          // Persist this anonymous radar session (criteria + the REAL
          // server-computed matches) so a later signup/login can pick it up
          // in-app — no email involved (owner-directed: no email capture).
          saveRadarSeen({
            answers: { trade: trade.trim(), state, cert: cert!, sizePref: sizePref! },
            certLabel: res.certLabel,
            total: res.matches.length,
            seenCount: 0,
            matches: res.matches.map((m) => ({
              id: m.id,
              title: m.title,
              agency: m.agency,
              score: m.score,
              score_label: m.score_label,
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
              Tell us about your business. We'll scan the live market for contracts you can actually win.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              Answer four quick questions and we'll surface your strongest live
              set-aside matches — one at a time, with a real match score.
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
                  onChange={(e) => setTrade(e.target.value)}
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
                  onChange={(e) => setState(e.target.value)}
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
                Scans thousands of live set-aside solicitations — real results,
                updated every 4 hours.
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
                {Math.min(3, scan.matches.length) === 1 ? "match" : "matches"} revealed
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
                    href="/signup?plan=basic&source=radar"
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
                  <SignupGate certLabel={scan.certLabel} totalFound={scan.matches.length} />
                )}
              </div>
            )}

            {scan.matches.length > 0 && revealed >= scan.matches.length && revealed >= 3 && (
              <div className="mt-6">
                <SignupGate certLabel={scan.certLabel} totalFound={scan.matches.length} />
              </div>
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

function RadarCard({
  match,
  certLabel,
  index,
}: {
  match: RadarMatch;
  certLabel: string;
  index: number;
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

        {/* Why the business qualifies */}
        {match.qualifications.length > 0 && (
          <Section title="Why you qualify">
            <ul className="space-y-1.5">
              {match.qualifications.map((q, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-300">
                  <span className="text-emerald-400" aria-hidden="true">✓</span>
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Why Contrax considers it a strong match */}
        {match.reasons.length > 0 && (
          <Section title="Why this is a strong match">
            <ul className="space-y-1.5">
              {match.reasons.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-300">
                  <span className="text-amber-400" aria-hidden="true">→</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Previous winner + award price — SINGLE flagged code path */}
        <Section title="Previous winner & award price">
          <IncumbentBlock match={match} />
        </Section>

        {/* Important requirements */}
        <Section title="Important requirements">
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
                href="/signup?plan=basic&source=radar"
                onClick={() => trackEvent("radar_requirements_cta", String(match.id))}
                className="font-semibold text-amber-400 hover:text-amber-300"
              >
                sign up free to analyze the complete document
              </a>
              .
            </p>
          )}
        </Section>

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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/** Single render path gated by SHOW_FREE_INCUMBENT (see ~/lib/radar-config.ts). */
function IncumbentBlock({ match }: { match: RadarMatch }) {
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
          href="/signup?plan=basic&source=radar"
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

function SignupGate({ certLabel, totalFound }: { certLabel: string; totalFound: number }) {
  const [showExtra, setShowExtra] = useState(false);
  // Funnel: fire exactly once when the gate is shown.
  useEffect(() => {
    trackEvent("radar_signup_gate_shown", certLabel);
  }, [certLabel]);
  const freeCap = Math.min(3, totalFound);
  const allWereFree = totalFound <= 3;
  return (
    <div className="mt-5 rounded-2xl border border-amber-500/40 bg-slate-900 p-5 text-center ring-1 ring-slate-800">
      <p className="text-sm font-semibold uppercase tracking-wide text-amber-400">Your first 3 matches are free</p>
      <h3 className="mt-1.5 text-lg font-bold text-white">
        {allWereFree
          ? `You've seen all ${totalFound} ${totalFound === 1 ? "match" : "matches"} — save them free.`
          : `You've seen ${freeCap} of ${totalFound} matches — save them all free.`}
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
        href="/signup?plan=basic&source=radar"
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
