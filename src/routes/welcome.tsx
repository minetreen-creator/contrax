import { createFileRoute } from "@tanstack/react-router";

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/welcome")({
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  component: Welcome,
});

// ── Page Component ────────────────────────────────────────────────────────────

function Welcome() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center px-4">
      <div className="max-w-lg w-full text-center">
        {/* Success icon */}
        <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-green-500/20 ring-4 ring-green-500/30">
          <svg
            className="h-10 w-10 text-green-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Welcome to Contrax!
        </h1>
        <p className="mt-4 text-lg text-blue-100/80">
          Your account is being set up. We&rsquo;ll send you a confirmation email
          shortly.
        </p>

        {/* Next steps card */}
        <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm">
          <h2 className="text-lg font-semibold text-white">What&rsquo;s next?</h2>
          <ul className="mt-6 space-y-4 text-left">
            {[
              {
                step: "1",
                title: "Complete your business profile",
                description:
                  "Tell us about your services, locations, and industries so we can find the best contract matches for you.",
              },
              {
                step: "2",
                title: "Explore your bid matches",
                description:
                  "Browse government contracts filtered by your profile. See plain-English summaries and key requirements at a glance.",
              },
              {
                step: "3",
                title: "Generate proposal drafts",
                description:
                  "Use AI to draft professional proposal responses tailored to each opportunity — saving you hours per submission.",
              },
            ].map((item) => (
              <li key={item.step} className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-sm font-bold text-amber-400">
                  {item.step}
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <p className="mt-0.5 text-sm text-blue-100/60">{item.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* CTA buttons */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="/dashboard"
            className="inline-flex items-center rounded-xl bg-amber-500 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 hover:shadow-xl hover:shadow-amber-500/30 active:scale-[0.98]"
          >
            Go to Dashboard
            <svg className="ml-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </a>
          <a
            href="/"
            className="inline-flex items-center rounded-xl px-6 py-3.5 text-base font-medium text-blue-100 transition-colors hover:text-white"
          >
            Back to Home
          </a>
        </div>

        <p className="mt-8 text-xs text-blue-100/40">
          Have questions?{" "}
          <a href="mailto:hello@contrax.company" className="underline hover:text-blue-100/60">
            Contact support
          </a>
        </p>
      </div>
    </div>
  );
}
