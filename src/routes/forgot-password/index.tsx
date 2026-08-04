import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/forgot-password/")({
  component: ForgotPasswordPage,
  head: () => ({
    meta: [
      { title: "Reset Your Password | Contrax" },
      { name: "description", content: "Forgot your Contrax password? Contact us for a manual reset." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function ForgotPasswordPage() {
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
          <h1 className="text-2xl font-bold text-slate-900">Reset your password</h1>
          <p className="mt-3 text-sm text-gray-600 leading-relaxed">
            Password resets are handled manually right now. Send an email to{" "}
            <a href="mailto:hello@contrax.company" className="font-semibold text-blue-600 hover:text-blue-500">
              hello@contrax.company
            </a>{" "}
            from the email address on your account, and we'll reset your password within one business day.
          </p>
          <p className="mt-4 text-sm text-gray-500">
            Automated self-service password resets are coming soon.
          </p>
        </div>

        {/* Footer link */}
        <p className="mt-6 text-center text-sm text-gray-500">
          <a href="/login" className="font-semibold text-blue-600 hover:text-blue-500">
            &larr; Back to sign in
          </a>
        </p>
      </div>
    </div>
  );
}
