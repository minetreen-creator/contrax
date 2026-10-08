import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import { trackEvent } from "~/lib/track";
import { INTERMEDIATE_ID, INTERMEDIATE_KEY, INTERMEDIATE_LESSONS, INTERMEDIATE_MINUTES, INTERMEDIATE_TITLE,
  bidPlanText, intermediatePassed, lessonPassed, readIntermediateProgress, type IntermediateAnswers } from "~/lib/course-intermediate";

const url = "https://www.contrax.company/learn/intermediate-government-contracting";
const description = "Free intermediate government contracting course for all trades: bid decisions, compliance checklists, pricing, proposal evidence, submission, and follow-up. Includes quizzes, a bid-plan worksheet, and a completion certificate.";
export const Route = createFileRoute("/learn/intermediate-government-contracting")({
  component: CoursePage,
  head: () => ({ meta: [{ title: `${INTERMEDIATE_TITLE} — Free Intermediate Course | Contrax` },
    { name: "description", content: description }, { property: "og:title", content: INTERMEDIATE_TITLE },
    { property: "og:description", content: description }, { property: "og:type", content: "article" },
    { property: "og:url", content: url }, { property: "og:image", content: "https://www.contrax.company/logo-square.png" }],
    links: [{ rel: "canonical", href: url }] }),
});

