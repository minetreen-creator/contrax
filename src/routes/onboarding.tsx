import { createFileRoute, useNavigate, useLocation } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { getCurrentUser, type AuthUser } from "~/lib/auth";
import { trackEvent } from "~/lib/track";
import { persistPendingDraft } from "~/lib/pending-draft";
import { readRememberedNext, clearRememberedNext } from "~/lib/remember-next";
import { locationMatchesStates, keywordPred, setAsidePred } from "~/lib/open-bids";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { NaicsTypeahead, searchNaics } from "~/components/NaicsTypeahead";
import {
  mergeFilterState,
  parseReviewParams,
  readReviewFilters,
  writeReviewFilters,
} from "~/lib/review-context";
import { getRadarPrefill, clearRadarPrefill } from "~/lib/radar-session";

// ── Constants ─────────────────────────────────────────────────────────────────

export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

export const CERTIFICATIONS = [
  { value: "8a", label: "8(a) Business Development" },
  { value: "hubzone", label: "HUBZone" },
  { value: "wosb", label: "WOSB/EDWOSB" },
  { value: "sdvosb", label: "SDVOSB" },
  { value: "vosb", label: "VOSB" },
  { value: "minority_owned", label: "Minority-Owned" },
  { value: "disadvantaged", label: "Disadvantaged" },
] as const;

// "Small Business / No specific set-aside" is deliberately NOT over-filtered:
// every federal set-aside row IS a small-business competition, so choosing this
// just means "don't narrow by set_aside". Same handling for minority-owned and
// disadvantaged, which the bids data has no set-aside tag for.
const CERT_OPTIONS: { value: string; label: string }[] = [
  { value: "small_business", label: "Small Business / No specific set-aside" },
  ...CERTIFICATIONS,
];

// Typical contract range buckets. `min`/`max` are used to filter a bid's
// estimated_value (see parseEstimatedValue + countMatchOpportunities).
// Bids with an unspecified value ("Not specified") are counted as matching the
// selected range because their value is genuinely unknown — not claimed, not
// inflated, just not ruled out. See NULL-value decision in the PR description.
export const CONTRACT_RANGES: Record<
  string,
  { label: string; min: number | null; max: number | null }
> = {
  any: { label: "Any size", min: null, max: null },
  under25k: { label: "Under $25k", min: null, max: 25000 },
  "25k-100k": { label: "$25k – $100k", min: 25000, max: 100000 },
  "100k-1m": { label: "$100k – $1M", min: 100000, max: 1000000 },
  "1m+": { label: "$1M+", min: 1000000, max: null },
};
const RANGE_VALUE_OPTIONS = ["any", "under25k", "25k-100k", "100k-1m", "1m+"] as const;

/**
 * Parse a bid's estimated_value free-text into a numeric upper bound (dollars).
 * Handles "$600,000 – $850,000 per year" → 850000, "$1.2M – $1.8M" → 1800000,
 * "Not specified"/null/unknown → null. Returns the largest number found so a
 * range bid "up to $X" counts whenever the user's range reaches $X.
 */
export function parseEstimatedValue(v: string | null | undefined): number | null {
  if (!v) return null;
  const s = String(v).toLowerCase().trim();
  if (!s || /not specified|unknown|n\/a|tbd|none|to be determined/.test(s)) return null;
  const re = /[$]?\s*([\d,.]+)\s*([kmb])?(?:$|\s|–|-|to|\/)/gi;
  let best = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const numStr = m[1] ?? "";
    const mult = (m[2] ?? "").toLowerCase();
    if (!numStr) continue;
    const num = parseFloat(numStr.replace(/,/g, ""));
    if (Number.isNaN(num)) continue;
    let val = num;
    if (mult === "k") val = num * 1e3;
    else if (mult === "m") val = num * 1e6;
    else if (mult === "b") val = num * 1e9;
    if (val > best) best = val;
  }
  return best >= 0 ? best : null;
}

