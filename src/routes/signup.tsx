import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { useEffect, useState } from "react";
import { sql } from "~/db";
import { getCurrentUser, SESSION_COOKIE } from "~/lib/auth";
import { hashPassword } from "~/lib/password";

const SESSION_TTL_DAYS = 30;

type SignupSearch = { plan?: string; ticker_bid?: string; ticker_agency?: string };

const validPlans = ["starter", "professional", "agency"] as const;

// ── Server Functions ──────────────────────────────────────────────────────────

const signupFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (typeof data !== "object" || data === null) {
      throw new Error("Invalid request");
    }
    const { email, password, confirmPassword, plan } = data as {
      email: string;
      password: string;
      confirmPassword: string;
      plan?: string;
    };

    const errors: string[] = [];

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push("Please enter a valid email address.");
    }
    if (!password || password.length < 8) {
      errors.push("Password must be at least 8 characters.");
    }
    if (password !== confirmPassword) {
      errors.push("Passwords do not match.");
    }

    if (errors.length > 0) {
      throw new Error(errors.join(" "));
    }

    const validPlan = plan && ["starter", "professional", "agency"].includes(plan) ? plan : "starter";

    return { email: email.trim().toLowerCase(), password, plan: validPlan };
  })
  .handler(async ({ data }) => {
    // Check for duplicate email
    const existing = await sql()`SELECT id FROM users WHERE email = ${data.email}`;
    if (existing.length > 0) {
      throw new Error("An account with this email already exists.");
    }

    // Hash password and create user
    const passwordHash = await hashPassword(data.password);
    const inserted = await sql()`
      INSERT INTO users (email, password_hash, plan_tier, trial_started_at)
      VALUES (${data.email}, ${passwordHash}, ${data.plan}, NOW())
      RETURNING id, email, created_at
    `;
    const user = inserted[0] as { id: number; email: string; created_at: Date };

    // Create session token and set cookie
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await sql()`
      INSERT INTO sessions (user_id, token, expires_at)
      VALUES (${user.id}, ${token}, ${expiresAt.toISOString()})
    `;

    setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    });

    return {
      success: true,
      user: { id: user.id, email: user.email, created_at: String(user.created_at) },
    };
  });

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>): SignupSearch => ({
    plan: typeof search.plan === "string" && validPlans.includes(search.plan as typeof validPlans[number]) ? search.plan : "starter",
    ticker_bid: typeof search.ticker_bid === "string" ? search.ticker_bid : undefined,
    ticker_agency: typeof search.ticker_agency === "string" ? search.ticker_agency : undefined,
  }),
  loader: () => getCurrentUser(),
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
      { property: "og:url", content: "https://contrax.company/signup" },
      { property: "og:title", content: "Create a Contrax Account" },
      {
        property: "og:description",
        content:
          "Create your Contrax account to discover government bids, analyze opportunities, and draft proposals.",
      },
      { property: "og:image", content: "https://contrax.company/logo-square.png" },
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
      { name: "twitter:image", content: "https://contrax.company/logo-square.png" },
      { name: "twitter:image:alt", content: "Contrax — government contract bidding platform" },
    ],
    links: [{ rel: "canonical", href: "https://contrax.company/signup" }],
  }),
});

// ── Page Component ────────────────────────────────────────────────────────────

function SignupPage() {
  const currentUser = Route.useLoaderData();
  const navigate = useNavigate();
  const { plan, ticker_bid, ticker_agency } = Route.useSearch();

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // If already logged in, redirect to dashboard (in an effect so hooks
  // always run in the same order on every render).
  useEffect(() => {
    if (currentUser) navigate({ to: "/dashboard" });
  }, [currentUser, navigate]);

  if (currentUser) return null;

  const planLabel = plan === "professional" ? "Professional" : plan === "agency" ? "Agency" : "Starter";

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = (formData.get("email") as string || "").trim().toLowerCase();
    const password = formData.get("password") as string || "";
    const confirmPassword = formData.get("confirmPassword") as string || "";

    try {
      await signupFn({ data: { email, password, confirmPassword, plan } });
      navigate({ to: "/dashboard" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
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

        {/* Card */}
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Create your Contrax account</h1>
          <p className="mt-2 text-sm text-gray-500">
            {planLabel} plan — 21-day free trial. No credit card required.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                defaultValue={email}
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
