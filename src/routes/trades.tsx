import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createServerFn } from "@tanstack/react-start";
import { setAsidePred } from "~/lib/open-bids";
import { trackEvent } from "~/lib/track";

/**
 * /trades — interactive one-question lead funnel for Facebook-derived traffic.
 *
 * Three steps on ONE page (client-side state machine, no page reloads):
 *   1. "What is your primary trade or set-aside?" — five large tap-target
 *      buttons (SDVOSB / 8(a) / WOSB / HUBZone / Small Business).
 *   2. Instant flash: "Found N Active {Cert} Solicitations closing this
 *      month." — N comes from a server-side precomputed count map (see
 *      getTradesData below), so tapping shows the REAL live count with zero
 *      extra network round-trip. The count is never hardcoded.
 *   3. Email lock → "Reveal My Bids" reveals the REAL matching solicitations
 *      closing this month (title, agency, close date, source link).
 *
 * HONESTY CONSTRAINTS (owner-directed):
 *   - No fabricated counts: every number traces to the live `bids` table.
 *   - "Closing this month" = due_date strictly in the future (due_date > NOW(),
 *     the app's open-bid semantics used by getPerCertCounts / getRecentBids)
 *     AND due_date before the first instant of the next calendar month.
 *   - Deduped on the natural key (title, agency) exactly like the app's other
 *     per-cert count surfaces (PR #171/#172), so multi-source sync duplicates
 *     cannot inflate the number.
 *   - "Small Business" = every row with a set_aside, matching getPerCertCounts:
 *     a federal set-aside is by definition reserved for small business, so all
 *     set-aside solicitations ARE small-business competitions. Unrestricted
 *     (NULL set_aside) full-and-open rows are deliberately NOT counted.
 *   - If a cert has 0 closing this month, the flash honestly says "Found 0..."
 *     with a graceful fallback line — never inflated.
 */

// ── Server: precomputed per-cert monthly counts (SSR once, instant on tap) ──
const CERT_IDS = ["sdvosb", "8a", "wosb", "hubzone", "sb"] as const;
export type CertId = (typeof CERT_IDS)[number];

// Shared month window: strictly-future deadlines inside the CURRENT calendar
// month. `due_date > NOW()` matches the app-wide open-bid semantics; the upper
// bound (< first instant of next month) keeps the count honest to "this month".
const MONTH_WINDOW_SQL = `
  due_date > NOW()
  AND due_date < date_trunc('month', NOW()) + interval '1 month'
`;

/** Set-aside predicate for a cert, mirrored from setAsidePred; "sb" = ALL set-asides. */
function certPred(cert: CertId, sql: any) {
  if (cert === "sb") {
    // Small Business = every set-aside row (see header comment).
    return sql().unsafe(`AND set_aside IS NOT NULL`);
  }
  return setAsidePred(cert, sql);
}

const getTradesData = createServerFn({ method: "GET" }).handler(async () => {
  const { sql } = await import("~/db");
  const counts: Partial<Record<CertId, number>> = {};
  try {
    await Promise.all(
      CERT_IDS.map(async (cert) => {
        const rows = await sql()`
          SELECT COUNT(*)::int AS n FROM (
            SELECT DISTINCT ON (title, agency) id
            FROM bids
            WHERE ${sql().unsafe(MONTH_WINDOW_SQL)} ${certPred(cert, sql)}
            ORDER BY title, agency
          ) d
        `;
        counts[cert] = Number((rows as any)[0]?.n ?? 0);
      }),
    );
  } catch {
    // bids table unavailable — zeroed counts keep the page honest (Found 0...)
    // rather than fabricated numbers or a broken SSR.
    for (const cert of CERT_IDS) counts[cert] = 0;
  }
  return {
    counts: counts as Record<CertId, number>,
    monthLabel: new Date().toLocaleString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
  };
});