// ── Server Function: live match count (single source of truth) ────────────────
//
// This is the ONLY query path backing "We found N opportunities matching your
// business". It reuses the SAME open-opportunity population the rest of the
// site counts (post-#185): DISTINCT ON (title, agency) with `due_date > NOW()`
// + the shared LOW_CONTENT_SQL, plus the SAME keyword predicate (keywordPred)
// and the shared set-aside predicate (setAsidePred) — no parallel bespoke
// query. State + contract-range are the two genuinely new filters (no
// site-wide equivalent exists), applied in JS on the already-deduped rows using
// the same state regex the /awards page uses. The count is therefore truthful
// and server-side, never gameable.
const countMatchOpportunities = createServerFn({ method: "GET" }).handler(
  async ({
    data,
  }: {
    data?: {
      certification?: string;
      query?: string;
      states?: string[];
      range?: string;
      naicsCodes?: string[];
    };
  }) => {
    const { sql } = await import("~/db");
    const certification = (data?.certification ?? "").trim();
    const query = (data?.query ?? "").trim();
    const states = (data?.states ?? []).filter((s) => US_STATES.includes(s));
    const rangeKey = (data?.range ?? "any") in CONTRACT_RANGES ? data!.range! : "any";
    const range = CONTRACT_RANGES[rangeKey];

    // naics_code is migration-created (007/012) and present in
    // src/db/schema.sql, so keywordPred / the NAICS ANY-match can reference it
    // directly — no per-render `ALTER TABLE bids ADD COLUMN IF NOT EXISTS
    // naics_code` DDL needed.
    //
    // Multi-code support: when the user holds NAICS codes (from the shared
    // typeahead), we OR-match ANY of them against naics_code in one predicate.
    // A raw keyword phrase remains a supported fallback (blank path / typed
    // phrase) for full backward compatibility.
    const codes = (data?.naicsCodes ?? [])
      .map((c) => String(c).trim())
      .filter((c) => /^\d{6}$/.test(c));
    const q = query.trim().toLowerCase();

    const certPred = setAsidePred(certification, sql);
    let kwPred;
    if (codes.length > 0) {
      const codeAny = sql()`naics_code = ANY(${codes})`;
      if (q && !/^\d{6}$/.test(q)) {
        // Selected codes OR a complementary keyword-phrase match.
        kwPred = sql()`AND (${codeAny} ${sql().unsafe("OR")} LOWER(COALESCE(naics_code,'')) LIKE ${"%" + q + "%"})`;
      } else {
        kwPred = sql()`AND ${codeAny}`;
      }
    } else {
      kwPred = keywordPred(query, sql);
    }

    const rows = (await sql()`
      SELECT DISTINCT ON (title, agency)
             title, agency, location, estimated_value, set_aside
      FROM bids
      WHERE ${sql().unsafe(LOW_CONTENT_SQL)} AND due_date > NOW()
        ${certPred} ${kwPred}
      ORDER BY title, agency
    `) as { title: string; agency: string; location: string | null; estimated_value: string | null; set_aside: string | null }[];

    let count = 0;
    let unknownValue = 0;
    for (const r of rows) {
      // Geography filter — single source of truth from ~/lib/open-bids.
      // "Select all states" / no states → no-op (nationwide): EVERY location
      // matches, so national/unspecified-location bids are NOT under-counted.
      // Specific states → targeted 2-letter state filter, unchanged.
      if (!locationMatchesStates(r.location, states)) continue;
      // Contract-range filter. Unspecified value → cannot be ruled out → counts
      // as matching (documented, honest; disclosed in the UI note).
      const v = parseEstimatedValue(r.estimated_value);
      if (v === null) {
        unknownValue++;
        count++;
        continue;
      }
      if (range.min != null && v < range.min) continue;
      if (range.max != null && v > range.max) continue;
      count++;
    }

    return { count, unknownValue };
  },
);

// ── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  loader: () => getCurrentUser(),
  component: OnboardingRoute,
});

// ── Route wrapper (auth guard lives here so hooks always run in same order) ──
function OnboardingRoute() {
  const currentUser = Route.useLoaderData();
  const navigate = useNavigate();
  if (!currentUser) {
    navigate({ to: "/login" });
    return null;
  }
  return <OnboardingPage currentUser={currentUser} />;
}

