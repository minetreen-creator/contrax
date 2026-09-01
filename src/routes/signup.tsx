import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { SignupContextPanel } from "~/components/SignupContextPanel";
import { getCurrentUser } from "~/lib/auth";
import { trackEvent } from "~/lib/track";
import { getOrCreateVisitorId, getOrCreateVisitId } from "~/lib/visitor";
import { setTrackingUser, getTrackingUser } from "~/lib/identity";
import { persistPendingDraft } from "~/lib/pending-draft";
import { storeRememberedNext } from "~/lib/remember-next";
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { getGoogleAuthUrl } from "~/lib/google-oauth";
import { getLinkedInAuthUrl } from "~/lib/linkedin-oauth";
import { safeNext } from "~/lib/saved-matches";
import {
  getRadarAnswers,
  getRadarSeen,
  saveRadarPrefill,
  saveRadarSeen,
  RADAR_CERT_LABELS,
  RADAR_SIZE_LABELS,
  type RadarAnswers,
  type RadarCertId,
  type RadarSizeId,
  type RadarSeenMatch,
} from "~/lib/radar-session";


type ScoreRec = "GO" | "CAUTIOUS" | "NO-GO";

type SignupSearch = {
  plan?: string;
  ticker_bid?: string;
  ticker_agency?: string;
  score_rec?: ScoreRec;
  save_bid?: string;
  next?: string;
  // Closing Soon → signup context: the specific bid's DB id and its closing
  // deadline (ISO). When both are present (with ticker_bid) the signup page
  // shows an urgency panel that frames signup around unlocking THIS bid before
  // it closes, instead of a generic account pitch.
  bid?: string;
  closes?: string;
  // Generalized context source — the SAME framing mechanism serves both:
  // `closing_soon` (bid + deadline, urgency-driven) and `incumbent`
  // (bid/opportunity title, value-driven — no deadline). The component that
  // renders these is SignupContextPanel. `opportunity_id` is the incumbent
  // gate's bid/opportunity DB id; `title`/`agency` carry its context so the
  // incumbent banner can name the bid. `radar` continues a Contract Radar scan
  // (criteria read from localStorage — no email capture).
  source?: "closing_soon" | "incumbent" | "radar";
  opportunity_id?: string;
  title?: string;
  agency?: string;
  // Estimated contract value (USD string, e.g. "725682.23") carried from a
  // contextual entry point (homepage Closing Soon block) so the contextual
  // header can show "$X [title]". Shown ONLY when a REAL value is genuinely
  // present — never fabricated; formatEstimate() returns null unless the value
  // parses to a finite positive number.
  value?: string;
  // Radar source — URL search params carry the scan criteria so a directly
  // shared/served signup link (e.g. an ad) can show its filter context and
  // matches even with no local radar session. `trade` (or 6-digit NAICS),
  // `cert` (sdvosb|8a|wosb|hubzone|sb), `state` (2-letter), and optional `size`
  // (under250k|under1m|under10m|any). Read FIRST; the local radar session is
  // the fallback when these are absent.
  trade?: string;
  cert?: string;
  state?: string;
  size?: string;
};

const validPlans = ["basic", "starter", "professional", "agency"] as const;

type Plan = (typeof validPlans)[number];
// Radar cert ids — mirrors RADAR_CERTS in src/routes/radar.tsx. Used to gate
// the onboarding prefill on a known cert value (fail-open otherwise).
const RADAR_CERTS = ["sdvosb", "8a", "wosb", "hubzone", "sb"] as const;

// Plan facts mirror src/routes/pricing/index.tsx. Basic ($0) is the free
// default tier (plan_tier='basic'); Starter/Professional/Agency are the paid
// upgrades. Prices $19/$79/$199 mirror the live Stripe map.
const PLAN_OPTIONS: {
  slug: Plan;
  name: string;
  price: number;
  bullets: string[];
  featured?: boolean;
  free?: boolean;
}[] = [
  {
    slug: "basic",
    name: "Basic",
    price: 0,
    free: true,
    bullets: [
      "Basic Solicitations Search",
      "Up to 3 saved bids",
      "1 AI Executive Brief monthly",
      "Standard set-aside filters",
    ],
  },
  {
    slug: "starter",
    name: "Starter",
    price: 19,
    bullets: [
      "Unlimited saved bids",
      "3 AI Executive Briefs monthly",
      "Daily NAICS email alerts",
      "CSV pipeline export",
    ],
  },
  {
    slug: "professional",
    name: "Professional",
    price: 79,
    bullets: ["50 AI Executive Briefs monthly", "Full incumbent intelligence & past pricing", "AI match scoring", "Draft tools"],
    featured: true,
  },
  {
    slug: "agency",
    name: "Agency",
    price: 199,
    bullets: ["Proposal Evaluator Red Team", "Team roles & permissions", "Integration connectors"],
  },
];

