import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { getCurrentUser } from "~/lib/auth";
import { trackEvent } from "~/lib/track";
import { sql } from "~/db";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth?client_id=620121676686-s30sb3gi91of9699fhhkp04t86b0jofi.apps.googleusercontent.com&redirect_uri=https://www.contrax.company/auth/google/callback&response_type=code&scope=openid%20email%20profile&access_type=offline&prompt=consent";

type ScoreRec = "GO" | "CAUTIOUS" | "NO-GO";

type SignupSearch = {
  plan?: string;
  ticker_bid?: string;
  ticker_agency?: string;
  score_rec?: ScoreRec;
};

const validPlans = ["starter", "professional", "agency"] as const;

type Plan = (typeof validPlans)[number];

// Plan facts mirror src/routes/pricing/index.tsx (prices $19/$79/$199 — live in Stripe).
const PLAN_OPTIONS: {
  slug: Plan;
  name: string;
  price: number;
  bullets: string[];
  featured?: boolean;
}[] = [
  {
    slug: "starter",
    name: "Starter",
    price: 19,
    bullets: [
      "SAM.gov bid matching (daily sync)",
      "AI-powered bid summaries",
      "Win probability scoring",
    ],
  },
  {
    slug: "professional",
    name: "Professional",
    price: 79,
    bullets: ["Unlimited bid tracking", "AI proposal drafting", "AI chat support"],
    featured: true,
  },
  {
    slug: "agency",
    name: "Agency",
    price: 199,
    bullets: ["Team roles & permissions", "Integration connectors", "Team collaboration tools"],
  },
];

