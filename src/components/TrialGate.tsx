/**
 * Reusable trial and plan-tier gating for Contrax product pages.
 *
 * <TrialGate> shows its children while the user is in their 14-day trial or on
 * a paid plan, and swaps in a full-screen upgrade prompt when the trial has
 * expired (restricted access).
 *
 * <PlanGate> gates content behind Professional ($79/mo) + Agency ($199/mo)
 * plans — Starter users and trial-only users see an upgrade screen instead.
 *
 * <TrialUpgradeCallout> is the gentler, inline reminder for pages we don't
 * want to fully gate (e.g. the workspace).
 */
import { useEffect, useState, type ReactNode } from "react";
import { checkTrial, TIER_ORDER, type TrialStatus } from "~/lib/trial";

export type PlanTier = "starter" | "professional" | "agency";

/**
 * Full-screen takeover shown when a user's plan doesn't include a premium
 * feature. Directs them to upgrade to the required tier.
 */
export function PlanUpgradeScreen({
  featureName,
  minTier = "professional",
}: {
  featureName: string;
  minTier?: PlanTier;
}) {
  const agencyOnly = minTier === "agency";
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-2xl" aria-hidden="true">
          🔒
        </span>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">
          {agencyOnly ? "Agency feature" : "Professional feature"}
        </h1>
        <p className="mt-3 text-slate-600">
          {agencyOnly ? (
            <>
              {featureName} is available on the <strong>Agency</strong> ($199/mo) plan — the
              tier for firms running multiple clients and large contract portfolios. Upgrade to
              unlock it, or keep exploring the rest of Contrax on your current plan.
            </>
          ) : (
            <>
              {featureName} is available on the <strong>Professional</strong> ($79/mo) and{" "}
              <strong>Agency</strong> ($199/mo) plans. Upgrade to unlock it, or keep exploring the
              rest of Contrax on your current plan.
            </>
          )}
        </p>
        <a
          href="/upgrade"
          className="mt-7 inline-flex rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700"
        >
          Upgrade your plan →
        </a>
        <p className="mt-4 text-xs text-slate-400">
          Starter is $19/mo · Professional is $79/mo · Agency is $199/mo
        </p>
      </div>
    </div>
  );
}

/**
 * Gates content behind a minimum plan tier.
 * - Default `minTier="professional"` (backwards compatible): Professional +
 *   Agency plans pass.
 * - `minTier="agency"`: only Agency ($199/mo) passes.
 * Renders children only when the user's plan_tier is at or above the required
 * tier; otherwise shows the PlanUpgradeScreen.
 *
 * While tier is loading renders children to avoid a flash — the gate snaps
 * into place once the server responds.
 */
export function PlanGate({
  children,
  featureName = "This feature",
  minTier = "professional",
}: {
  children: ReactNode;
  featureName?: string;
  minTier?: PlanTier;
}) {
  const [trial, setTrial] = useState<TrialStatus | null | undefined>(undefined);
  useEffect(() => {
    checkTrial()
      .then(setTrial)
      .catch(() => setTrial(null));
  }, []);
  // Still loading — show children to avoid flash
  if (trial === undefined) return <>{children}</>;
  // A user with an ACTIVE full-access grant passes every tier gate. (expired &&
  // fullAccess=true can never happen: computeTrialStatus drops fullAccess to
  // false once access_expires_at passes, so an expired grant cannot unlock
  // premium features.)
  if (trial?.fullAccess) return <>{children}</>;
  // At or above required tier AND not expired — allowed. The `!expired` guard
  // ensures a time-boxed per-user grant (access_expires_at) stops granting its
  // plan_tier premium features once the date passes: a grant user keeps
  // plan_tier set (e.g. 'professional'), so without this guard a Professional
  // grant would unlock premium features forever after expiry. Normal paying
  // users (subscription_status='active') have expired:false, so they are
  // unaffected; 14-day trial users grant premium only during the trial.
  // fullAccess is checked above and is unaffected (computeTrialStatus already
  // drops an expired full-access grant to fullAccess:false).
  if (trial?.planTier && !trial?.expired && (TIER_ORDER[trial.planTier] ?? 0) >= TIER_ORDER[minTier]) return <>{children}</>;
  // Below required tier — show upgrade screen
  return <PlanUpgradeScreen featureName={featureName} minTier={minTier} />;
}

/** Full-screen takeover shown when a user's trial has expired. */
export function TrialExpiredScreen() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <span
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl"
          aria-hidden="true"
        >
          ⏳
        </span>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Your trial has ended</h1>
        <p className="mt-3 text-slate-600">
          Subscribe to keep using Contrax — bid matching, AI scoring, proposal drafting, and
          deadline tracking stay available on every plan.
        </p>
        <a
          href="/upgrade"
          className="mt-7 inline-flex rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white transition hover:bg-slate-800"
        >
          View plans →
        </a>
        <p className="mt-4 text-xs text-slate-400">
          Plans start at $19/mo — no setup fees, cancel anytime.
        </p>
      </div>
    </div>
  );
}

/**
 * Gates a protected page behind trial status. Renders children while the
 * status is loading (avoids a flash) and while the user is in trial or on a
 * paid plan; renders <TrialExpiredScreen> when the trial has expired.
 */
export function TrialGate({ children }: { children: ReactNode }) {
  const [trial, setTrial] = useState<TrialStatus | null>(null);
  useEffect(() => {
    checkTrial().then(setTrial).catch(() => {});
  }, []);
  if (trial?.expired) return <TrialExpiredScreen />;
  return <>{children}</>;
}

/**
 * Gentle, non-blocking upgrade reminder for trial users. Renders nothing for
 * paid users or when trial status is still loading. Place it inside the page
 * container (e.g. above the main content).
 */
export function TrialUpgradeCallout() {
  const [trial, setTrial] = useState<TrialStatus | null>(null);
  useEffect(() => {
    checkTrial().then(setTrial).catch(() => {});
  }, []);
  if (!trial?.active) return null;
  const endLabel = trial.endsAt
    ? new Date(trial.endsAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "";
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <span>
        Your 14-day Professional trial ·{" "}
        <strong>
          {trial.daysLeft} day{trial.daysLeft === 1 ? "" : "s"} left
        </strong>
        {endLabel ? <span className="text-amber-700"> · ends {endLabel}</span> : null}
      </span>
      <a
        href="/upgrade"
        className="shrink-0 font-semibold text-blue-700 underline hover:text-blue-800"
      >
        Upgrade before it ends →
      </a>
    </div>
  );
}