const getCertClosingBids = createServerFn({ method: "POST" })
  .validator((d: unknown) => ({ cert: String((d as any)?.cert ?? "") }))
  .handler(async ({ data }) => {
    const cert = data.cert as CertId;
    if (!CERT_IDS.includes(cert as any)) return [];
    const { sql } = await import("~/db");
    try {
      const rows = await sql()`
        SELECT id, title, agency, due_date, source_url, set_aside
        FROM (
          SELECT DISTINCT ON (title, agency)
                 id, title, agency, due_date, source_url, set_aside, created_at
          FROM bids
          WHERE ${sql().unsafe(MONTH_WINDOW_SQL)} ${certPred(cert, sql)}
          ORDER BY title, agency, created_at DESC NULLS LAST
        ) t
        ORDER BY t.due_date ASC NULLS LAST
        LIMIT 50
      `;
      return (rows as any[]).map((r) => ({
        id: Number(r.id),
        title: String(r.title ?? ""),
        agency: r.agency ? String(r.agency) : null,
        due_date: r.due_date ? String(r.due_date) : null,
        source_url: r.source_url ? String(r.source_url) : null,
        set_aside: r.set_aside ? String(r.set_aside) : null,
      }));
    } catch {
      return []; // never break the reveal with a DB failure — honest empty list
    }
  });

// ── Route ─────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/trades")({
  loader: () => getTradesData(),
  component: TradesLanding,
  head: () => ({
    meta: [
      { title: "What's Your Trade? Live Set-Aside Solicitations | Contrax" },
      {
        name: "description",
        content:
          "See live 8(a), SDVOSB, WOSB, HUBZone and Small Business set-aside solicitations closing this month — real counts straight from federal procurement sources.",
      },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: "Live Set-Aside Solicitations Closing This Month | Contrax" },
      {
        property: "og:description",
        content:
          "Pick your certification and see the real count of active set-aside solicitations closing this month.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Live Set-Aside Solicitations Closing This Month | Contrax" },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/trades" }],
  }),
});

// ── Funnel option definitions ─────────────────────────────────────────────────
// display label EXACTLY as users read it (owner spec).
const OPTIONS: { id: CertId; label: string; hint?: string }[] = [
  { id: "sdvosb", label: "SDVOSB", hint: "Service-Disabled Veteran-Owned" },
  { id: "8a", label: "8(a)", hint: "SBA 8(a) Business Development" },
  { id: "wosb", label: "WOSB", hint: "Women-Owned Small Business" },
  { id: "hubzone", label: "HUBZone", hint: "Historically Underutilized Business Zone" },
  { id: "sb", label: "Small Business", hint: "Small-Business Set-Asides" },
];

type Step = 1 | 2 | 3;
type RevealState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; bids: ClosingBid[] }
  | { status: "error" };

type ClosingBid = {
  id: number;
  title: string;
  agency: string | null;
  due_date: string | null;
  source_url: string | null;
  set_aside: string | null;
};

