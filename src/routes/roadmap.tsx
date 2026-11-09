import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import { STATE_NAMES } from "~/lib/contract-map";
import { GAP_LABELS, money } from "~/lib/gap-map";
import { approachTiming } from "~/lib/prime-finder";
import {
  STAGE_TEXT,
  certSuggestions,
  commonGaps,
  milestoneDone,
  nextActions,
  ninetyDayPlan,
  progress,
  readiness,
  stageOf,
  type RoadmapInput,
} from "~/lib/roadmap";
import { SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { trackEvent } from "~/lib/track";

/**
 * /roadmap — your government contracting roadmap (owner 2026-11-09, "build the roadmap").
 * Built from the signed-in member's own profile plus Contrax data (src/lib/roadmap.ts): where they
 * stand, what to pursue now, certifications to check, agencies and primes to target, gaps, next 3
 * actions and a 90-day plan whose milestones they check off (saved to their account).
 */
const PROD_URL = "https://www.contrax.company";
const TITLE = "Your Government Contracting Roadmap | Contrax";
const DESC =
  "A personal plan to win government contracts: what to pursue now, which certifications to check, which agencies and prime contractors to target, and a 90-day plan built from your business profile.";

const getRoadmap = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { getCurrentUser } = await import("~/lib/auth");
    const user = await getCurrentUser();
    if (!user) return { signedIn: false as const, roadmap: null };
    const { loadRoadmap } = await import("~/lib/roadmap.server");
    return { signedIn: true as const, roadmap: await loadRoadmap(user.id) };
  } catch (e) {
    console.error("[roadmap] load failed:", e);
    return { signedIn: true as const, roadmap: null, failed: true };
  }
});

const saveMilestone = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const o = (d ?? {}) as { key?: unknown; done?: unknown };
    return { key: String(o.key ?? "").slice(0, 40), done: o.done === true };
  })
  .handler(async ({ data }) => {
    const { getCurrentUser } = await import("~/lib/auth");
    const user = await getCurrentUser();
    if (!user) return { ok: false };
    const { setMilestone } = await import("~/lib/roadmap.server");
    return { ok: await setMilestone(user.id, data.key, data.done) };
  });

export const Route = createFileRoute("/roadmap")({
  loader: () => getRoadmap(),
  component: () => (
    <>
      <SiteHeader />
      <RoadmapPage />
    </>
  ),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/roadmap` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
      { property: "og:site_name", content: "Contrax" },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/roadmap` }],
  }),
});

function RoadmapPage() {
  const d = Route.useLoaderData();
  if (!d.signedIn) return <Visitor />;
  if (!d.roadmap) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Your contracting roadmap</h1>
        <p className="mt-2 text-slate-700">
          {"failed" in d && d.failed
            ? "Your roadmap could not load just now. Please try again in a minute."
            : "Your roadmap is built from your business profile. Add your trade, the states you work in and a few details, and it fills in."}
        </p>
        <a href="/onboarding" className="mt-4 inline-block rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800">
          Set up my profile
        </a>
      </main>
    );
  }
  return <Roadmap r={d.roadmap} />;
}

function Visitor() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Your contracting roadmap</p>
      <h1 className="mt-1 text-3xl font-bold text-slate-900">A personal plan to win government contracts</h1>
      <p className="mt-3 text-slate-700">
        Built from your business profile and Contrax's data: where you stand, what to pursue now, which certifications could open set-aside work,
        which agencies and prime contractors to target, what you are missing, your next 3 actions and a 90-day plan you check off as you go.
      </p>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
        <li>Readiness: SAM.gov registration, NAICS codes, capability statement, past performance</li>
        <li>Your market: federal spending in your trade and state, the small-business share, the top buying agencies</li>
        <li>Primes that must subcontract to small businesses, and when to approach them</li>
        <li>A 90-day plan with milestones saved to your account</li>
      </ul>
      <a
        href="/signup?source=roadmap&next=%2Froadmap"
        onClick={() => trackEvent("roadmap_signup_click")}
        className="mt-6 inline-block rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800"
      >
        Create a free account to get my roadmap
      </a>
      <p className="mt-2 text-xs text-slate-500">Already have an account? <a href="/login?next=%2Froadmap" className="font-semibold text-blue-700">Sign in</a></p>
    </main>
  );
}

