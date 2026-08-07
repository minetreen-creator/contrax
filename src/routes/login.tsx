import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { useState } from "react";
import { sql } from "~/db";
import { getCurrentUser, SESSION_COOKIE } from "~/lib/auth";
import { verifyPassword } from "~/lib/password";

const SESSION_TTL_DAYS = 30;

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth?client_id=620121676686-s30sb3gi91of9699fhhkp04t86b0jofi.apps.googleusercontent.com&redirect_uri=https://www.contrax.company/auth/google/callback&response_type=code&scope=openid%20email%20profile&access_type=offline&prompt=consent";

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
    const valid = await verifyPassword(data.password, user.password_hash);
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
  loader: async () => ({
    currentUser: await getCurrentUser(),
  }),
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
      { property: "og:image", content: "https://contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
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
      { name: "twitter:image", content: "https://contrax.company/logo-square.png" },
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
              <p className="mt-1.5 text-right text-sm">
                <a href="/forgot-password" className="text-blue-600 hover:text-blue-500 font-medium">
                  Forgot password?
                </a>
              </p>
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