// Countdown helper for the Closing Soon → signup urgency panel. Returns a
// human short-form "Xd Yh / Xh Ym / Xm" remaining until the given ISO deadline,
// or null when the value is absent/invalid/expired. Pure besides passing `now` (the
// caller supplies Date.now()) so it renders identically in SSR and on the
// client's first paint, then ticks client-side.
const closingCountdown = (iso: string | undefined, now: number): string | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const ms = Math.max(0, t - now);
  if (ms <= 0) return null; // already closed — caller falls back to "today"
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const remMins = mins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${remMins}m`;
  return `${Math.max(1, remMins)}m`;
};

// Format a REAL estimated contract value (the URL `value` param) as USD for the
// contextual signup header. Returns null unless a finite, positive number is
// actually present — a dollar figure is NEVER fabricated, so a missing/zero/
// malformed value simply yields no "$X" (honest fallback to plain "track").
const formatEstimate = (v: string | undefined): string | null => {
  if (!v || !String(v).trim()) return null;
  const amount = Number(v);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
};

// Live solicitation-counts for the social-proof line — reconciled so the
// "tracked" number (EVERY solicitation ever synced, including closed/past-due
// ones) is clearly distinguished from the "currently open" subset (the same
// population as the homepage `totalOpen` counter). Returns { tracked: 0,
// open: 0 } if the DB is unreachable so the page always renders; the component
// falls back to static truthful copy when no live count is available.
const getTrackedBidCount = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const [trackedRows, openRows] = await Promise.all([
      sql()`SELECT COUNT(*)::int AS count FROM bids`,
      // Open count reuses the exact homepage /map definition so it matches the
      // homepage "open opportunities" number bit-for-bit.
      sql()`SELECT COUNT(*)::int AS count FROM bids
            WHERE (due_date IS NULL OR due_date::date >= NOW()::date)
              AND ${sql().unsafe(LOW_CONTENT_SQL)}`,
    ]);
    return {
      tracked: Number((trackedRows[0] as any)?.count || 0),
      open: Number((openRows[0] as any)?.count || 0),
    };
  } catch {
    return { tracked: 0, open: 0 };
  }
});

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>): SignupSearch => ({
    // Cold arrivals (no ?plan= — homepage/awards CTAs) default to the free
    // Basic package so non-paying signups are auto-provisioned on the free
    // tier (no-bifurcation rule). Intent links (?plan=starter|professional
    // from the pricing page, or ?plan=professional from an Incumbent gate)
    // still preselect a paid plan via the URL.
    plan: typeof search.plan === "string" && validPlans.includes(search.plan as typeof validPlans[number]) ? search.plan : "basic",
    ticker_bid: typeof search.ticker_bid === "string" ? search.ticker_bid : undefined,
    ticker_agency: typeof search.ticker_agency === "string" ? search.ticker_agency : undefined,
    score_rec:
      search.score_rec === "GO" || search.score_rec === "CAUTIOUS" || search.score_rec === "NO-GO"
        ? (search.score_rec as ScoreRec)
        : undefined,
    // Save-to-pipeline deep link (`/signup?plan=professional&save_bid=123&next=/awards`).
    // save_bid is validated as a plain integer string; `next` is re-validated by
    // safeNext() at redirect time (open-redirect guard).
    save_bid:
      typeof search.save_bid === "string" && /^\d{1,10}$/.test(search.save_bid)
        ? search.save_bid
        : undefined,
    next: typeof search.next === "string" ? search.next.slice(0, 500) : undefined,
    bid: typeof search.bid === "string" && /^\d{1,10}$/.test(search.bid) ? search.bid : undefined,
    closes: typeof search.closes === "string" ? search.closes.slice(0, 120) : undefined,
    source:
      search.source === "closing_soon" || search.source === "incumbent" || search.source === "radar"
        ? search.source
        : undefined,
    opportunity_id:
      typeof search.opportunity_id === "string" && /^\d{1,10}$/.test(search.opportunity_id)
        ? search.opportunity_id
        : undefined,
    title: typeof search.title === "string" ? search.title.slice(0, 300) : undefined,
    agency: typeof search.agency === "string" ? search.agency.slice(0, 200) : undefined,
    value: typeof search.value === "string" ? search.value.slice(0, 40) : undefined,
    trade: typeof search.trade === "string" ? search.trade.slice(0, 120) : undefined,
    cert: typeof search.cert === "string" ? search.cert.slice(0, 24) : undefined,
    state: typeof search.state === "string" ? search.state.slice(0, 4) : undefined,
    size: typeof search.size === "string" ? search.size.slice(0, 24) : undefined,
  }),
  loader: async () => {
    const bidCounts = await getTrackedBidCount();
    return {
      currentUser: await getCurrentUser(),
      trackedBids: bidCounts.tracked,
      openBids: bidCounts.open,
      // True when LINKEDIN_CLIENT_ID is configured. While absent, the LinkedIn
      // button renders disabled ("coming soon") and never builds a broken URL.
      linkedInAuthUrl: await getLinkedInAuthUrl(),
      // Google is gated at runtime: null unless BOTH GOOGLE_CLIENT_ID and
      // GOOGLE_CLIENT_SECRET are configured. When null the CTA renders disabled
      // with an honest reason instead of a live-looking link to a handshake
      // that would fail server-side (the callback needs both env vars).
      googleAuthUrl: await getGoogleAuthUrl(),
    };
  },
  component: SignupPage,
  head: () => ({
    meta: [
      { title: "Create your Contrax account | Contrax" },
      {
        name: "description",
        content:
          "Create your Contrax account to discover government bids, analyze opportunities, and draft proposals.",
      },
      { name: "robots", content: "noindex, nofollow" },
      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.contrax.company/signup" },
      { property: "og:title", content: "Create your Contrax account | Contrax" },
      {
        property: "og:description",
        content:
          "Create your Contrax account to discover government bids, analyze opportunities, and draft proposals.",
      },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:alt", content: "Contrax — government contract bidding platform" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Create your Contrax account | Contrax" },
      {
        name: "twitter:description",
        content:
          "Create your Contrax account to discover government bids, analyze opportunities, and draft proposals.",
      },
      { name: "twitter:image", content: "https://www.contrax.company/logo-square.png" },
      { name: "twitter:image:alt", content: "Contrax — government contract bidding platform" },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/signup" }],
  }),
});

// ── Page Component ────────────────────────────────────────────────────────────

function SignupPage() {
  const { currentUser, trackedBids, openBids, linkedInAuthUrl, googleAuthUrl: baseGoogleAuthUrl } =
    Route.useLoaderData();
  const navigate = useNavigate();
  const { plan, ticker_bid, ticker_agency, score_rec, save_bid, next, closes, source, title, agency, trade, cert, state, size, value } =
    Route.useSearch();

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan>(plan);
  // Browser-tab title matches the selected plan (P2): Basic is genuinely free
  // forever (no card), paid tiers carry the 14-day trial. Kept in sync client-
  // side so the tab reads truthfully however the visitor arrived.
  useEffect(() => {
    document.title =
      selectedPlan === "basic"
        ? "Contrax — Free, No Card Required"
        : "Contrax — Start Your 14-Day Professional Trial";
  }, [selectedPlan]);

  // Live countdown for the Closing Soon → signup urgency panel. Initial value is
  // computed at render (Date.now() at first paint — matches SSR), then re-ticked
  // once a minute so the "closes in Xd Yh" copy stays accurate while the visitor
  // reads the form. Harmless when no `closes` context is present.
  const [closingNow, setClosingNow] = useState(() => Date.now());
  useEffect(() => {
    if (!closes) return;
    const t = setInterval(() => setClosingNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [closes]);
  const closingLabel = closingCountdown(closes, closingNow);

  // Radar continuation (owner-directed, NO email capture): when the visitor
  // arrives from a Contract Radar scan (?source=radar), read their anonymous
  // scan criteria from localStorage and (a) show a "resume your scan" panel and
  // (b) forward the criteria to /onboarding (session-scoped) so the profile
  // fields arrive pre-filled — signup feels like a ~10s continuation.
  const [radarAnswers, setRadarAnswers] = useState<{
    trade: string; state: string; certLabel: string; sizeLabel: string;
  } | null>(null);
  // The visitor's SEEN radar matches (server-computed top-3, never fabricated).
  // Displayed on the signup page and preserved for them.
  const [radarMatches, setRadarMatches] = useState<RadarSeenMatch[] | null>(null);
  useEffect(() => {
    if (source !== "radar") return;
    // SOURCE PRECEDENCE (owner rule): criteria come from the URL search params
    // FIRST (?source=radar&trade=…&cert=…&state=…&size=…), so a directly
    // shared/served signup link (e.g. an FB ad) shows its filter context and
    // matches even when the visitor has no local radar session. Only when no
    // relevant param is present do we fall back to the local radar session
    // (getRadarAnswers / getRadarSeen). Fail-open: unknown/malformed values
    // degrade to the current behavior, never crash.
    const urlTrade = (trade || "").trim();
    const urlCert = (cert || "").trim();
    const urlState = (state || "").trim().toUpperCase();
    const urlSize = (size || "").trim();
    const hasUrlCriteria = !!(urlTrade || urlCert || urlState || urlSize);
    const local = getRadarAnswers();
    const criteria = {
      trade: (hasUrlCriteria ? urlTrade : "") || local?.trade || "",
      state: (hasUrlCriteria ? urlState : "") || local?.state || "",
      cert: (hasUrlCriteria ? urlCert : "") || local?.cert || "",
      size: (hasUrlCriteria ? urlSize : "") || local?.sizePref || "",
    };
    const certLabel =
      (RADAR_CERT_LABELS as Record<string, string>)[criteria.cert] || criteria.cert || "";
    const sizeLabel = RADAR_SIZE_LABELS[criteria.size] || "";
    const showCriteria = !!(criteria.trade || criteria.state || criteria.cert);
    if (showCriteria) {
      setRadarAnswers({
        trade: criteria.trade,
        state: criteria.state,
        certLabel,
        sizeLabel,
      });
      // Forward the criteria to onboarding prefill (session-only; no email, no
      // server write) so the profile fields arrive pre-filled after signup.
      const prefill: RadarAnswers = {
        trade: criteria.trade,
        state: criteria.state,
        cert: criteria.cert as RadarCertId,
        sizePref: criteria.size as RadarSizeId,
      };
      if ((RADAR_CERTS as readonly string[]).includes(criteria.cert)) saveRadarPrefill(prefill);
      trackEvent("radar_prefill_shown", certLabel);
    }
    // Matches: reuse the local SEEN session when it reflects the resolved
    // criteria (radar → signup continuation, no extra work). Otherwise — a
    // URL-served link with no matching local session — run a REAL server scan
    // so the visitor still sees their matching bids (never fabricated). When no
    // local session and no URL criteria exist, nothing is shown (current
    // behavior).
    const seen = getRadarSeen();
    const seenMatchesCriteria =
      !!seen?.answers &&
      seen.answers.cert === criteria.cert &&
      seen.answers.trade.trim().toLowerCase() === criteria.trade.trim().toLowerCase();
    if (seen && seen.matches.length > 0 && (!hasUrlCriteria || seenMatchesCriteria)) {
      setRadarMatches(seen.matches);
      return;
    }
    if (hasUrlCriteria && showCriteria) {
      import("~/routes/radar")
        .then(({ runRadarScan }) =>
          runRadarScan({
            data: {
              trade: criteria.trade,
              state: criteria.state,
              cert: criteria.cert || "sb",
              sizePref: criteria.size || "any",
            },
          }),
        )
        .then((res) => {
          const matches: RadarSeenMatch[] = res.matches.slice(0, 3).map((m) => ({
            id: m.id,
            title: m.title,
            agency: m.agency,
            score: m.score,
            score_label: m.score_label,
            due_date: m.due_date,
            source_url: m.source_url,
          }));
          if (matches.length > 0) {
            setRadarMatches(matches);
            saveRadarSeen({
              answers: {
                trade: criteria.trade,
                state: criteria.state,
                cert: (criteria.cert || "sb") as RadarCertId,
                sizePref: (criteria.size || "any") as RadarSizeId,
              },
              certLabel,
              total: res.matches.length,
              seenCount: Math.min(3, matches.length),
              matches,
            });
          }
        })
        .catch(() => {
          /* fail-open: never let a scan error break the signup page */
        });
    }
  }, [source, trade, cert, state, size]);

  // Funnel: fire exactly ONE signup-page-view event per visit, once. The cold
  // path (e.g. the homepage Closing Soon → /signup) fires a plain `signup_view`;
  // the score-recommendation path keeps its distinct `signup_view_with_score`
  // so the funnel's "viewed signup" step is measurable for BOTH. Mutual
  // exclusion keeps a single visit from double-counting a view.
  const scoredViewFiredRef = useRef(false);
  useEffect(() => {
    if (scoredViewFiredRef.current) return;
    scoredViewFiredRef.current = true;
    if (score_rec) trackEvent("signup_view_with_score", score_rec);
    else trackEvent("signup_view");
  }, [score_rec]);

  // ── signup_start: fire EXACTLY ONCE when the visitor begins the form (first
  // focus into any field — focusin bubbles on the <form>, listening there). The
  // most meaningful "start" is the first interaction with the signup form. Other
  // CTAs (Google/LinkedIn buttons, plan cards) sit OUTSIDE the <form>, so this
  // stays a true form-start signal and never re-fires (ref guard).
  const signupStartedRef = useRef(false);
  const handleSignupStart = () => {
    if (signupStartedRef.current) return;
    signupStartedRef.current = true;
    trackEvent("signup_start", source === "radar" ? "radar" : selectedPlan);
  };

  // ── Abandonment: fire-and-forget, at most once per visit, ONLY if the
  // visitor leaves WITHOUT completing a signup. Never fires after signup_success
  // (guarded by signupSucceededRef, set on success) and never after an already
  // tracked abandon (abandonedFiredRef). Uses navigator.sendBeacon so the
  // request survives the unload; never breaks navigation or SSR.
  const signupSucceededRef = useRef(false);
  const abandonedFiredRef = useRef(false);
  // redirectingRef guards the logged-in redirect path below: when an
  // already-signed-in user lands on /signup we redirect (or complete a
  // save_bid then redirect) without ever firing signup_success, so the
  // abandonment listener must not treat that unload as an abandon. Set when
  // the redirect effect begins; the component unmounts right after, so it is
  // never reset (a stale `true` only silences a dead listener).
  const redirectingRef = useRef(false);
  useEffect(() => {
    const fireAbandoned = () => {
      if (typeof navigator === "undefined") return;
      if (redirectingRef.current) return; // logged-in redirect, not an abandon
      if (signupSucceededRef.current || abandonedFiredRef.current) return;
      abandonedFiredRef.current = true;
      const payload: Record<string, string> = {
        event: "signup_abandon",
        visitor_id: getOrCreateVisitorId(),
        visit_id: getOrCreateVisitId(),
      };
      const user = getTrackingUser();
      if (user) {
        payload.user_id = user.id;
        payload.user_email = user.email;
      }
      try {
        navigator.sendBeacon(
          "/api/event",
          new Blob([JSON.stringify(payload)], { type: "application/json" }),
        );
      } catch {
        /* never let abandonment tracking break anything */
      }
    };
    window.addEventListener("pagehide", fireAbandoned);
    window.addEventListener("beforeunload", fireAbandoned);
    return () => {
      window.removeEventListener("pagehide", fireAbandoned);
      window.removeEventListener("beforeunload", fireAbandoned);
    };
  }, []);

  // If already logged in, redirect to dashboard (in an effect so hooks
  // always run in the same order on every render). When arriving with a
  // save_bid intent (e.g. the user logged in in another tab after clicking
  // Save), complete the save before redirecting — never block the redirect on
  // the save, and never let an open redirect escape (safeNext guard).
  useEffect(() => {
    if (currentUser) {
      redirectingRef.current = true;
      if (save_bid) {
        fetch("/api/bids-save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bidId: Number(save_bid) }),
        })
          .then((res) => {
            if (res.ok) trackEvent("save_success", save_bid, next);
          })
          .catch(() => {})
          .finally(() => {
            window.location.assign(safeNext(next) ?? "/dashboard");
          });
      } else {
        navigate({ to: "/dashboard" });
      }
    }
  }, [currentUser, navigate, save_bid, next]);

  // Keep the selector in sync if the ?plan= search param changes (e.g. a
  // pricing page CTA navigates here while the component is mounted).
  useEffect(() => {
    setSelectedPlan(plan);
  }, [plan]);

  // Google OAuth URL, built from the runtime-verified base the loader's
  // getGoogleAuthUrl() returned. That base is null unless BOTH GOOGLE_CLIENT_ID
  // and GOOGLE_CLIENT_SECRET are configured — so this CTA is only ever a live
  // link when the handshake can genuinely complete. When arriving from the
  // Save-to-Pipeline signup wall, the intent (save_bid / next / plan) is carried
  // through OAuth `state` so the callback can complete the save after creation.
  const googleAuthUrl = useMemo(() => {
    if (!baseGoogleAuthUrl) return null;
    const url = new URL(baseGoogleAuthUrl);
    if (save_bid || next) {
      url.searchParams.set(
        "state",
        JSON.stringify({ save_bid: save_bid ?? null, next: safeNext(next), plan: selectedPlan }),
      );
    }
    return url.toString();
  }, [baseGoogleAuthUrl, save_bid, next, selectedPlan]);

  // LinkedIn OAuth start URL (relative — hits /api/linkedin/start, which sets a
  // CSRF nonce cookie and 302-redirects to LinkedIn). Carries the same
  // save-to-pipeline / plan intent as Google through LinkedIn's `state`. Only
  // meaningful when linkedInAuthUrl is non-null (LINKEDIN_CLIENT_ID configured).
  const linkedInStartUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (save_bid) p.set("save_bid", save_bid);
    const safeN = safeNext(next);
    if (safeN) p.set("next", safeN);
    p.set("plan", selectedPlan);
    const q = p.toString();
    return `/api/linkedin/start${q ? `?${q}` : ""}`;
  }, [save_bid, next, selectedPlan]);

  if (currentUser) return null;

  const planInfo = PLAN_OPTIONS.find((p) => p.slug === selectedPlan) ?? PLAN_OPTIONS[0];

  // ── Contextual signup header (Task B): when the visitor arrives from a
  // contextual entry point — a specific RFP/award (closing_soon ticker title, or
  // the incumbent gate carrying `title`), or a Contract Radar scan (?source=radar
  // / trade / cert / state) — name that context in the H1 instead of the generic
  // workflow headline. Deterministic + pure (derived only from URL search
  // params), so it renders identically in SSR and on the client's first paint.
  // The contract value, when genuinely carried in the URL (`value`), is formatted
  // from the REAL number only — never fabricated (formatEstimate returns null
  // unless a finite positive value is present).
  const bidTitle = (title || ticker_bid || "").trim();
  const hasBidContext = !!bidTitle;
  const radarContext = source === "radar" || !!(trade || cert || state);
  const estimate = formatEstimate(value);
  const contextualHeader = hasBidContext
    ? estimate
      ? `Sign up to track this ${estimate} ${bidTitle}`
      : `Sign up to track ${bidTitle}`
    : radarContext
      ? "Sign up to see your radar matches"
      : "";

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const formData = new FormData(e.currentTarget);
    const email = (formData.get("email") as string || "").trim().toLowerCase();
    const password = formData.get("password") as string || "";

    // Client-side validation short-circuit — mirror the server's /api/signup
    // checks (email format + password length) so a form that fails ITS OWN
    // validation never dispatches a network call. Keeps the exact same
    // user-facing message the server would return and avoids the loading
    // spinner. The server remains the authoritative second guard.
    const clientErrors: string[] = [];
    const invalidEmail = !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const invalidPassword = !password || password.length < 8;
    if (invalidEmail) {
      clientErrors.push("Please enter a valid email address.");
    }
    if (invalidPassword) {
      clientErrors.push("Password must be at least 8 characters.");
    }
    if (clientErrors.length > 0) {
      setError(clientErrors.join(" "));
      // Track the validation failure so failed submissions are visible in the
      // funnel. Structured payload { field, error } (owner spec): `field` is
      // email | password | multiple; `error` is the short human message.
      // The field also rides as a plain label for easy filtering; the full
      // {field,error} object is serialized via the same path "extra payload"
      // channel trackEvent already uses.
      const fieldErr =
        invalidEmail && invalidPassword ? "multiple" : invalidEmail ? "email" : "password";
      trackEvent(
        "signup_field_error",
        fieldErr,
        JSON.stringify({ field: fieldErr, error: clientErrors.join(" ") }),
      );
      return;
    }

    // Fire exactly once per submit — the button is disabled while loading, so
    // double-clicks can't double-fire.
    trackEvent("signup_submit");
    setLoading(true);

    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          confirmPassword: password,
          plan: selectedPlan,
          // Persistent per-visitor id — lets the server backfill this visitor's
          // anonymous funnel rows to the new account. Optional; never required.
          visitor_id: getOrCreateVisitorId(),
        }),
      });
      const json = await res.json() as {
        error?: string;
        success?: boolean;
        user?: { id?: number | string; email?: string };
      };
      if (!res.ok || json.error) {
        throw new Error(json.error || "Signup failed. Please try again.");
      }
      // Stamp the new user into the tracking layer so the signup_success event
      // (and every subsequent tracking call) carries their id+email.
      setTrackingUser(json.user ?? null);
      // Completed a signup — guarantee the abandonment beacon can never fire
      // for this visit (guarded in the pagehide/beforeunload listener).
      signupSucceededRef.current = true;
      trackEvent("signup_success");
      // Part B — the draft promise: persist the scored solicitation
      // server-side keyed to this new user BEFORE any redirect. Fail-open by
      // design — a persist failure must never block signup, the save-to-
      // pipeline intent, or the redirect to /onboarding. On failure the
      // sessionStorage carry survives, so the first /onboarding mount retries.
      await persistPendingDraft();
      if (save_bid) {
        // Save-to-pipeline intent: persist the bid to the new user's pipeline,
        // then land them where they were. The save must NEVER fail the signup —
        // the redirect happens whether or not the save succeeds.
        let savedOk = false;
        try {
          const saveRes = await fetch("/api/bids-save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bidId: Number(save_bid) }),
          });
          savedOk = saveRes.ok;
        } catch {
          savedOk = false;
        }
        if (savedOk) trackEvent("save_success", save_bid, next);
        window.location.assign(safeNext(next) ?? "/dashboard");
        return;
      }
      // New user, no save_bid intent. A radar-sourced signup lands DIRECTLY on
      // their saved matches: /dashboard surfaces the radar_seen matches via the
      // "your radar matches are ready to save" banner (RadarLoginNotify) — the
      // natural return-to-matches surface, not a blank onboarding. Any other
      // source goes to /onboarding, where profile setup → bid matches starts.
      // If a same-site `next` return path was provided (e.g. /awards or
      // /#closing-soon), latch it now so onboarding can route the user there
      // after they complete profile setup — mirroring how Google OAuth carries
      // `next` through state, and using the same sessionStorage pattern as the
      // pending-draft promise. Fail-open: a storage failure must never block
      // the redirect.
      storeRememberedNext(next);
      if (source === "radar") {
        navigate({ to: "/dashboard" });
      } else {
        navigate({ to: "/onboarding" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Signup failed. Please try again.";
      setError(msg);
      // Track the server-side signup failure so failed submissions are visible
      // in the funnel (distinct event from client-side field errors).
      trackEvent("signup_error", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-8">
          <a href="/" className="inline-flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900">
              <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
            <span className="text-xl font-bold tracking-tight text-slate-900">Contrax</span>
          </a>
        </div>

        {/* Ticker / contextual banner — generalized framing mechanism
            (SignupContextPanel). The closing_soon source (bid + deadline from
            a Closing Soon CTA, or a plain ticker deep-link) preserves PR #196
            exactly: urgency panel with live countdown when a deadline is
            carried, plain ticker panel otherwise. The incumbent source (from
            an Incumbent Intelligence gate CTA) renders the value-driven
            "unlock incumbent contract history & past pricing" banner — no
            countdown. */}
        {source === "radar" ? (
          <SignupContextPanel source="radar" radar={radarAnswers} matches={radarMatches ?? undefined} />
        ) : source === "incumbent" ? (
          <SignupContextPanel source="incumbent" title={title || ticker_bid} agency={agency || ticker_agency} />
        ) : ticker_bid ? (
          <SignupContextPanel source="closing_soon" title={ticker_bid} agency={ticker_agency} closingLabel={closingLabel} />
        ) : null}

        {/* Score contextual banner — arriving from the /score tool (Feature B) */}
        {score_rec && (
          <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm leading-relaxed text-blue-800">
              <span className="font-semibold">You scored a solicitation {score_rec}</span> —
              finish signing up to track it and get deadline alerts.
            </p>
          </div>
        )}

        {/* Save-to-Pipeline banner — arriving from a "⭐ Save to My Pipeline" click */}
        {save_bid && (
          <div className="mb-6 rounded-xl border-2 border-amber-300 bg-amber-50 p-5">
            <p className="text-sm font-semibold text-amber-800">
              ⭐ Save this opportunity to your Pipeline
            </p>
            <p className="mt-1 text-sm text-amber-700">
              Create your free account and this bid is saved to your pipeline
              automatically — no extra steps.
            </p>
          </div>
        )}

        {/* Card */}
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          {/* H1: the owner-ratified score-flow copy ("Get your Technical
              Approach in 60 seconds.") is restored as the score_rec variant —
              part B now delivers that promise (solicitation persisted at
              signup → draft fires on onboarding completion). Cold arrivals
              keep the honest workflow headline. */}
          <h1 className="text-2xl font-bold text-slate-900">
            {score_rec
              ? "Get your Technical Approach in 60 seconds."
              : contextualHeader || "Your government-contracting workflow starts here."}
          </h1>
          <p className="mt-1.5 text-sm text-gray-500">
            Start free on Basic — no credit card required. Your 14-day Professional trial begins on your first premium use.
          </p>

          {/* Social proof — live tracked-solicitation count (mirrors the homepage counter) */}
          {trackedBids > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Tracking {trackedBids.toLocaleString()} solicitations{openBids > 0 ? `, including ${openBids.toLocaleString()} currently open` : ""} — updated every 4 hours
            </p>
          )}

          {/* ONE-TAP PRIMARY — Continue with Google, gated at runtime. The big
              primary CTA only renders as a live link when the loader's
              getGoogleAuthUrl() returned a fully-configured URL (both
              GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET present). Otherwise it
              renders disabled with an honest reason — never a live-looking link
              to a handshake that would fail server-side. */}
          {googleAuthUrl ? (
            <a
              href={googleAuthUrl}
              className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl border-2 border-slate-900 bg-white px-6 py-4 text-base font-bold text-slate-900 shadow-md transition-all hover:bg-slate-50 hover:shadow-lg active:scale-[0.98]"
            >
              <svg className="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
                <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
              </svg>
              Continue with Google
            </a>
          ) : (
            <div className="mt-6 space-y-2">
              <button
                type="button"
                disabled
                title="Google sign-in is not configured right now"
                className="flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-xl border-2 border-gray-200 bg-gray-50 px-6 py-4 text-base font-bold text-gray-400"
              >
                <svg className="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#9AA0A6" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
                  <path fill="#9AA0A6" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
                  <path fill="#9AA0A6" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
                  <path fill="#9AA0A6" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
                </svg>
                Continue with Google
              </button>
              <p className="text-center text-xs text-gray-400">
                Google sign-up isn't available right now — you can still sign up with email &amp; password below.
              </p>
            </div>
          )}

          {/* Continue with LinkedIn — OAuth implemented, GATED until the owner
              supplies LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET. While the key
              is absent the button stays visible but disabled ("coming soon") and
              never produces a broken OAuth URL. The moment the env vars are set
              server-side the flow becomes active with no further code change. */}
          {linkedInAuthUrl ? (
            <a
              href={linkedInStartUrl}
              className="mt-3 flex w-full items-center justify-center gap-3 rounded-xl border border-gray-300 bg-white px-6 py-4 text-base font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow-md active:scale-[0.98]"
            >
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="#0A66C2" aria-hidden="true">
                <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 110-4.12 2.06 2.06 0 010 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
              </svg>
              Continue with LinkedIn
            </a>
          ) : (
            <button
              type="button"
              disabled
              title="LinkedIn sign-in is coming soon"
              className="mt-3 flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-6 py-4 text-base font-semibold text-gray-400"
            >
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="#0A66C2" aria-hidden="true">
                <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 110-4.12 2.06 2.06 0 010 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
              </svg>
              Continue with LinkedIn
              <span className="text-xs font-medium text-gray-400">— coming soon</span>
            </button>
          )}

          {/* Divider */}
          <div className="relative mt-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase tracking-wide text-gray-400">
              <span className="bg-white px-3">or</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} onFocus={handleSignupStart} className="mt-5 space-y-5" noValidate>
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              {/* ZERO-CARD REASSURANCE — large, unmissable badge right by the
                  email field. Plan-conditional: for the Basic/free tier we say
                  "100% Free Forever"; for a paid plan (starter/professional/
                  agency) we use honest 14-day trial framing instead so a paid
                  plan is never claimed to be free. Styling/placement identical
                  for both branches. */}
              <div className="mt-1.5 rounded-lg border border-emerald-300 bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white shadow-sm">
                {selectedPlan === "basic"
                  ? "🔒 100% Free Forever • Zero Credit Card Required"
                  : "🔒 Start your 14-day Professional trial • No card required"}
              </div>
              {/* Honest scope on the free forever claim — Basic is free and never
                  expires, but it is LIMITED: capped at 3 saved bids, with Incumbent
                  Intelligence / AI Match Scoring / Draft Tools paywalled behind
                  Professional. Kept small (text-xs) and only on the Basic branch so
                  the badge is never read as "everything is free". */}
              {selectedPlan === "basic" && (
                <p className="mt-1.5 text-xs text-gray-500">
                  Free forever — up to 3 saved bids. Incumbent Intelligence &amp; Draft Tools are on Professional.
                </p>
              )}
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                autoCapitalize="none"
                inputMode="email"
                className="mt-2 block w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="you@company.com"
              />
              {/* ANTI-SPAM MICRO-COPY */}
              <p className="mt-1.5 text-xs text-gray-500">
                No spam. Instant access to live federal solicitations.
              </p>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <div className="relative mt-1.5">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="new-password"
                  minLength={8}
                  className="block w-full rounded-lg border border-gray-300 px-4 py-3 pr-12 text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="At least 8 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98]"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Creating account...
                </span>
              ) : (
                // Honest CTA: no draft promise until the draft flow (part B) lands.
                "Create my free account →"
              )}
            </button>

            {/* Trial trust row — one visible line near the CTA. Communicates
                all three free/basic assurances: no card, free forever, and fast
                (takes under 30 seconds). Paid plans keep honest 14-day-trial
                framing instead of the "free forever" claim. */}
            <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-gray-500">
              <span>No credit card required</span>
              <span aria-hidden="true" className="text-gray-300">·</span>
              {selectedPlan === "basic" ? <span>Free forever</span> : <span>Trial starts on first premium use</span>}
              <span aria-hidden="true" className="text-gray-300">·</span>
              <span>Takes under 30 seconds</span>
              <span aria-hidden="true" className="text-gray-300">·</span>
              <span>Cancel anytime</span>
            </p>
          </form>
          {/* Plan selector — selectable cards. Cold arrivals default to Starter
              ($19/mo, the homepage promise); ?plan=professional intent links
              preselect Professional via the URL. selectedPlan feeds both the
              signup POST body and the Google OAuth state. */}
          <div className="mt-6 border-t border-gray-100 pt-5">
            <p className="text-sm font-semibold text-slate-900">Select your plan</p>
            <p className="mt-0.5 text-xs text-gray-500">
              Start free on Basic — no credit card required. Your 14-day Professional trial begins on your first premium use.
            </p>
            <div className="mt-2.5 space-y-2" role="radiogroup" aria-label="Plan">
              {PLAN_OPTIONS.map((opt) => {
                const isSelected = selectedPlan === opt.slug;
                // De-emphasize the paid tiers on the free flow (?plan=basic) so the
                // "Basic is free forever" path reads unmistakably free — the paid
                // cards stay selectable, just visually quieter with a PAID tag.
                const freeFlowPaidCard = plan === "basic" && opt.slug !== "basic";
                return (
                  <button
                    key={opt.slug}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelectedPlan(opt.slug)}
                    className={`w-full rounded-xl border p-4 text-left transition-all ${
                      isSelected
                        ? "border-blue-500 bg-blue-50/50 shadow-sm ring-1 ring-blue-500/30"
                        : freeFlowPaidCard
                          ? "border-gray-200 bg-gray-50/60 text-gray-500 opacity-80 hover:border-gray-300 hover:opacity-100"
                          : opt.featured
                            ? "border-amber-300 bg-white hover:border-amber-400 hover:bg-amber-50/40"
                            : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex flex-1 items-center gap-2 text-sm font-bold text-slate-900">
                        {opt.name}
                        {opt.slug === "basic" && (
                          <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                            Free forever
                          </span>
                        )}
                        {freeFlowPaidCard && (
                          <span className="inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                            Paid · 14-day Professional trial
                          </span>
                        )}
                      </span>
                      <span className="text-sm font-semibold text-slate-700">
                        ${opt.price}
                        <span className="text-xs font-normal text-gray-500">/mo</span>
                      </span>
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                          isSelected ? "border-blue-500 bg-blue-500" : "border-gray-300 bg-white"
                        }`}
                      >
                        {isSelected && (
                          <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {opt.bullets.map((b) => (
                        <li key={b} className="flex items-start gap-1.5 text-xs text-gray-600">
                          <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          {b}
                        </li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>
            {/* Selected plan — price clearly tied to the trial (Basic is free forever) */}
            <p className="mt-2.5 text-sm text-gray-500">
              {selectedPlan === "basic"
                ? "Basic — $0/mo, free forever"
                : `${planInfo.name} — $${planInfo.price}/mo after your 14-day Professional trial`}
            </p>
          </div>

          {/* What you get after setup — each item is delivered once the
              onboarding profile is saved (matched bids, AI summaries/scores,
              deadline alerts). Heading deliberately avoids a time promise. */}
          <ul className="mt-4 space-y-2 rounded-lg border border-gray-100 bg-slate-50 px-4 py-3">
            <li className="flex items-start gap-2 text-sm text-slate-700">
              <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Matched set-aside bids from {trackedBids > 0 ? `${trackedBids.toLocaleString()} tracked solicitations` : "thousands of tracked solicitations"}
            </li>
            <li className="flex items-start gap-2 text-sm text-slate-700">
              <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              AI bid summaries and win scores for every match
            </li>
            <li className="flex items-start gap-2 text-sm text-slate-700">
              <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Deadline alerts so you never miss a response
            </li>
          </ul>


        </div>

        {/* Footer link */}
        <p className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{" "}
          <a href="/login" className="font-semibold text-blue-600 hover:text-blue-500">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