function TradesLanding() {
  const { counts, monthLabel } = Route.useLoaderData();
  const [step, setStep] = useState<Step>(1);
  const [cert, setCert] = useState<(typeof OPTIONS)[number] | null>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<RevealState>({ status: "idle" });

  const [flashTimer, setFlashTimer] = useState<number | null>(null);
  useEffect(() => {
    return () => {
      if (flashTimer) window.clearTimeout(flashTimer);
    };
  }, [flashTimer]);
  const selectCert = (opt: (typeof OPTIONS)[number]) => {
    trackEvent("fb_funnel_cert_selected", opt.label); // fire-and-forget
    setCert(opt);
    setStep(2);
    if (flashTimer) window.clearTimeout(flashTimer);
    const t = window.setTimeout(() => setStep(3), 1900);
    setFlashTimer(t);
  };
  const count = cert ? counts[cert.id] : 0;

  const submitReveal = () => {
    if (!cert) return;
    trackEvent("fb_funnel_reveal_clicked", cert.label);
    // Client-side format check FIRST — short-circuit before any network call.
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setEmailError("Please enter a valid work email — e.g. name@company.com.");
      return;
    }
    setEmailError(null);
    fireAndForget(() => trackEvent("fb_funnel_email_submitted", cert.label));
    setReveal({ status: "loading" });
    getCertClosingBids({ data: { cert: cert.id } })
      .then((bids) => setReveal({ status: "done", bids }))
      .catch(() => setReveal({ status: "error" }));
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 py-8">
        {/* Minimal brand mark — no heavy nav (owner: minimal chrome) */}
        <a
          href="/"
          onClick={() => trackEvent("hero_cta_click", "trades_logo")}
          className="self-start text-sm font-bold tracking-tight text-amber-400 hover:text-amber-300"
        >
          ⬢ CONTRAX
        </a>

        {step === 1 && (
          <section className="flex flex-1 flex-col justify-center py-10">
            <h1 className="text-2xl font-bold leading-tight text-white sm:text-3xl">
              What is your primary trade or set-aside?
            </h1>
            <p className="mt-3 text-sm text-slate-300">
              Tap your certification to see live solicitations reserved for your
              business — closing this month.
            </p>
            <div role="list" className="mt-8 flex flex-col gap-3">
              {OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="listitem"
                  onClick={() => selectCert(opt)}
                  className="group w-full rounded-2xl border-2 border-slate-700 bg-slate-900 px-6 py-5 text-left transition-all hover:border-amber-500 hover:bg-slate-800 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                  aria-label={`${opt.label}${opt.hint ? ` — ${opt.hint}` : ""}`}
                >
                  <span className="flex w-full items-center justify-between">
                    <span className="text-lg font-semibold text-white">
                      {opt.label}
                      {opt.hint && (
                        <span className="mt-0.5 block text-xs font-normal text-slate-400">
                          {opt.hint}
                        </span>
                      )}
                    </span>
                    <span className="text-amber-500 transition-transform group-hover:translate-x-1">
                      →
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-6 text-center text-xs text-slate-500">
              Real counts from live federal &amp; state solicitations — updated
              every 4 hours.
            </p>
          </section>
        )}

        {step === 2 && cert && (
          <section
            className="flex flex-1 flex-col justify-center py-10"
            aria-live="polite"
          >
            <div className="rounded-2xl border-2 border-amber-500 bg-amber-500/10 px-6 py-12 text-center">
              <p className="text-3xl font-extrabold tracking-tight text-amber-400 sm:text-4xl">
                Found {count.toLocaleString("en-US")} Active {cert.label}{" "}
                Solicitations closing this month.
              </p>
              {count === 0 && (
                <p className="mt-3 text-sm text-slate-300">
                  No {cert.label} solicitations are closing this month right
                  now. New opportunities sync continuously — check back soon,
                  or pick another certification.
                </p>
              )}
            </div>
            <p className="mt-4 text-center text-xs text-slate-500">
              {monthLabel} · live from the {`bids`} database
            </p>
          </section>
        )}

        {step === 3 && cert && (
          <section className="flex flex-1 flex-col justify-center py-10">
            <h2 className="text-xl font-bold text-white sm:text-2xl">
              Enter your work email to view and track these{" "}
              {count.toLocaleString("en-US")} bids:
            </h2>
            <form
              className="mt-6 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                submitReveal();
              }}
            >
              <label htmlFor="trades-email" className="sr-only">
                Work email
              </label>
              <input
                id="trades-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError(null);
                }}
                className="w-full rounded-2xl border-2 border-slate-700 bg-slate-900 px-5 py-4 text-base text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              />
              {emailError && (
                <p className="text-sm font-medium text-amber-400" role="alert">
                  {emailError}
                </p>
              )}
              <button
                type="submit"
                className="w-full rounded-2xl bg-amber-500 px-6 py-4 text-base font-bold text-slate-950 shadow-lg transition-all hover:bg-amber-400 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              >
                Reveal My Bids →
              </button>
            </form>
            <p className="mt-3 text-center text-xs text-slate-400">
              No spam. We'll only send you the solicitations you ask for.
            </p>

            {reveal.status === "loading" && (
              <p className="mt-8 text-center text-sm text-slate-300" aria-live="polite">
                Loading your real {count.toLocaleString("en-US")} solicitations…
              </p>
            )}
            {reveal.status === "error" && (
              <p className="mt-8 text-center text-sm text-amber-400" role="alert">
                We couldn't load the list right now — please try again.
              </p>
            )}
            {reveal.status === "done" && <RevealList cert={cert} bids={reveal.bids} count={count} />}
          </section>
        )}
      </div>
    </main>
  );
}