function OnboardingPage({ currentUser }: { currentUser: AuthUser }) {
  const location = useLocation();
  // Seed the filter context from URL params (override) + the persisted store
  // (localStorage "contrax.reviewFilters"), so a reload / navigation keeps the
  // last deliberately-chosen filters instead of resetting ("stays put").
  const initCtx = mergeFilterState(parseReviewParams(location.search), readReviewFilters());
  const [certification, setCertification] = useState<string>(initCtx.setAside || "small_business");
  const [query, setQuery] = useState("");
  const [naicsCodes, setNaicsCodes] = useState<string[]>(initCtx.naics);
  const [states, setStates] = useState<string[]>(initCtx.states);
  const [contractRange, setContractRange] = useState("any");

  // Radar → signup → onboarding prefill (owner-directed, NO email capture). When
  // the visitor came through a Contract Radar scan, /signup stashed their radar
  // criteria in sessionStorage. Apply them here once (prefill the profile
  // fields) so the signup→onboarding flow feels like a ~10s continuation, then
  // clear the stash so it never re-applies on a later revisit/refresh.
  const radarPrefillFiredRef = useRef(false);
  useEffect(() => {
    if (radarPrefillFiredRef.current) return;
    radarPrefillFiredRef.current = true;
    const ra = getRadarPrefill();
    if (!ra) return;
    // Certification: radar certs map 1:1 onto onboarding CERT_OPTIONS values
    // ("sb" → the broad small-business option).
    const certMap: Record<string, string> = { sdvosb: "sdvosb", "8a": "8a", wosb: "wosb", hubzone: "hubzone", sb: "small_business" };
    const cert = certMap[ra.cert];
    if (cert) setCertification(cert);
    // State: radar picks one state → single-state filter.
    if (ra.state && US_STATES.includes(ra.state)) setStates([ra.state]);
    // Trade: a 6-digit NAICS becomes a NAICS code; a text trade is resolved to
    // its best-matching NAICS code so it actually PRE-FILLS the NAICS field as
    // a visible chip (searchNaics is the same resolver the typeahead uses). If
    // nothing matches (obscure text), fall back to the keyword term — which
    // still drives the same keywordPred the dashboard uses.
    if (/^\d{6}$/.test(ra.trade)) {
      setNaicsCodes([ra.trade]);
    } else if (ra.trade) {
      const hits = searchNaics(ra.trade, 1);
      if (hits.length > 0) setNaicsCodes([hits[0].code]);
      else setQuery(ra.trade);
    }
    clearRadarPrefill();
  }, []);

  // Persist the chosen filters to the shared store whenever they change, so a
  // fresh session / reload keeps them (shared mechanism with the dashboard).
  useEffect(() => {
    writeReviewFilters({ states, setAside: certification, naics: naicsCodes });
  }, [states, certification, naicsCodes]);

  const [counting, setCounting] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [unknownValue, setUnknownValue] = useState(0);
  const [countError, setCountError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Safety net for the Google OAuth path pending-draft carry (same behavior as
  // the previous wizard). Idempotent and fail-open.
  const pendingDraftFiredRef = useRef(false);
  useEffect(() => {
    if (pendingDraftFiredRef.current) return;
    pendingDraftFiredRef.current = true;
    persistPendingDraft();
  }, []);

  const toggleState = (s: string) =>
    setStates((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  const selectAllStates = () =>
    setStates((prev) => (prev.length === US_STATES.length ? [] : [...US_STATES]));

  const canCompute = certification.trim().length > 0 && states.length > 0;

  const runCount = async (overrides?: { cert?: string; states?: string[]; range?: string; query?: string; naicsCodes?: string[] }) => {
    if (counting) return;
    setCounting(true);
    setCountError("");
    setCount(null);
    try {
      const res = (await countMatchOpportunities({
        data: {
          certification: overrides?.cert ?? certification,
          query: overrides?.query !== undefined ? overrides.query : query,
          naicsCodes: overrides?.naicsCodes !== undefined ? overrides.naicsCodes : naicsCodes,
          states: overrides?.states ?? states,
          range: overrides?.range ?? contractRange,
        },
      })) as { count: number; unknownValue: number };
      setCount(res.count);
      setUnknownValue(res.unknownValue);
      trackEvent("onboarding_match_count", String(res.count), "/onboarding");
    } catch (err) {
      setCountError("We couldn't count your matches right now. Please try again.");
    } finally {
      setCounting(false);
    }
  };

  const looseFilters = () => {
    // Broaden: drop the trade/keyword, include all states, any contract size.
    // Keeps the certification (that's the business's identity), which is honest.
    setQuery("");
    setNaicsCodes([]);
    setContractRange("any");
    setStates([...US_STATES]);
    setCount(null);
    // recompute immediately with the broadened filters
    runCount({ query: "", naicsCodes: [], states: [...US_STATES], range: "any" });
  };

  const saveProfileAndGo = async () => {
    setSaving(true);
    setError("");
    const derivedName = (currentUser.email?.split("@")[0] || "My Business")
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || "My Business";
    const isNumericNaics = /^\d{6}$/.test(query.trim());
    // The authority is the set of codes picked in the typeahead. Fall back to a
    // bare typed 6-digit code (pre-typeahead behavior) so a user who types a
    // code without tapping a suggestion still saves it.
    const finalCodes = naicsCodes.length > 0 ? naicsCodes : isNumericNaics ? [query.trim()] : [];
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: derivedName,
          industry: finalCodes.length > 0 ? "" : query.trim(),
          locations: states,
          // settings shape — no `services` key, so the profile endpoint does NOT
          // require industry/services that the new flow no longer collects.
          naicsCodes: finalCodes,
          certifications:
            certification && certification !== "small_business" ? [certification] : [],
          specialties: finalCodes.length > 0 ? [] : query.trim() ? [query.trim()] : [],
          typicalContractValue: CONTRACT_RANGES[contractRange]?.label || "",
        }),
      }).then((r) => r.json());
      if (!res.success) throw new Error(res.error || "Failed to save profile.");
    } catch (err) {
      // Fail-open — never block the activation moment on a profile write.
      console.error("[onboarding] profile save failed:", err);
    }
    // Fire the Technical Approach draft (for Professional-tier score→signup
    // users) with keepalive so it survives navigation; fail-open if it errors.
    try {
      fetch("/api/pending-drafts/fulfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      }).catch(() => {});
    } catch { /* fail-open */ }
    setSaving(false);

    // Path into the matched open feed — the homepage's Instant Search open
    // opportunities section, filtered by the SAME keyword predicate. q flows
    // through the validated search + loaderDeps path (#184), so this is a real
    // filtered SSR render of live OPEN solicitations.
    const rememberedNext = readRememberedNext();
    if (rememberedNext) {
      clearRememberedNext();
      window.location.assign(rememberedNext);
      return;
    }
    // Unified review surface: onboarding's "We found N" leads into the
    // dashboard matched-bid review, which shares the SAME filter-context
    // persistence + sticky filter bar + Next/Previous review continuity. The
    // just-saved profile (locations / NAICS / certifications) drives the feed.
    window.location.assign("/dashboard");
  };

  const certLabel = CERT_OPTIONS.find((c) => c.value === certification)?.label || certification;
  const rangeLabel = CONTRACT_RANGES[contractRange]?.label || contractRange;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-2xl px-4 py-4 flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-2">
            <img src="/logo.png" alt="Contrax" className="h-8 w-auto" />
          </a>
          <span className="text-sm text-slate-500">{currentUser.email}</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-slate-900">Tell us about your business</h1>
            <p className="mt-1 text-sm text-slate-500">
              Answer 4 quick questions and we&rsquo;ll show you how many real, open
              opportunities match your business.
            </p>
          </div>

          {(error || countError) && (
            <div className="mb-6 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {error || countError}
            </div>
          )}

          {/* 1. Certification */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-slate-700">1. Your certification</label>
            <div className="mt-2">
              <select
                value={certification}
                onChange={(e) => { setCertification(e.target.value); setCount(null); }}
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
              >
                {CERT_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 2. NAICS / trade */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-slate-700">
              2. What do you do? (NAICS code / trade)
            </label>
            <NaicsTypeahead
              inputId="trade"
              value={naicsCodes}
              onChange={(codes) => { setNaicsCodes(codes); setCount(null); }}
              onTermChange={(t) => { setQuery(t); setCount(null); }}
              placeholder="Search your trade — e.g. HVAC, roofing, management consulting"
              helpText="Pick one or more trades (you can hold several service lines and turn them on/off in Settings later). Optional: leave blank for any trade."
            />
          </div>

          {/* 3. Geography */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-slate-700">3. Where do you work?</label>
            <button
              type="button"
              onClick={selectAllStates}
              className="mt-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800"
            >
              {states.length === US_STATES.length ? "Deselect all" : "Select all states"}
            </button>
            <div className="mt-1.5 grid grid-cols-4 sm:grid-cols-6 gap-2">
              {US_STATES.map((s) => {
                const on = states.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => { toggleState(s); setCount(null); }}
                    className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-all ${
                      on
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              {states.length} state{states.length !== 1 ? "s" : ""} selected
            </p>
          </div>

          {/* 4. Contract range */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-slate-700">4. Typical contract range</label>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2">
              {RANGE_VALUE_OPTIONS.map((key) => {
                const on = contractRange === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setContractRange(key); setCount(null); }}
                    className={`rounded-lg border px-2 py-2.5 text-xs font-semibold transition-all ${
                      on
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {CONTRACT_RANGES[key].label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Find matches */}
          <button
            onClick={() => runCount()}
            disabled={!canCompute || counting || saving}
            className="w-full rounded-xl bg-slate-900 px-6 py-3.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
          >
            {counting ? (
              <span className="inline-flex items-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Counting live opportunities…
              </span>
            ) : (
              "Find matching opportunities"
            )}
          </button>
          {!canCompute && (
            <p className="mt-2 text-xs text-slate-400">
              Pick a certification and at least one state to see your live match count.
            </p>
          )}

          {/* ── Skip onboarding — honest escape (owner-approved
               ONBOARDING-ESCAPE fix) ──────────────────────────────────────
               A new user who just committed email + password can always reach
               the dashboard without completing the wizard. No fake urgency, no
               false scarcity — just the honest fact that the profile can be
               built anytime and matches still work nationwide without it (the
               same nationwide-with-no-set-aside semantics the dashboard feed
               and R1 trial-start card already use for a profile-less user).
               This LINK only navigates; it does not create or alter any
               profile/trial state. */}
          <div className="mt-6 border-t border-slate-100 pt-6">
            <a
              href="/dashboard"
              className="flex flex-col gap-1 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-5 py-4 transition-colors hover:border-blue-300 hover:bg-blue-50/40 sm:flex-row sm:items-center sm:justify-between"
            >
              <span>
                <span className="block text-sm font-semibold text-slate-700">
                  Skip for now — go to my dashboard
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                  You can build your profile anytime. Your bid matches still work
                  nationwide without it.
                </span>
              </span>
              <span className="mt-2 shrink-0 text-sm font-semibold text-blue-600 sm:mt-0">
                Continue →
              </span>
            </a>
          </div>

          {/* Result */}
          {count !== null && (
            <div className="mt-6 rounded-xl border p-6 text-center">
              {count > 0 ? (
                <>
                  <p className="text-sm font-medium text-slate-500">We found</p>
                  <p className="mt-1 text-5xl font-black text-slate-900">{count.toLocaleString()}</p>
                  <p className="mt-1 text-sm font-medium text-slate-700">
                    open opportunit{count === 1 ? "y" : "ies"} matching your business
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                    <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{certLabel}</span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                      {states.length} state{states.length !== 1 ? "s" : ""}
                    </span>
                    {naicsCodes.length > 0 && (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        {naicsCodes.length} NAICS: {naicsCodes.join(", ")}
                      </span>
                    )}
                    <span className="rounded-full px-2.5 py-1 text-xs font-medium text-slate-500">{rangeLabel}</span>
                  </div>
                  {unknownValue > 0 && (
                    <p className="mt-1 text-xs text-slate-400">
                      {unknownValue} of these don&rsquo;t list a contract value and are included.
                    </p>
                  )}
                  <div className="mt-5 flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                      onClick={saveProfileAndGo}
                      disabled={saving}
                      className="rounded-xl bg-emerald-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-emerald-700 disabled:opacity-40 active:scale-[0.98]"
                    >
                      {saving ? "Setting up…" : "See your matches →"}
                    </button>
                    <button
                      onClick={() => { window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50"
                    >
                      Adjust filters
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-3xl font-black text-slate-900">0</p>
                  <p className="mt-1 text-sm font-semibold text-slate-700">
                    matching open opportunities right now
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    No open solicitations match {certLabel.toLowerCase()}, {states.length} state
                    {states.length !== 1 ? "s" : ""}, and an estimated value in &ldquo;{rangeLabel}&rdquo; right now.
                    This is a live, honest count — new set-aside bids are synced several times a day.
                  </p>
                  <div className="mt-5 flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                      onClick={looseFilters}
                      disabled={counting}
                      className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-blue-700 disabled:opacity-40"
                    >
                      {counting ? "Counting…" : "Loosen my filters"}
                    </button>
                    <button
                      onClick={() => { window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50"
                    >
                      Adjust filters
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
