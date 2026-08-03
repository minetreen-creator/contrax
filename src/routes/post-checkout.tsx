/**
 * Post-checkout page — users land here after Stripe Checkout.
 *
 * Flow:
 *   1. `createCheckoutSession` sets success_url to
 *      /post-checkout?session_id=cs_xxx&plan=starter
 *   2. Stripe redirects the customer here after payment.
 *   3. This page resolves the checkout session via the Stripe API,
 *      creates/links the user account, sets the `contrax_session` cookie,
 *      and shows a branded transition before redirecting.
 *   4. If no session_id is present, shows a troubleshooting message.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { useEffect, useState, useCallback } from "react";

const SESSION_TTL_DAYS = 30;
const SESSION_COOKIE = "contrax_session";

// ── Plan Display Helpers ───────────────────────────────────────────────────────

const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  professional: "Professional",
  agency: "Agency",
  savings_premium: "Savings Premium",
};

function getPlanLabel(plan: string | undefined | null): string {
  if (!plan) return "Contrax";
  return PLAN_LABELS[plan] ?? plan.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isSavingsPlan(plan: string | undefined | null): boolean {
  return plan === "savings_premium";
}

function getRedirectTarget(plan: string | undefined | null): string {
  if (isSavingsPlan(plan)) return "/savings/dashboard";
  return "/dashboard?onboarding=true";
}

// ── Server Function: Resolve checkout session ──────────────────────────────────

interface ResolveResult {
  email: string;
  plan: string;
}

const resolveCheckoutSession = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (typeof data !== "object" || data === null) {
      throw new Error("Invalid request");
    }
    const { sessionId } = data as { sessionId: string };
    if (!sessionId || typeof sessionId !== "string") {
      throw new Error("Session ID is required");
    }
    return { sessionId };
  })
  .handler(async ({ data }): Promise<ResolveResult> => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) throw new Error("Stripe is not configured");

    // Dynamic import so Stripe stays out of the client bundle
    const StripeModule = await import("stripe");
    const Stripe = StripeModule.default;
    const stripe = new Stripe(stripeKey, {
      apiVersion: "2025-06-16.acacia",
    }) as {
      checkout: {
        sessions: {
          retrieve(
            id: string,
          ): Promise<{
            customer_details?: { email?: string | null } | null;
            metadata?: Record<string, string> | null;
          }>;
        };
      };
    };

    // Retrieve the Stripe Checkout Session
    const session = await stripe.checkout.sessions.retrieve(data.sessionId);

    const email = session.customer_details?.email?.trim().toLowerCase();
    if (!email) throw new Error("No customer email found in checkout session");

    const planTier = session.metadata?.plan_tier ?? null;

    // Look up or create user (idempotent — webhook may have already fired)
    const dbModule = await import("~/db");
    const db = dbModule.sql();

    const existing = await db`
      SELECT id, email, plan_tier FROM users WHERE email = ${email}
    `;

    let userId: number;

    if (existing.length > 0) {
      userId = existing[0].id as number;
      // Update plan_tier if the webhook didn't set it yet
      if (planTier && !existing[0].plan_tier) {
        await db`
          UPDATE users SET plan_tier = ${planTier}, subscription_status = 'active', trial_started_at = NULL
          WHERE id = ${userId}
        `;
      }
    } else {
      // Webhook hasn't fired yet — create user now
      const passwordHash = await Bun.password.hash(
        crypto.randomUUID() + crypto.randomUUID(),
      );
      const inserted = await db`
        INSERT INTO users (email, password_hash, subscription_status, plan_tier, trial_started_at)
        VALUES (${email}, ${passwordHash}, 'active', ${planTier}, NULL)
        RETURNING id
      `;
      userId = inserted[0].id as number;
    }

    // Create session token
    const token = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    await db`
      INSERT INTO sessions (user_id, token, expires_at)
      VALUES (${userId}, ${token}, ${expiresAt.toISOString()})
    `;

    // Set the session cookie
    setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    });

    return {
      email,
      plan: planTier ?? "starter",
    };
  });

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/post-checkout")({
  validateSearch: (search: Record<string, unknown>) => ({
    session_id:
      typeof search.session_id === "string" ? search.session_id : undefined,
    plan: typeof search.plan === "string" ? search.plan : undefined,
  }),
  component: PostCheckoutPage,
});

// ── Animated Loading Dots ──────────────────────────────────────────────────────

function LoadingDots({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-1.5">
        <span
          className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-bounce"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-bounce"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-bounce"
          style={{ animationDelay: "300ms" }}
        />
      </div>
      <p className="text-sm font-medium text-slate-600">{label}</p>
    </div>
  );
}

// ── Success Checkmark ──────────────────────────────────────────────────────────

function SuccessIcon() {
  return (
    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 ring-4 ring-green-50">
      <svg
        className="h-8 w-8 text-green-600"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5 13l4 4L19 7"
        />
      </svg>
    </div>
  );
}

// ── Page Component ─────────────────────────────────────────────────────────────

function PostCheckoutPage() {
  const { session_id, plan } = Route.useSearch();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [resolvedPlan, setResolvedPlan] = useState<string | undefined>(plan);
  const [resolvedEmail, setResolvedEmail] = useState<string>("");

  // Derive display info from plan
  const planLabel = getPlanLabel(resolvedPlan);
  const savingsProduct = isSavingsPlan(resolvedPlan);
  const redirectTarget = getRedirectTarget(resolvedPlan);

  const handleContinue = useCallback(() => {
    navigate({ to: redirectTarget });
  }, [navigate, redirectTarget]);

  useEffect(() => {
    if (!session_id) {
      setStatus("error");
      setErrorMessage(
        "No checkout session found. If you just completed payment, please check your email for a confirmation link, or contact support.",
      );
      return;
    }

    let cancelled = false;
    let redirectTimer: ReturnType<typeof setTimeout>;

    async function resolve() {
      try {
        const result = await resolveCheckoutSession({
          data: { sessionId: session_id! },
        });
        if (cancelled) return;
        setResolvedPlan(result.plan);
        setResolvedEmail(result.email);
        setStatus("success");

        // Auto-redirect after 1.5s
        redirectTimer = setTimeout(() => {
          navigate({ to: getRedirectTarget(result.plan) });
        }, 1500);
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Failed to set up your account. Please try again or contact support.",
        );
      }
    }

    resolve();

    return () => {
      cancelled = true;
      if (redirectTimer) clearTimeout(redirectTimer);
    };
  }, [session_id, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <a
            href="/"
            className="inline-flex items-center gap-2.5"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 shadow-md shadow-slate-900/20">
              <svg
                className="h-5 w-5 text-amber-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </span>
            <span className="text-xl font-bold tracking-tight text-slate-900">
              Contrax
            </span>
          </a>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-gray-200/80 bg-white p-8 shadow-xl shadow-gray-200/50">
          {/* Loading State */}
          {status === "loading" && (
            <div className="text-center">
              <div className="mb-6">
                <LoadingDots label="Setting up your account…" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">
                Welcome to Contrax
              </h1>
              <p className="mt-2 text-sm text-gray-500">
                Your payment is confirmed — we&rsquo;re preparing your{" "}
                {planLabel} dashboard.
              </p>
              {/* Progress bar */}
              <div className="mt-6 mx-auto h-1.5 w-48 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full animate-progress rounded-full bg-gradient-to-r from-blue-500 to-blue-600" />
              </div>
            </div>
          )}

          {/* Success State */}
          {status === "success" && (
            <div className="text-center">
              <div className="mb-5">
                <SuccessIcon />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">
                Welcome to Contrax{savingsProduct ? " Savings" : ""}!
              </h1>
              <p className="mt-2 text-sm text-gray-500">
                You&rsquo;re all set with{" "}
                <span className="font-semibold text-slate-700">
                  {planLabel}
                </span>
                {!savingsProduct && " — let's get your profile set up so we can find the right contracts for you."}
                {savingsProduct && " — start scanning your bills and finding savings."}
              </p>
              {resolvedEmail && (
                <p className="mt-2 text-xs text-gray-400">
                  Account: {resolvedEmail}
                </p>
              )}
              <p className="mt-4 text-xs text-gray-400">
                Redirecting you automatically…
              </p>
              <button
                type="button"
                onClick={handleContinue}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md active:scale-[0.98]"
              >
                {savingsProduct ? "Go to Savings Dashboard" : "Continue to Dashboard"}
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
              </button>
            </div>
          )}

          {/* Error State */}
          {status === "error" && (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                <svg
                  className="h-6 w-6 text-red-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>
              <h1 className="text-xl font-bold text-slate-900">
                Something went wrong
              </h1>
              <p className="mt-2 text-sm text-gray-500">{errorMessage}</p>
              <div className="mt-6 space-y-3">
                <a
                  href="/login"
                  className="block w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
                >
                  Go to login
                </a>
                <a
                  href="/signup"
                  className="block w-full rounded-xl border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Create account manually
                </a>
                <p className="text-xs text-gray-400">
                  Need help? Email us at{" "}
                  <a
                    href="mailto:minetreen@gmail.com"
                    className="text-blue-600 hover:text-blue-500"
                  >
                    minetreen@gmail.com
                  </a>
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-gray-400">
          &copy; {new Date().getFullYear()} Contrax. All rights reserved.
        </p>
      </div>
    </div>
  );
}
