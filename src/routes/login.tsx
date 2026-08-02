import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { useState } from "react";
import { sql } from "~/db";
import { getCurrentUser, SESSION_COOKIE } from "~/lib/auth";

const SESSION_TTL_DAYS = 30;

// ── Server Functions ──────────────────────────────────────────────────────────

const loginFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (typeof data !== "object" || data === null) {
      throw new Error("Invalid request");
    }
    const { email, password } = data as { email: string; password: string };

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Please enter a valid email address.");
    }
    if (!password) {
      throw new Error("Password is required.");
    }

    return { email: email.trim().toLowerCase(), password };
  })
  .handler(async ({ data }) => {
    // Look up user
    const rows = await sql()`
      SELECT id, email, password_hash, created_at
      FROM users
      WHERE email = ${data.email}
    `;

    if (rows.length === 0) {
      throw new Error("Invalid email or password.");
    }

    const user = rows[0] as {
      id: number;
      email: string;
      password_hash: string;
      created_at: Date;
    };

    // Verify password
    const valid = await Bun.password.verify(data.password, user.password_hash);
    if (!valid) {
      throw new Error("Invalid email or password.");
    }

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

export const Route = createFileRoute("/login")({
  loader: () => getCurrentUser(),
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Sign In to Contrax" },
      {
        name: "description",
        content:
          "Sign in to Contrax to find government contract opportunities, score bids, and draft stronger proposals with AI.",
      },
      { name: "robots", content: "noindex, nofollow" },
      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://contrax.company/login" },
      { property: "og:title", content: "Sign In to Contrax" },
      {
        property: "og:description",
        content:
          "Sign in to Contrax to find government contract opportunities, score bids, and draft stronger proposals with AI.",
      },
      { property: "og:image", content: "https://contrax.company/og-image.svg" },
      { property: "og:image:type", content: "image/svg+xml" },
      { property: "og:image:alt", content: "Contrax — AI-powered government contract bidding platform" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Sign In to Contrax" },
      {
        name: "twitter:description",
        content:
          "Sign in to Contrax to find government contract opportunities, score bids, and draft stronger proposals with AI.",
      },
      { name: "twitter:image", content: "https://contrax.company/og-image.svg" },
      { name: "twitter:image:alt", content: "Contrax — AI-powered government contract bidding platform" },
    ],
    links: [{ rel: "canonical", href: "https://contrax.company/login" }],
  }),
});

// ── Page Component ────────────────────────────────────────────────────────────

function LoginPage() {
  const currentUser = Route.useLoaderData();
  const navigate = useNavigate();

  // If already logged in, redirect to dashboard
  if (currentUser) {
    navigate({ to: "/dashboard" });
    return null;
  }

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await loginFn({ data: { email, password } });
      navigate({ to: "/dashboard" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
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

        {/* Card */}
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Sign in to your Contrax account</h1>
          <p className="mt-2 text-sm text-gray-500">
            Sign in to your Contrax account.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="mt-1.5 block w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="Enter your password"
              />
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
                  Signing in...
                </span>
              ) : (
                "Sign in"
              )}
            </button>
          </form>
        </div>

        {/* Footer link */}
        <p className="mt-6 text-center text-sm text-gray-500">
          Don&rsquo;t have an account?{" "}
          <a href="/signup" className="font-semibold text-blue-600 hover:text-blue-500">
            Create one
          </a>
        </p>
      </div>
    </div>
  );
}