export function Roadmap({ r }: { r: RoadmapInput }) {
  const [done, setDone] = useState<string[]>(r.done);
  const items = readiness(r.profile, r.trade);
  const stage = stageOf(items, r.picks);
  const plan = ninetyDayPlan(items, r.trade, r.state);
  const next = nextActions(plan, done);
  const prog = progress(plan, done);
  const trade = r.trade ? SEO_TRADE_BY_SLUG[r.trade] : null;
  const stateName = r.state ? STATE_NAMES[r.state] : null;
  const gaps = commonGaps(r.picks);
  const certs = certSuggestions(r.profile);
  const q = r.trade && r.state ? `?trade=${r.trade}&state=${r.state}` : "";

  const toggle = async (key: string, value: boolean) => {
    setDone((prev) => (value ? [...prev, key] : prev.filter((k) => k !== key)));
    trackEvent("roadmap_milestone", `${key}:${value ? "done" : "undone"}`);
    try {
      const res = await saveMilestone({ data: { key, done: value } });
      if (!res.ok) setDone((prev) => (value ? prev.filter((k) => k !== key) : [...prev, key]));
    } catch {
      setDone((prev) => (value ? prev.filter((k) => k !== key) : [...prev, key]));
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Your contracting roadmap</p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{r.profile.businessName || "Your business"}</h1>
        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">{STAGE_TEXT[stage].title}</span>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {STAGE_TEXT[stage].detail}
        {trade && stateName ? ` Built for ${trade.label.toLowerCase()} in ${stateName}.` : ""}
      </p>
      <div className="mt-3 max-w-md">
        <div className="h-2 rounded-full bg-slate-200">
          <div className="h-2 rounded-full bg-emerald-600" style={{ width: `${Math.round((100 * prog.done) / prog.total)}%` }} />
        </div>
        <p className="mt-1 text-xs text-slate-500">{prog.done} of {prog.total} milestones done</p>
      </div>

      <section className="mt-6 rounded-2xl border-2 border-slate-900 bg-white p-5">
        <h2 className="text-lg font-bold text-slate-900">Your next 3 actions</h2>
        {next.length ? (
          <ol className="mt-2 space-y-2">
            {next.map((m, i) => (
              <li key={m.key} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{i + 1}</span>
                <div className="text-sm">
                  {m.href ? (
                    <a href={m.href} className="font-semibold text-slate-900 underline decoration-slate-300 hover:decoration-slate-900">{m.label}</a>
                  ) : (
                    <span className="font-semibold text-slate-900">{m.label}</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-slate-700">Every milestone is done. Keep bidding, and keep adding each new job to your past performance.</p>
        )}
      </section>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-bold text-slate-900">Readiness</h2>
          <ul className="mt-2 space-y-2">
            {items.map((i) => (
              <li key={i.key} className="text-sm">
                <span className={`mr-2 font-bold ${i.status === "done" ? "text-emerald-700" : i.status === "warn" ? "text-amber-700" : "text-red-700"}`}>
                  {i.status === "done" ? "✓" : i.status === "warn" ? "!" : "✗"}
                </span>
                <a href={i.href} className="font-semibold text-slate-900 hover:underline">{i.label}</a>
                <p className="ml-5 text-xs text-slate-600">{i.detail}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-bold text-slate-900">Pursue now</h2>
          {r.picks.length ? (
            <ul className="mt-2 space-y-2">
              {r.picks.map((p) => (
                <li key={p.bidId} className="text-sm">
                  <span className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${p.decision === "pursue" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"}`}>
                    {p.decision === "pursue" ? "PURSUE" : "PARTNER"} · {p.fit}%
                  </span>
                  <a href={`/bid/${p.bidId}`} className="font-semibold text-blue-700 hover:underline">{p.title}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-700">
              Auto-Pilot reads each morning's new bids for members and puts the strong fits here and at the top of the 6 AM email.{" "}
              <a href="/radar" className="font-semibold text-blue-700">Search open bids now →</a>
            </p>
          )}
          {gaps.length ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">What bids keep asking for</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
                {gaps.map((g) => (
                  <li key={g.item}>{g.item}{g.times > 1 ? ` (${g.times} bids)` : ""}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section id="agencies" className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-bold text-slate-900">Your market{stateName ? ` in ${stateName}` : ""}</h2>
          {r.market && trade ? (
            <>
              <p className="mt-2 text-sm text-slate-700">
                Federal agencies spent <strong>{money(r.market.spend)}</strong> on {trade.label.toLowerCase()} here last fiscal year;{" "}
                <strong>{Math.round(r.market.setAsideShare * 100)}%</strong> was set aside for small businesses.{" "}
                <strong>{r.market.ending12}</strong> contracts end in the next 12 months.
                {r.market.label ? ` Rated: ${GAP_LABELS[r.market.label].text} (${GAP_LABELS[r.market.label].detail.toLowerCase()}).` : ""}
              </p>
              {r.market.topAgencies.length ? (
                <>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Agencies to target</p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {r.market.topAgencies.map((a) => (
                      <li key={a.name} className="flex justify-between gap-2">
                        <span>{a.name}</span>
                        <span className="text-slate-500">{money(a.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <a href={`/gap-map?trade=${r.trade}`} className="mt-3 inline-block text-sm font-semibold text-blue-700">Compare states on the gap map →</a>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-700">
              Set your trade and a state in your <a href="/onboarding" className="font-semibold text-blue-700">profile</a> to see federal spending, the small-business share and the top buyers.
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-bold text-slate-900">Primes to approach</h2>
          {r.primes.length ? (
            <>
              <ul className="mt-2 space-y-2">
                {r.primes.map((p) => (
                  <li key={p.name} className="text-sm">
                    <p className="font-semibold text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-600">{money(p.value)} active{p.agencies[0] ? ` · ${p.agencies[0]}` : ""}</p>
                    <p className="text-xs text-emerald-700">{approachTiming(p.nextEnd).label}</p>
                  </li>
                ))}
              </ul>
              <a href={`/prime-finder${q}`} className="mt-3 inline-block text-sm font-semibold text-blue-700">See every prime and draft intro emails →</a>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-700">
              {trade && stateName ? `No prime with a subcontracting plan holds ${trade.label.toLowerCase()} work in ${stateName} right now.` : "Set your trade and a state to see the primes holding work near you."}{" "}
              <a href={`/prime-finder${q}`} className="font-semibold text-blue-700">Open the prime finder →</a>
            </p>
          )}
        </section>
      </div>

      <section id="certifications" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-bold text-slate-900">Certifications to check</h2>
        <p className="mt-1 text-sm text-slate-600">
          {r.market ? `${Math.round(r.market.setAsideShare * 100)}% of the federal ${trade?.label.toLowerCase() ?? ""} spending in ${stateName} went to small-business set-asides. ` : ""}
          A certification lets you compete for the share set aside for it. Check these only if you qualify; Contrax does not decide eligibility.
        </p>
        {certs.length ? (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {certs.map((c) => (
              <li key={c.code} className="rounded-xl border border-slate-200 p-3 text-sm">
                <a href={c.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 hover:underline">{c.name}</a>
                <p className="mt-1 text-xs text-slate-600">For businesses {c.who}. Opens {c.unlocks}.</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-700">You hold every certification on our list.</p>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-bold text-slate-900">Your 90-day plan</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {plan.map((ph) => (
            <div key={ph.title}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{ph.days}</p>
              <p className="font-semibold text-slate-900">{ph.title}</p>
              <ul className="mt-2 space-y-2">
                {ph.milestones.map((m) => {
                  const isDone = milestoneDone(m, done);
                  return (
                    <li key={m.key} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={isDone}
                        disabled={m.auto}
                        onChange={(e) => toggle(m.key, e.target.checked)}
                        className="mt-1 h-4 w-4"
                        aria-label={m.label}
                      />
                      <span className={isDone ? "text-slate-400 line-through" : "text-slate-800"}>
                        {m.href ? <a href={m.href} className="hover:underline">{m.label}</a> : m.label}
                        {m.auto ? <span className="ml-1 text-[11px] text-emerald-700">(from your profile)</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <p id="debrief" className="mt-4 text-xs text-slate-500">
          A debrief is the buyer's explanation of how your bid was scored. On negotiated federal contracts the agency must give one if you ask in writing
          within 3 days of being told the result (FAR 15.506); on smaller purchases, ask for an explanation anyway. It is the fastest way to win the next one.
        </p>
      </section>
    </main>
  );
}