// Live tracked-solicitation count for the social-proof line — mirrors the
// homepage counter (src/routes/index.tsx getBidStats). Returns 0 if the DB is
// unreachable so the page always renders; the component falls back to static
// truthful copy ("9,000+ tracked solicitations") when no live count is
// available.
const getTrackedBidCount = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const rows = await sql()`SELECT COUNT(*)::int AS count FROM bids`;
    return Number((rows[0] as any)?.count || 0);
  } catch {
    return 0;
  }
});

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>): SignupSearch => ({
    plan: typeof search.plan === "string" && validPlans.includes(search.plan as typeof validPlans[number]) ? search.plan : "professional",
    ticker_bid: typeof search.ticker_bid === "string" ? search.ticker_bid : undefined,
    ticker_agency: typeof search.ticker_agency === "string" ? search.ticker_agency : undefined,
    score_rec:
      search.score_rec === "GO" || search.score_rec === "CAUTIOUS" || search.score_rec === "NO-GO"
        ? (search.score_rec as ScoreRec)
        : undefined,
  }),
  loader: async () => ({
    currentUser: await getCurrentUser(),
    trackedBids: await getTrackedBidCount(),
  }),
  component: SignupPage,
  head: () => ({
    meta: [
      { title: "Create a Contrax Account" },
      {
        name: "description",
        content:
          "Create your Contrax account to discover government bids, analyze opportunities, and draft proposals.",
      },
      { name: "robots", content: "noindex, nofollow" },
      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.contrax.company/signup" },
      { property: "og:title", content: "Create a Contrax Account" },
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
      { name: "twitter:title", content: "Create a Contrax Account" },
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
  const { currentUser, trackedBids } = Route.useLoaderData();
  const navigate = useNavigate();
  const { plan, ticker_bid, ticker_agency, score_rec } = Route.useSearch();

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan>(plan);

  // Funnel: fire once when the page loads with the score_rec param (Feature B).
  const scoredViewFiredRef = useRef(false);
  useEffect(() => {
    if (score_rec && !scoredViewFiredRef.current) {
      scoredViewFiredRef.current = true;
      trackEvent("signup_view_with_score", score_rec);
    }
  }, [score_rec]);

  // If already logged in, redirect to dashboard (in an effect so hooks
  // always run in the same order on every render).
  useEffect(() => {
    if (currentUser) navigate({ to: "/dashboard" });
  }, [currentUser, navigate]);

  // Keep the selector in sync if the ?plan= search param changes (e.g. a
  // pricing page CTA navigates here while the component is mounted).
  useEffect(() => {
    setSelectedPlan(plan);
  }, [plan]);

  if (currentUser) return null;

  const planInfo = PLAN_OPTIONS.find((p) => p.slug === selectedPlan) ?? PLAN_OPTIONS[1];

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    // Fire exactly once per submit — the button is disabled while loading, so
    // double-clicks can't double-fire.
    trackEvent("signup_submit");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = (formData.get("email") as string || "").trim().toLowerCase();
    const password = formData.get("password") as string || "";
    const confirmPassword = formData.get("confirmPassword") as string || "";

    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, confirmPassword, plan: selectedPlan }),
      });
      const json = await res.json() as { error?: string; success?: boolean };
      if (!res.ok || json.error) {
        throw new Error(json.error || "Signup failed. Please try again.");
      }
      trackEvent("signup_success");
      navigate({ to: "/dashboard" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed. Please try again.");
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

        {/* Ticker contextual banner */}
        {ticker_bid && (
          <div className="mb-6 rounded-xl border-2 border-amber-300 bg-amber-50 p-5">
            <p className="text-sm font-semibold text-amber-800">
              Want to see the full details and generate a proposal draft for this contract?
            </p>
            <p className="mt-1 text-sm text-amber-700 line-clamp-2">
              <span className="font-medium">{ticker_agency ? `${ticker_agency} — ` : ""}</span>
              {ticker_bid}
            </p>
            <p className="mt-3 text-xs text-amber-600">
              Start your free trial below to unlock the full opportunity.
            </p>
          </div>
        )}

        {/* Score contextual banner — arriving from the /score tool (Feature B) */}
        {score_rec && (
          <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm leading-relaxed text-blue-800">
              <span className="font-semibold">You scored a solicitation {score_rec}</span> —
              finish signing up to track it and get deadline alerts.
            </p>
          </div>
        )}

        {/* Card */}
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Create your Contrax account</h1>

          {/* Social proof — live tracked-solicitation count (mirrors the homepage counter) */}
          {trackedBids > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Tracking {trackedBids.toLocaleString()} solicitations — updated every 4 hours
            </p>
          )}

          {/* Selected plan — price clearly tied to the trial */}
          <p className="mt-2 text-sm text-gray-500">
            {planInfo.name} — ${planInfo.price}/mo after your 21-day free trial
          </p>

          {/* What you get in the next 5 minutes */}
          <ul className="mt-4 space-y-2 rounded-lg border border-gray-100 bg-slate-50 px-4 py-3">
            <li className="flex items-start gap-2 text-sm text-slate-700">
              <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Matched set-aside bids from 9,000+ tracked solicitations
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

          {/* Plan selector */}
          <div className="mt-6">
            <p className="text-sm font-medium text-gray-700">Choose your plan</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {PLAN_OPTIONS.map((p) => {
                const selected = selectedPlan === p.slug;
                return (
                  <button
                    key={p.slug}
                    type="button"
                    onClick={() => setSelectedPlan(p.slug)}
                    aria-pressed={selected}
                    className={`relative rounded-xl border-2 p-3 text-left transition-all ${
                      selected
                        ? "border-blue-600 bg-blue-50/60 shadow-sm"
                        : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {p.featured && (
                      <span className="absolute -top-2 right-2 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
                        Recommended
                      </span>
                    )}
                    <span className="block text-sm font-bold text-slate-900">{p.name}</span>
                    <span className="mt-0.5 block text-lg font-extrabold text-slate-900">
                      ${p.price}
                      <span className="text-xs font-medium text-gray-500">/mo</span>
                    </span>
                    <ul className="mt-2 space-y-1.5">
                      {p.bullets.map((bullet) => (
                        <li key={bullet} className="flex items-start gap-1.5 text-xs text-gray-600">
                          <svg
                            className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${selected ? "text-blue-600" : "text-green-500"}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          {bullet}
                        </li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Continue with Google */}
            <a
              href={GOOGLE_AUTH_URL}
              className="mt-8 flex w-full items-center justify-center gap-3 rounded-xl border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow-md active:scale-[0.98]"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
                <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
              </svg>
              Continue with Google
            </a>

            {/* Divider */}
            <div className="relative mt-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase tracking-wide text-gray-400">
                <span className="bg-white px-3">or</span>
              </div>
            </div>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="mt-1.5 block w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="you@company.com"
              />
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

            {/* Confirm Password */}
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                Confirm password
              </label>
              <div className="relative mt-1.5">
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirm ? "text" : "password"}
                  required
                  autoComplete="new-password"
                  minLength={8}
                  className="block w-full rounded-lg border border-gray-300 px-4 py-3 pr-12 text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="Re-enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                >
                  {showConfirm ? (
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
                "Create account"
              )}
            </button>

            {/* Trial trust row — one visible line near the CTA */}
            <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-gray-500">
              <span>21-day free trial</span>
              <span aria-hidden="true" className="text-gray-300">·</span>
              <span>No credit card required</span>
              <span aria-hidden="true" className="text-gray-300">·</span>
              <span>Cancel anytime</span>
            </p>
          </form>
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
