import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCurrentUser } from "~/lib/auth";
import { checkTrial } from "~/routes/dashboard";
import { redirectToCheckout } from "~/lib/checkout";
import { PLAN_COPY, upgradeFeatures } from "~/lib/plan-features";
import { formatDollars, shortDate, tradePlace, type UpgradePitch } from "~/lib/upgrade-pitch";
import { HEAD_START_DAYS, headStartOpensLabel } from "~/lib/head-start";
import { STARTER_FIRST_MONTH_NOTE, STARTER_FIRST_MONTH_PRICE } from "~/lib/starter-offer";

const getStatus = createServerFn({ method: "GET" }).handler(async () => {
  const u = await getCurrentUser();
  if (!u) return { status: null, pitch: null };
  const { loadUpgradePitch } = await import("~/lib/upgrade-pitch.server");
  const [status, pitch] = await Promise.all([checkTrial(), loadUpgradePitch(u.id, u.created_at)]);
  return { status, pitch };
});

export const Route = createFileRoute("/upgrade")({
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  // A canceled Stripe checkout returns here with the plan it was for (#441).
  validateSearch: (search: Record<string, unknown>) => ({
    checkout: search.checkout === "cancelled" ? ("cancelled" as const) : undefined,
    plan: ["starter", "professional", "agency"].includes(String(search.plan)) ? String(search.plan) : undefined,
  }),
  loader: () => getStatus(),
  component: Upgrade,
});

// Yearly = 10 × monthly (2 months free); mirrors ANNUAL_UNIT_AMOUNTS in src/lib/stripe.ts.
const plans = [
  { id: "starter", name: "Starter", price: 19, yearly: 190 },
  { id: "professional", name: "Professional", price: 79, yearly: 790 },
  { id: "agency", name: "Agency", price: 199, yearly: 1990 },
] as const;

