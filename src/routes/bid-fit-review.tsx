import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import { isHttpUrl } from "~/lib/bid-fit-review-link";

export const Route = createFileRoute("/bid-fit-review")({
  head: () => ({ meta: [
    { title: "Bid Fit Review | Contrax" },
    { name: "description", content: "A $99 one-time, source-cited review of one government solicitation for your business." },
    { name: "robots", content: "index, follow" },
  ] }),
  // Optional pre-fill from a bid's "Get a $99 Bid Fit Review" link.
  validateSearch: (search: Record<string, unknown>): { url?: string; deadline?: string; payment?: string } => ({
    payment: search.payment === "submitted" ? "submitted" : undefined,
    url: typeof search.url === "string" && isHttpUrl(search.url) ? search.url.slice(0, 2000) : undefined,
    deadline: typeof search.deadline === "string" ? search.deadline.slice(0, 100) : undefined,
  }),
  component: () => (
    <>
      <SiteHeader />
      <BidFitReview />
    </>
  ),
});

function BidFitReview() {
  const prefill = Route.useSearch();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [requestLink, setRequestLink] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    const form = event.currentTarget;
    try {
      const response = await fetch("/api/bid-fit-review/request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
      });
      if (!response.ok) throw new Error("Request failed");
      const body = await response.json();
      if (!body.token) throw new Error("Missing request link");
      setRequestLink(`/bid-fit-review/request#${body.token}`);
      form.reset();
      setState("sent");
    } catch { setState("error"); }
  }
  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <div className="mx-auto max-w-4xl px-5 py-12 sm:py-20">
      {prefill.payment === "submitted" && <p role="status" className="mb-5 rounded-lg bg-blue-50 p-4">Checkout submitted. Payment confirmation may take time. Use your private request link to check status; work starts after confirmed payment and receipt of the required documents and business details.</p>}
      <p className="text-sm font-bold uppercase tracking-widest text-blue-700">One-time service · $99 introductory price</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">Know whether this bid is worth your time.</h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">Send us one government solicitation and your business details. Get a one-page, source-cited pursue/pass assessment before you invest hours in a response.</p>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
          <h2 className="text-xl font-bold">What you receive</h2>
          <ul className="mt-4 list-disc space-y-3 pl-5 text-slate-700">
            <li>Eligibility and business fit against the stated requirements</li>
            <li>Key deadlines, required forms, and submission steps</li>
            <li>Deal breakers and questions to resolve before bidding</li>
            <li>A pursue/pass recommendation with links to source sections</li>
          </ul>
          <details id="sample-review" className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <summary className="cursor-pointer font-semibold text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700">View a sample Bid Fit Review</summary>
            <article aria-label="Illustrative Bid Fit Review sample" className="mt-4 space-y-4 text-sm leading-6 text-slate-700">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Illustrative sample · Real solicitation · Checked October 12, 2026</p>
              <h3 className="text-lg font-bold text-slate-900">Planning &amp; Zoning Code Assessment and Rewrite</h3>
              <p>City of Worthington, Ohio. This shows the review format, not a completed customer review. Business details below are hypothetical; this example is not a live bid-status update.</p>
              <p><strong>Example business:</strong> A planning consultancy with zoning rewrite experience. Staffing, references and insurance have not been verified.</p>
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3"><strong>Recommendation: conditional pursue.</strong> The stated work aligns with the example business. Confirm capacity, comparable experience, required legal support and insurance before committing to a proposal. Pass if those requirements cannot be met.</p>
              <div>
                <h4 className="font-bold text-slate-900">Scope and stated budget</h4>
                <p>Assess and rewrite the planning and zoning code, with maps, public engagement and adoption support. The City states a $275,000 project budget; this is not an awarded amount. <a href="https://www.worthington.org/DocumentCenter/View/13616/Planning-and-Zoning-Code-Assessment-and-Rewrite-RFP-09212026#page=3" className="text-blue-800 underline">RFP pages 3–5</a>.</p>
              </div>
              <div>
                <h4 className="font-bold text-slate-900">Deadline and submission</h4>
                <p>November 2, 2026 at noon, local Worthington time. Submit five hardcopies and one electronic copy (USB or email). The response is limited to 25 pages; the cover letter is excluded. <a href="https://www.worthington.org/DocumentCenter/View/13616/Planning-and-Zoning-Code-Assessment-and-Rewrite-RFP-09212026#page=6" className="text-blue-800 underline">RFP page 6</a>.</p>
              </div>
              <div>
                <h4 className="font-bold text-slate-900">Resolve before bidding</h4>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Confirm the team can provide the required legal review. <a href="https://www.worthington.org/DocumentCenter/View/13616/Planning-and-Zoning-Code-Assessment-and-Rewrite-RFP-09212026#page=4" className="text-blue-800 underline">Page 4</a>.</li>
                  <li>Check insurance coverage and required limits. <a href="https://www.worthington.org/DocumentCenter/View/13616/Planning-and-Zoning-Code-Assessment-and-Rewrite-RFP-09212026#page=9" className="text-blue-800 underline">Pages 9–10</a>.</li>
                  <li>Verify amendments and clarify submission instructions with the City before responding.</li>
                </ul>
              </div>
              <p className="border-t border-blue-200 pt-3"><strong>Your review:</strong> Uses your company details and the full solicitation to identify eligibility, deadlines, deal breakers and a source-cited pursue/pass recommendation.</p>
              <a href="https://www.worthington.org/DocumentCenter/View/13616/Planning-and-Zoning-Code-Assessment-and-Rewrite-RFP-09212026" className="inline-block font-semibold text-blue-800 underline">Read the official solicitation →</a>
            </article>
          </details>
          <p className="mt-6 text-sm text-slate-600">One solicitation per review. After checking document access, the bid deadline, and availability, we will confirm whether we can take it on. For accepted requests, delivery is within two business days of payment and receipt of the full solicitation documents and company details, and always before the bid deadline.</p>
          <p className="mt-3 text-sm text-slate-600">Bid writing, pricing, submission, legal advice, and award guarantees are outside this service.</p>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
          <h2 className="text-xl font-bold">Request a review</h2>
          <p className="mt-2 text-sm text-slate-600">We will check the documents, deadline, and our availability before offering a payment link. Sending this form does not charge you or reserve a delivery slot.</p>
          {state === "sent" ? <p role="status" className="mt-6 rounded-lg bg-green-50 p-4 text-green-800">Request received. <a className="font-semibold underline" href={requestLink}>Upload your documents and view your request</a>. Save that private link. We will reply by email after checking the solicitation and deadline.</p> :
          <form onSubmit={submit} className="mt-5 space-y-4">
            <label className="block text-sm font-medium">Name<input name="name" required maxLength={100} className="mt-1 w-full rounded-lg border border-slate-300 p-3" /></label>
            <label className="block text-sm font-medium">Business name<input name="business" required maxLength={150} className="mt-1 w-full rounded-lg border border-slate-300 p-3" /></label>
            <label className="block text-sm font-medium">Email<input name="email" type="email" required maxLength={254} className="mt-1 w-full rounded-lg border border-slate-300 p-3" /></label>
            <label className="block text-sm font-medium">Solicitation link<input name="solicitationUrl" type="url" required maxLength={2000} placeholder="https://…" defaultValue={prefill.url ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 p-3" /></label>
            <label className="block text-sm font-medium">Your services and relevant experience<textarea name="capabilities" required maxLength={2000} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 p-3" /></label>
            <label className="block text-sm font-medium">Bid deadline and time zone<input name="deadline" required maxLength={100} placeholder="October 22, 3 PM Eastern" defaultValue={prefill.deadline ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 p-3" /></label>
            <label className="block text-sm font-medium">Full documents accessible? <select name="documentsAvailable" required className="mt-1 w-full rounded-lg border border-slate-300 p-3"><option value="">Select one</option><option value="yes">Yes, through the link</option><option value="login">Account or login required</option><option value="unsure">Not sure</option></select></label>
            <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
            {state === "error" && <p role="alert" className="text-sm text-red-700">Could not send your request. Please email contrax.companyllc@gmail.com.</p>}
            <button disabled={state === "sending"} className="w-full rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800 disabled:opacity-60">{state === "sending" ? "Sending…" : "Request my $99 review"}</button>
          </form>}
        </section>
      </div>
    </div>
  </main>;
}
