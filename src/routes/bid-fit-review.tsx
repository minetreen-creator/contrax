import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

export const Route = createFileRoute("/bid-fit-review")({
  head: () => ({ meta: [
    { title: "Bid Fit Review | Contrax" },
    { name: "description", content: "A $99 one-time, source-cited review of one government solicitation for your business." },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: BidFitReview,
});

function BidFitReview() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
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
      form.reset();
      setState("sent");
    } catch { setState("error"); }
  }
  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <div className="mx-auto max-w-4xl px-5 py-12 sm:py-20">
      <a href="/" className="text-sm font-semibold text-blue-700">← Contrax</a>
      <p className="mt-12 text-sm font-bold uppercase tracking-widest text-blue-700">One-time service · $99 introductory price</p>
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
          <p className="mt-6 text-sm text-slate-600">One solicitation per review. After checking document access, the bid deadline, and availability, we will confirm whether we can take it on. For accepted requests, delivery is within two business days of payment and receipt of the full solicitation documents and company details, and always before the bid deadline.</p>
          <p className="mt-3 text-sm text-slate-600">Bid writing, pricing, submission, legal advice, and award guarantees are outside this service.</p>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
          <h2 className="text-xl font-bold">Request a review</h2>
          <p className="mt-2 text-sm text-slate-600">We will check the documents, deadline, and our availability before offering a payment link. Sending this form does not charge you or reserve a delivery slot.</p>
          {state === "sent" ? <p role="status" className="mt-6 rounded-lg bg-green-50 p-4 text-green-800">Request sent. We will reply by email after checking the solicitation and deadline.</p> :
          <form onSubmit={submit} className="mt-5 space-y-4">
            <label className="block text-sm font-medium">Name<input name="name" required maxLength={100} className="mt-1 w-full rounded-lg border border-slate-300 p-3" /></label>
            <label className="block text-sm font-medium">Business name<input name="business" required maxLength={150} className="mt-1 w-full rounded-lg border border-slate-300 p-3" /></label>
            <label className="block text-sm font-medium">Email<input name="email" type="email" required maxLength={254} className="mt-1 w-full rounded-lg border border-slate-300 p-3" /></label>
            <label className="block text-sm font-medium">Solicitation link<input name="solicitationUrl" type="url" required maxLength={2000} placeholder="https://…" className="mt-1 w-full rounded-lg border border-slate-300 p-3" /></label>
            <label className="block text-sm font-medium">Your services and relevant experience<textarea name="capabilities" required maxLength={2000} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 p-3" /></label>
            <label className="block text-sm font-medium">Bid deadline and time zone<input name="deadline" required maxLength={100} placeholder="October 22, 3 PM Eastern" className="mt-1 w-full rounded-lg border border-slate-300 p-3" /></label>
            <label className="block text-sm font-medium">Full documents accessible? <select name="documentsAvailable" required className="mt-1 w-full rounded-lg border border-slate-300 p-3"><option value="">Select one</option><option value="yes">Yes, through the link</option><option value="login">Account or login required</option><option value="unsure">Not sure</option></select></label>
            <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
            {state === "error" && <p role="alert" className="text-sm text-red-700">Could not send your request. Please email minetreen@gmail.com.</p>}
            <button disabled={state === "sending"} className="w-full rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800 disabled:opacity-60">{state === "sending" ? "Sending…" : "Request my $99 review"}</button>
          </form>}
        </section>
      </div>
    </div>
  </main>;
}
