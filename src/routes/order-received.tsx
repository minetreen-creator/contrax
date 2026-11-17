import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { MANAGED_FIRST_REPORT } from "~/lib/contrax-managed";
import { REPORT_CREDIT_NOTE, REPORT_DELIVERY } from "~/lib/pipeline-report";
import { BID_PREP_GUARANTEE } from "~/lib/bid-prep";
import { BidPrepIntake } from "~/components/BidPrepIntake";
import { trackEvent } from "~/lib/track";

/**
 * /order-received — where Stripe returns a buyer after paying for a Pipeline Snapshot or starting
 * Contrax Managed (owner 2026-11-14, "changing the pages a visitor moves through"). Before this the
 * buyer landed at the top of /teams with the confirmation far down the page. It says what happens
 * next and when, and gives the one sensible next step for each kind. It shows nothing private:
 * the page reads only ?kind= (and, for Bid Prep, the Stripe session id that keys the intake form),
 * so it is safe to open without an order.
 */
type Kind = "report" | "managed" | "bidprep";

export const Route = createFileRoute("/order-received")({
  validateSearch: (s: Record<string, unknown>): { kind: Kind; session?: string } => ({
    kind: s.kind === "managed" ? "managed" : s.kind === "bidprep" ? "bidprep" : "report",
    ...(typeof s.session === "string" && /^cs_[A-Za-z0-9_]{10,200}$/.test(s.session) ? { session: s.session } : {}),
  }),
  head: () => ({
    meta: [{ title: "Order received | Contrax" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: OrderReceived,
});

const STEPS: Record<Kind, { title: string; lead: string; steps: string[] }> = {
  report: {
    title: "Payment received. Your Pipeline Snapshot is being prepared.",
    lead: `It will reach your inbox within ${REPORT_DELIVERY}. Orders placed on a weekend arrive Monday.`,
    steps: [
      "A confirmation email is on its way now, with what the report will hold.",
      "If we need to pin down your line of work, we will reply to that email first.",
      "Your report arrives as an email from Nathaniel at Contrax.",
    ],
  },
  bidprep: {
    title: "Payment received. We are preparing your bid.",
    lead: BID_PREP_GUARANTEE,
    steps: [
      "Fill in the short form below about your company. The same questions are in your confirmation email if you would rather reply there.",
      "We read the solicitation, fill in the forms and draft the written parts.",
      "Your package arrives as an email from Nathaniel at Contrax. You set your price, sign and submit.",
    ],
  },
  managed: {
    title: "You are signed up for Contrax Managed.",
    lead: `Your first report will reach your inbox within ${MANAGED_FIRST_REPORT}.`,
    steps: [
      "We build the first report for the states and line of work you gave us.",
      "We set up a Professional login for your team and email you the details.",
      "After that, a fresh report arrives every month. To cancel, reply to any of our emails.",
    ],
  },
};

function OrderReceived() {
  const { kind, session } = Route.useSearch();
  const c = STEPS[kind];
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-16">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Thank you</p>
        <h1 className="mt-2 text-3xl font-extrabold leading-tight text-slate-900">{c.title}</h1>
        <p className="mt-3 text-slate-700">{c.lead}</p>
        <h2 className="mt-8 text-lg font-bold text-slate-900">What happens next</h2>
        <ol className="mt-3 space-y-2 text-sm text-slate-700">
          {c.steps.map((s, i) => (
            <li key={s} className="rounded-lg border border-slate-200 p-3">
              <span className="font-bold text-slate-900">{i + 1}.</span> {s}
            </li>
          ))}
        </ol>
        {kind === "bidprep" && session ? <BidPrepIntake session={session} /> : null}
        {kind === "report" ? (
          <div className="mt-8 rounded-2xl border-2 border-amber-400 bg-amber-50 p-5">
            <h2 className="text-lg font-bold text-slate-900">Want it every month?</h2>
            <p className="mt-1 text-sm text-slate-700">{REPORT_CREDIT_NOTE} Use the same email at checkout and the credit applies itself.</p>
            <a
              href="/teams#done-for-you"
              onClick={() => trackEvent("order_received_click", "managed")}
              className="mt-3 inline-block rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800"
            >
              See Contrax Managed →
            </a>
          </div>
        ) : (
          <p className="mt-8 text-sm text-slate-700">
            While you wait, you can{" "}
            <a href="/recompetes" onClick={() => trackEvent("order_received_click", "recompetes")} className="font-semibold text-blue-700 underline hover:text-blue-600">
              browse contracts ending soon
            </a>
            .
          </p>
        )}
        <p className="mt-8 text-sm text-slate-600">
          A question about your order? Write to{" "}
          <a href="mailto:contrax.companyllc@gmail.com" className="text-blue-700 underline hover:text-blue-600">contrax.companyllc@gmail.com</a>.
        </p>
      </main>
    </>
  );
}
