import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { getCurrentUser } from "~/lib/auth";
import { getOrCreateVisitorId } from "~/lib/visitor";
import { getLinkedInAuthUrl } from "~/lib/linkedin-oauth";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth?client_id=620121676686-s30sb3gi91of9699fhhkp04t86b0jofi.apps.googleusercontent.com&redirect_uri=https://www.contrax.company/auth/google/callback&response_type=code&scope=openid%20email%20profile&access_type=offline&prompt=consent";

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/login")({
  loader: async () => ({
    currentUser: await getCurrentUser(),
    // LinkedIn is gated until LINKEDIN_CLIENT_ID is configured — see signup.
    linkedInAuthUrl: await getLinkedInAuthUrl(),
  }),
  component: LoginRoute,
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
      { property: "og:url", content: "https://www.contrax.company/login" },
      { property: "og:title", content: "Sign In to Contrax" },
      {
        property: "og:description",
        content:
          "Sign in to Contrax to find government contract opportunities, score bids, and draft stronger proposals with AI.",
      },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
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
      { name: "twitter:image", content: "https://www.contrax.company/logo-square.png" },
      { name: "twitter:image:alt", content: "Contrax — AI-powered government contract bidding platform" },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/login" }],
  }),
});

// ── Route Wrapper ─────────────────────────────────────────────────────────────

/**
 * Route wrapper: auth guard lives here so LoginPage's hooks always run in the
 * same order. The old guard sat BEFORE LoginPage's 4 useState hooks — when the
 * login submit set the session cookie and the loader revalidated, the same
 * mounted fiber re-rendered with currentUser present and the hook count
 * flipped 4 → 0 → React #300 ("Rendered fewer hooks"). The wrapper's own hooks
 * (useLoaderData + useNavigate) are unconditional, and it only mounts
 * LoginPage when the guard passes, so the hook count is constant either way.
 */
function LoginRoute() {
  const { currentUser, linkedInAuthUrl } = Route.useLoaderData();
  const navigate = useNavigate();

  // If already logged in, redirect to dashboard
  if (currentUser) {
    navigate({ to: "/dashboard" });
    return null;
  }

  return <LoginPage linkedInAuthUrl={linkedInAuthUrl} />;
}

// ── Page Component ────────────────────────────────────────────────────────────

function LoginPage({ linkedInAuthUrl }: { linkedInAuthUrl: string | null }) {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, visitor_id: getOrCreateVisitorId() }),
      });
      const json = await res.json() as { error?: string; success?: boolean };
      if (!res.ok || json.error) {
        throw new Error(json.error || "Login failed. Please try again.");
      }
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

            {/* Continue with LinkedIn — gated until LINKEDIN_CLIENT_ID exists */}
            {linkedInAuthUrl ? (
              <a
                href="/api/linkedin/start"
                className="mt-3 flex w-full items-center justify-center gap-3 rounded-xl border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow-md active:scale-[0.98]"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="#0A66C2" aria-hidden="true">
                  <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 110-4.12 2.06 2.06 0 010 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
                </svg>
                Continue with LinkedIn
              </a>
            ) : (
              <button
                type="button"
                disabled
                title="LinkedIn sign-in is coming soon"
                className="mt-3 flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-6 py-3 text-sm font-semibold text-gray-400"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="#0A66C2" aria-hidden="true">
                  <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 110-4.12 2.06 2.06 0 010 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
                </svg>
                Continue with LinkedIn
                <span className="text-xs font-medium text-gray-400">— coming soon</span>
              </button>
            )}

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