function RevealList({
  cert,
  bids,
  count,
}: {
  cert: (typeof OPTIONS)[number];
  bids: ClosingBid[];
  count: number;
}) {
  // The server list is capped at 50 rows; the flash already disclosed the true
  // count — the list header states it honestly and the footer says the rest are
  // available in the app.
  const fmtDue = (d: string | null) => {
    if (!d) return null;
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return null;
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    });
  };
  return (
    <div className="mt-8">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Real {cert.label} solicitations closing this month
        </h3>
        <span className="text-sm font-semibold text-amber-400">
          {count.toLocaleString("en-US")} found
        </span>
      </div>
      <ul className="mt-3 flex flex-col gap-2.5">
        {bids.length === 0 && (
          <li className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-5 py-6 text-center text-sm text-slate-300">
            Nothing is closing this month right now — new solicitations sync
            continuously, so check back soon.
          </li>
        )}
        {bids.map((b) => {
          const due = fmtDue(b.due_date);
          const titleEl = (
            <span className="line-clamp-2 text-sm font-semibold text-white">
              {b.title || "Solicitation"}
            </span>
          );
          return (
            <li
              key={`${b.title}|${b.agency}|${b.due_date}`}
              className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3.5"
            >
              {b.source_url ? (
                <a
                  href={b.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block transition-colors hover:text-amber-300"
                  onClick={() => trackEvent("fb_funnel_bid_clicked", cert.label)}
                >
                  {titleEl}
                  <span className="mt-0.5 block truncate text-xs text-slate-400">
                    {b.agency || "Federal agency"}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-xs font-medium text-amber-400">
                    {due ? `Closes ${due}` : "Closing this month"}
                    <span aria-hidden="true">↗</span>
                  </span>
                </a>
              ) : (
                <div>
                  {titleEl}
                  <span className="mt-0.5 block truncate text-xs text-slate-400">
                    {b.agency || "Federal agency"}
                  </span>
                  <span className="mt-1 block text-xs font-medium text-amber-400">
                    {due ? `Closes ${due}` : "Closing this month"}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {bids.length < count && (
        <p className="mt-3 text-center text-xs text-slate-500">
          Showing {bids.length} of {count.toLocaleString("en-US")} — see them
          all by creating a free account.
        </p>
      )}
      <div className="mt-6 rounded-2xl bg-slate-900 p-5 text-center ring-1 ring-slate-800">
        <a
          href="/signup?plan=basic"
          onClick={() => trackEvent("fb_funnel_signup_cta", cert.label)}
          className="block w-full rounded-xl bg-amber-500 px-6 py-4 text-base font-bold text-slate-950 transition-all hover:bg-amber-400 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        >
          Create a free account to view and track these bids →
        </a>
        <p className="mt-3 text-xs leading-relaxed text-slate-400">
          Basic is free forever — up to 3 saved bids, no card required.
          AI match scoring &amp; draft tools are on Professional.
        </p>
      </div>
    </div>
  );
}

/** fire-and-forget helper so a tracking call can never block the reveal. */
function fireAndForget(fn: () => void) {
  try {
    fn();
  } catch {
    /* never let tracking break the funnel */
  }
}