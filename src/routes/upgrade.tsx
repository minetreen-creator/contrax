import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCurrentUser } from "~/lib/auth";
import { checkTrial } from "~/routes/dashboard";
import { redirectToCheckout } from "~/lib/checkout";
import { FoundingOffer } from "~/components/FoundingOffer";

const getStatus = createServerFn({ method: "GET" }).handler(async () => {
  const u = await getCurrentUser();
  return u ? checkTrial() : null;
});

export const Route = createFileRoute("/upgrade")({
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  loader: () => getStatus(),
  component: Upgrade,
});

// Yearly = 10 × monthly (2 months free); mirrors ANNUAL_UNIT_AMOUNTS in src/lib/stripe.ts.
const plans = [
  { id: "starter", name: "Starter", price: 19, yearly: 190 },
  { id: "professional", name: "Professional", price: 79, yearly: 790 },
  { id: "agency", name: "Agency", price: 199, yearly: 1990 },
];

function Upgrade() {
  const status = Route.useLoaderData();
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
          {status?.active
            ? `Your trial ends in ${status.daysLeft} day${status.daysLeft === 1 ? "" : "s"}${
                endsLabel ? ` (${endsLabel})` : ""
              }. Choose a plan to keep going.`
            : "Choose a plan to keep going."}
        </p>
        <FoundingOffer source="upgrade" />
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
                <h2 className="text-xl font-bold text-slate-900">{p.name}</h2>
                {interval === "month" ? (
                  <p className="mt-4 text-4xl font-extrabold text-slate-900">
                    ${p.price}
                    <span className="text-sm font-normal text-slate-500">/mo</span>
                  </p>
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
                <button
                  onClick={() => redirectToCheckout(p.id as any, { interval })}
                  className={`mt-8 w-full rounded-xl px-4 py-3 font-semibold text-white transition hover:opacity-90 ${
                    isCurrent ? "bg-amber-500" : "bg-slate-900 hover:bg-slate-800"
                  }`}
                >
                  {isCurrent ? "Subscribe now" : "Subscribe"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