function CoursePage() {
  const [answers, setAnswers] = useState<IntermediateAnswers>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [open, setOpen] = useState(INTERMEDIATE_LESSONS[0].id);
  useEffect(() => {
    try { const saved = readIntermediateProgress(localStorage.getItem(INTERMEDIATE_KEY)); setAnswers(saved.answers); setNotes(saved.notes); }
    catch { setStorageWarning(true); }
    setReady(true);
    trackEvent("course_started", INTERMEDIATE_ID);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(INTERMEDIATE_KEY, JSON.stringify({ answers, notes })); }
    catch { setStorageWarning(true); }
  }, [answers, notes, ready]);
  const done = INTERMEDIATE_LESSONS.filter(l => lessonPassed(l.id, answers)).length;
  const download = () => {
    trackEvent("course_worksheet_download", INTERMEDIATE_ID);
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(new Blob([bidPlanText(notes)], { type: "text/plain;charset=utf-8" }));
    link.href = objectUrl; link.download = "contrax-bid-plan.txt"; link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };
  return <><SiteHeader /><main className="min-h-screen bg-slate-50 pb-16">
    <section className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <a href="/learn" className="text-sm font-semibold text-blue-700 underline">← All learning resources</a>
      <p className="mt-6 text-sm font-bold uppercase tracking-wide text-amber-700">Intermediate · Free for everyone · About {INTERMEDIATE_MINUTES} minutes</p>
      <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{INTERMEDIATE_TITLE}</h1>
      <p className="mt-4 text-lg leading-relaxed text-slate-700">Turn an opportunity into a practical bid plan. Build a checklist, work through pricing, organize your evidence, and prepare for submission.</p>
      <p className="mt-3 text-sm text-slate-600">For service, supply, construction, and other businesses. Familiarity with the basics is recommended. <a href="/learn/government-contracting" className="font-semibold text-blue-700 underline">Start with our introductory course</a> if government contracting is new to you.</p>
      <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-relaxed text-blue-950">
        <p>No account or payment is needed to study. Each lesson includes an exercise and two questions. Finish all quizzes to request your completion certificate.</p>
        <p className="mt-2">Examples are practice scenarios. Follow the actual buyer's current solicitation and amendments. Federal references apply to the procedures they describe; state and local requirements can differ.</p>
      </div>
      <div className="mt-6 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label="Course progress" aria-valuemin={0} aria-valuemax={6} aria-valuenow={done}>
        <div className="h-full bg-amber-500 transition-all" style={{ width: `${done / 6 * 100}%` }} />
      </div>
      <p className="mt-2 text-sm text-slate-600" aria-live="polite">{done} of 6 lessons complete. {storageWarning ? "Your browser cannot save progress. Download your worksheet before leaving." : "Quiz progress and exercise notes save on this device."}</p>
    </section>
    <section className="mx-auto max-w-3xl space-y-4 px-4" aria-label="Course lessons">
      {INTERMEDIATE_LESSONS.map((l, n) => <article key={l.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <h2><button type="button" aria-expanded={open === l.id} aria-controls={`lesson-${l.id}`} onClick={() => setOpen(open === l.id ? "" : l.id)} className="flex w-full items-center gap-3 p-5 text-left">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${lessonPassed(l.id, answers) ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{lessonPassed(l.id, answers) ? "✓" : n + 1}</span>
          <span className="flex-1"><span className="block font-bold text-slate-900">{l.title}</span><span className="text-xs text-slate-500">About {l.minutes} minutes, including practice</span></span><span aria-hidden="true">{open === l.id ? "−" : "+"}</span>
        </button></h2>
        {open === l.id && <div id={`lesson-${l.id}`} className="space-y-5 border-t border-slate-100 p-5 text-base leading-relaxed text-slate-700">
          {l.blocks.map((b, i) => "p" in b ? <p key={i}>{b.p}</p> : "tip" in b ? <p key={i} className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950">💡 {b.tip}</p> : <ul key={i} className="list-disc space-y-3 pl-5">{b.list.map(item => <li key={item}>{item}</li>)}</ul>)}
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
            <h3 className="font-bold text-blue-950">Put it into practice</h3><p className="mt-2 text-sm text-blue-950">{l.exercise}</p>
            <label htmlFor={`notes-${l.id}`} className="mt-3 block text-sm font-semibold text-slate-800">Your worksheet notes</label>
            <textarea id={`notes-${l.id}`} value={notes[l.id] || ""} onChange={e => setNotes(previous => ({ ...previous, [l.id]: e.target.value }))} maxLength={4000} rows={4} placeholder={l.worksheet} className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm" />
            <p className="mt-1 text-xs text-slate-600">Notes stay on this device. Use practice details rather than confidential bid or customer information.</p>
          </div>
          <div className="space-y-4 rounded-xl bg-slate-50 p-4"><h3 className="font-bold text-slate-900">Check your understanding</h3>
            {l.quiz.map((q, qi) => <fieldset key={q.q}><legend className="text-sm font-semibold text-slate-900">{q.q}</legend>
              <div className="mt-2 space-y-2">{q.options.map((option, oi) => <label key={option} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${answers[l.id]?.[qi] === oi ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white"}`}>
                <input type="radio" name={`${l.id}-${qi}`} checked={answers[l.id]?.[qi] === oi} className="mt-1" onChange={() => setAnswers(previous => ({ ...previous, [l.id]: l.quiz.map((_, i) => i === qi ? oi : previous[l.id]?.[i] ?? null) }))} />{option}
              </label>)}</div>
              {answers[l.id]?.[qi] != null && <p className={`mt-2 text-sm ${answers[l.id][qi] === q.answer ? "text-emerald-800" : "text-red-700"}`} role="status">{answers[l.id][qi] === q.answer ? "Correct. " : "Try again. "}{q.why}</p>}
            </fieldset>)}
            {lessonPassed(l.id, answers) && <p className="font-semibold text-emerald-800">✓ Lesson complete. {n < 5 && <button type="button" className="ml-2 text-blue-700 underline" onClick={() => setOpen(INTERMEDIATE_LESSONS[n + 1].id)}>Next lesson →</button>}</p>}
          </div>
          <p className="text-xs text-slate-500">Official references: {l.sources.map((source, i) => <span key={source.url}>{i > 0 && " · "}<a href={source.url} target="_blank" rel="noopener noreferrer" className="underline">{source.label}</a></span>)}</p>
        </div>}
      </article>)}
    </section>
    <section className="mx-auto mt-8 max-w-3xl px-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-bold text-slate-900">Your bid-planning worksheet</h2>
        <p className="mt-2 text-sm text-slate-600">Download your exercise notes as an editable text worksheet at any time. Blank sections include prompts so you can reuse it for another opportunity.</p>
        <button type="button" onClick={download} className="mt-4 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white">Download my bid plan</button>
        <a href="/radar" className="ml-4 inline-block pt-3 text-sm font-semibold text-blue-700 underline">Find an opportunity to practice with →</a>
      </div>
      {intermediatePassed(answers) ? <CertificateForm answers={answers} /> : <p className="mt-6 text-center text-sm text-slate-500">Complete all 12 quiz questions correctly to unlock your certificate. You can retry any question.</p>}
      <p className="mt-6 text-center text-xs text-slate-500">Contrax course completion is educational recognition, not a government certification, professional license, or guarantee of an award.</p>
    </section>
  </main></>;
}

function CertificateForm({ answers }: { answers: IntermediateAnswers }) {
  const [name, setName] = useState(""); const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [token, setToken] = useState("");
  const submit = async (event: { preventDefault(): void }) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/course/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ course: INTERMEDIATE_ID, name, email, answers }) });
      const value = await response.json();
      if (!response.ok || !value.token) throw new Error(value.error || "Couldn't save your completion.");
      setToken(value.token);
      trackEvent("course_completed", INTERMEDIATE_ID);
    } catch (err) { setError(err instanceof Error ? err.message : "Couldn't save your completion. Please try again."); }
    finally { setBusy(false); }
  };
  if (token) return <div className="mt-6 rounded-2xl bg-emerald-50 p-6 text-center"><h2 className="text-xl font-bold text-emerald-950">You completed the intermediate course!</h2><a href={`/learn/certificate/${token}`} className="mt-4 inline-block rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white">View and print your certificate</a></div>;
  return <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl border border-amber-200 bg-white p-6">
    <h2 className="text-xl font-bold text-slate-900">Get your free completion certificate</h2>
    <label className="block text-sm font-semibold text-slate-700">Name for your certificate<input required minLength={2} maxLength={80} value={name} onChange={e => setName(e.target.value)} autoComplete="name" className="mt-2 w-full rounded-lg border border-slate-300 p-3" /></label>
    <label className="block text-sm font-semibold text-slate-700">Email<input required type="email" maxLength={160} value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" className="mt-2 w-full rounded-lg border border-slate-300 p-3" /></label>
    <p className="text-xs text-slate-500">Your name and email are sent to Contrax to record your course completion. Your exercise notes are not sent.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <button disabled={busy} type="submit" className="rounded-xl bg-amber-500 px-5 py-3 font-bold text-slate-950 disabled:opacity-60">{busy ? "Saving…" : "Get my certificate"}</button>
  </form>;
}