function Upgrade() {
  const { status, pitch } = Route.useLoaderData();
  const { checkout, plan } = Route.useSearch();
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [interval, setInterval] = useState<"month" | "year">("month");
  const endsLabel =
    status?.active && status.endsAt
      ? new Date(status.endsAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-16">
      <div className="mx-auto max-w-6xl">
        <a href="/dashboard" className="text-sm text-slate-500">
          ← Dashboard
        </a>
        <h1 className="mt-8 text-center text-3xl font-bold text-slate-900">
          Keep going with Contrax
        </h1>
        <p className="mt-3 text-center text-slate-600">
          {plan && checkout !== "cancelled" ? "Continue with your selected plan, or explore Contrax first." : status?.active
            ? `Your trial ends in ${status.daysLeft} day${status.daysLeft === 1 ? "" : "s"}${
                endsLabel ? ` (${endsLabel})` : ""
              }. Choose a plan to keep going.`
            : "Choose a plan to keep going."}
        </p>
        {checkout === "cancelled" && (
          <p role="status" className="mx-auto mt-6 max-w-3xl rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-center text-sm text-amber-900">
            Checkout was canceled. No payment was made. You can choose a plan below whenever you’re ready.
          </p>
        )}
        {plan && checkout !== "cancelled" && (
          <div className="mt-5 text-center">
            <p className="text-sm text-slate-600">Subscribing starts paid billing now. You can also continue without subscribing.</p>
            <a href="/radar?first_run=1" className="mt-3 inline-block font-semibold text-blue-700 underline">
              {status?.active ? "Explore my free trial first →" : "Continue without subscribing →"}
            </a>
          </div>
        )}
        {pitch && <YourMatches pitch={pitch} />}
        <div className="mt-8 flex justify-center">
          <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-full border border-slate-200 bg-white p-1 text-sm font-semibold shadow-sm">
            {(["month", "year"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={interval === v}
                onClick={() => setInterval(v)}
                className={`rounded-full px-4 py-1.5 transition ${
                  interval === v ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {v === "month" ? "Monthly" : "Yearly · 2 months free"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {plans.map((p) => {
            const isCurrent = status?.planTier === p.id;
            const wasSelected = plan === p.id;
            return (
              <div
                key={p.id}
                className={`relative rounded-2xl border bg-white p-7 shadow-sm ${
                  isCurrent
                    ? "border-amber-400 ring-2 ring-amber-400/30"
                    : "border-slate-200"
                }`}
              >
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-500 px-3 py-0.5 text-xs font-semibold text-white shadow-sm">
                    Your plan
                  </div>
                )}
                {wasSelected && <div className="mb-3 text-sm font-semibold text-amber-700">{checkout === "cancelled" ? "Your previous selection" : "Your selected plan"}</div>}
                <h2 className="text-xl font-bold text-slate-900">{p.name}</h2>
                <p className="mt-1 text-sm text-slate-600">{PLAN_COPY[p.id].description}</p>
                {interval === "month" ? (
                  <>
                    <p className="mt-4 text-4xl font-extrabold text-slate-900">
                      ${p.price}
                      <span className="text-sm font-normal text-slate-500">/mo</span>
                    </p>
                    {p.id === "starter" && <p className="mt-1 text-sm font-semibold text-emerald-700">{STARTER_FIRST_MONTH_NOTE}</p>}
                  </>
                ) : (
                  <>
                    <p className="mt-4 text-4xl font-extrabold text-slate-900">
                      ${p.yearly.toLocaleString("en-US")}
                      <span className="text-sm font-normal text-slate-500">/yr</span>
                    </p>
                    <p className="mt-1 text-sm text-emerald-700">
                      ${(p.price * 12).toLocaleString("en-US")} if paid monthly. You save ${(p.price * 2).toLocaleString("en-US")}.
                    </p>
                  </>
                )}
                {/* What the plan includes (owner 2026-10-19): the same list as /pricing. */}
                <ul className="mt-5 space-y-2 text-sm text-slate-700">
                  {upgradeFeatures(PLAN_COPY[p.id].features).map((f) => (
                    <li key={f} className="flex gap-2">
                      <span aria-hidden="true" className="text-emerald-600">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <button
                  disabled={pendingPlan !== null}
                  onClick={async () => {
                    setPendingPlan(p.id);
                    try { await redirectToCheckout(p.id, { interval }); }
                    finally { setPendingPlan(null); }
                  }}
                  className={`mt-8 w-full rounded-xl px-4 py-3 font-semibold text-white transition hover:opacity-90 ${
                    isCurrent ? "bg-amber-500" : "bg-slate-900 hover:bg-slate-800"
                  }`}
                >
                  {pendingPlan === p.id
                    ? "Opening secure checkout…"
                    : p.id === "starter" && interval === "month"
                      ? `Start Starter for $${STARTER_FIRST_MONTH_PRICE}`
                      : `Subscribe to ${p.name}`}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Owner 2026-10-19 (items 1, 2 and 5): what this account actually matched,
 * instead of a feature list. Real rows only; each part hides without data.
 */
function YourMatches({ pitch }: { pitch: UpgradePitch }) {
  const where = tradePlace(pitch);
  if (pitch.newMatches === 0 && !pitch.typicalAward) return null;
  return (
    <section className="mx-auto mt-8 max-w-3xl rounded-2xl border border-amber-300 bg-amber-50 p-6">
      {pitch.newMatches > 0 && (
        <>
          <h2 className="text-lg font-bold text-slate-900">
            Since you joined on {shortDate(pitch.since)}, {pitch.newMatches} new{" "}
            {pitch.newMatches === 1 ? "bid" : "bids"} matched {where}.
          </h2>
          <ul className="mt-3 space-y-2">
            {pitch.examples.map((b) => (
              <li key={b.id}>
                <a href={`/bid/${b.id}`} className="block rounded-lg border border-amber-200 bg-white px-3 py-2 hover:border-amber-400">
                  <span className="block truncate text-sm font-semibold text-slate-900">{b.title}</span>
                  <span className="block text-xs text-slate-500">
                    {b.agency || "Government buyer"}
                    {b.dueDate ? ` · due ${shortDate(b.dueDate)}` : ""}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      {pitch.headStart.count > 0 && (
        <p className="mt-4 text-sm font-semibold text-slate-800">
          🔒 {pitch.headStart.count} of {pitch.headStart.count === 1 ? "them is" : "them are"} still members-only. Paid plans
          open the official posting now; free accounts wait {HEAD_START_DAYS} days
          {pitch.headStart.nextOpens ? ` (the next one opens to them ${headStartOpensLabel(pitch.headStart.nextOpens)})` : ""}.
        </p>
      )}
      {pitch.typicalAward && (
        <p className="mt-3 text-sm text-slate-700">
          Recent federal contracts for {pitch.typicalAward.scope === "state" ? where : pitch.tradeLabel || "your trade"}{" "}
          were awarded at a median of <strong>{formatDollars(pitch.typicalAward.median)}</strong> ({pitch.typicalAward.count}{" "}
          awards, USAspending.gov). Starter is $19 a month.
        </p>
      )}
    </section>
  );
}
