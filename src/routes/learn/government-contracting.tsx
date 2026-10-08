import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import { STATE_NAMES } from "~/lib/contract-map";
import {
  COURSE_TRADES,
  courseTrade,
  COURSE_MINUTES,
  COURSE_SUBTITLE,
  COURSE_TITLE,
  LESSONS,
  parseProgress,
  type Block,
  type Lesson,
} from "~/lib/course-construction";
import type { CourseBid } from "~/lib/course.server";
import { trackEvent } from "~/lib/track";
import { trackingIds } from "~/lib/visitor";

/**
 * /learn/government-contracting — free self-paced course "Getting Started with Government Contracting" (owner 2026-10-07, for the SBA Rhode Island resource list). Five short
 * lessons with a quiz each, real open construction bids from the visitor's state
 * (Rhode Island by default, or ?state=XX), an AI study helper that answers only
 * from the lessons, and a printable completion certificate.
 */
const PROD_URL = "https://www.contrax.company";
const DESC =
  "Free 15-minute introduction to government contracting for everyone: finding opportunities, understanding set-asides, evaluating bids, and getting bid-ready. Includes construction examples.";
const PROGRESS_KEY = "contrax_course_construction_v1";

const loadCourse = createServerFn({ method: "GET" })
  .validator((d: unknown) => {
    const st = String((d as { state?: unknown })?.state ?? "").trim().toUpperCase();
    return { state: Object.hasOwn(STATE_NAMES, st) ? st : "RI", trade: courseTrade((d as { trade?: unknown })?.trade).id };
  })
  .handler(async ({ data }) => {
    try {
      const { courseLiveBids, countCompletions } = await import("~/lib/course.server");
      const { COURSE_ID } = await import("~/lib/course-construction");
      const [live, completed] = await Promise.all([courseLiveBids(data.state, data.trade), countCompletions(COURSE_ID)]);
      return { live, completed };
    } catch (err) {
      console.error("[learn/construction] load failed:", err);
      return { live: null, completed: 0 };
    }
  });

export const Route = createFileRoute("/learn/government-contracting")({
  validateSearch: (s: Record<string, unknown>) => ({ state: typeof s.state === "string" && Object.hasOwn(STATE_NAMES, s.state.toUpperCase()) ? s.state.toUpperCase() : "RI", trade: courseTrade(s.trade).id }),
  loaderDeps: ({ search }) => ({ state: search.state, trade: search.trade }),
  loader: ({ deps }) => loadCourse({ data: { state: deps.state, trade: deps.trade } }),
  component: () => (
    <>
      <SiteHeader />
      <CoursePage />
    </>
  ),
  head: () => ({
    meta: [
      { title: `${COURSE_TITLE} (Free Course) | Contrax` },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "article" },
      { property: "og:url", content: `${PROD_URL}/learn/government-contracting` },
      { property: "og:title", content: `${COURSE_TITLE}: free course for veteran-owned contractors` },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
      { property: "og:site_name", content: "Contrax" },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/learn/government-contracting` }],
  }),
});

const due = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";

function readProgress(): string[] {
  try {
    return parseProgress(window.localStorage.getItem(PROGRESS_KEY));
  } catch {
    return [];
  }
}
function saveProgress(ids: string[]) {
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(ids));
  } catch {
    /* progress just won't persist */
  }
}

function CoursePage() {
  const { live, completed } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [done, setDone] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string>(LESSONS[0].id);
  useEffect(() => {
    const p = readProgress();
    setDone(p);
    const next = LESSONS.find((l) => !p.includes(l.id));
    if (next) setOpenId(next.id);
  }, []);

  const finish = (id: string) => {
    if (done.includes(id)) return;
    const next = [...done, id];
    setDone(next);
    saveProgress(next);
    trackEvent("course_lesson_complete", id);
    const upcoming = LESSONS.find((l) => !next.includes(l.id));
    if (upcoming) setOpenId(upcoming.id);
  };
  const allDone = LESSONS.every((l) => done.includes(l.id));
  const stateName = live ? STATE_NAMES[live.state] ?? live.state : "";

  return (
    <main className="min-h-screen bg-slate-50">
      <section className="mx-auto max-w-2xl px-4 pb-6 pt-10">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Free course · {COURSE_MINUTES} minutes</p>
        <h1 className="mt-2 text-3xl font-extrabold leading-tight text-slate-900">{COURSE_TITLE}</h1>
        <p className="mt-2 text-slate-700">{COURSE_SUBTITLE}</p>
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">Find examples for your business</h2>
          <p className="mt-1 text-sm text-slate-600">Choose a state and trade to update the live bid examples. The lessons and your progress stay the same. Specialty matches use NAICS codes; some opportunities may have missing codes.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">State
              <select value={search.state} onChange={(e) => void navigate({ search: { ...search, state: e.target.value }, replace: true, resetScroll: false })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
                {Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1])).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">Construction trade
              <select value={search.trade} onChange={(e) => void navigate({ search: { ...search, trade: courseTrade(e.target.value).id }, replace: true, resetScroll: false })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
                {COURSE_TRADES.map((trade) => <option key={trade.id} value={trade.id}>{trade.label}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-200" aria-label={`${done.length} of ${LESSONS.length} lessons done`}>
          <div className="h-full bg-amber-500 transition-all" style={{ width: `${(done.length / LESSONS.length) * 100}%` }} />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {done.length} of {LESSONS.length} lessons done · progress saves on this device
          {completed > 0 ? ` · completed by ${completed.toLocaleString("en-US")} contractor${completed === 1 ? "" : "s"}` : ""}
        </p>
      </section>

      <section className="mx-auto max-w-2xl space-y-3 px-4 pb-10">
        {LESSONS.map((l, i) => (
          <LessonCard
            key={l.id}
            n={i + 1}
            lesson={l}
            open={openId === l.id}
            done={done.includes(l.id)}
            onOpen={() => setOpenId(openId === l.id ? "" : l.id)}
            onFinish={() => finish(l.id)}
            live={live}
            stateName={stateName}
          />
        ))}
      </section>

      <section className="mx-auto max-w-2xl px-4 pb-16">
        {allDone ? <Complete key={search.state} initialState={search.state} trade={search.trade} /> : <p className="text-center text-sm text-slate-500">Finish all {LESSONS.length} lessons to get your certificate.</p>}
      </section>
    </main>
  );
}

type Live = NonNullable<ReturnType<typeof Route.useLoaderData>["live"]>;

function LessonCard(props: {
  n: number;
  lesson: Lesson;
  open: boolean;
  done: boolean;
  onOpen: () => void;
  onFinish: () => void;
  live: Live | null;
  stateName: string;
}) {
  const { n, lesson, open, done, onOpen, onFinish, live, stateName } = props;
  return (
    <article className="rounded-2xl border border-slate-200 bg-white">
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-4 text-left" aria-expanded={open}>
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            done ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-700"
          }`}
        >
          {done ? "✓" : n}
        </span>
        <span className="flex-1">
          <span className="block font-semibold text-slate-900">{lesson.title}</span>
          <span className="text-xs text-slate-500">{lesson.minutes} min</span>
        </span>
        <span className="text-slate-400" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-100 px-4 pb-5 pt-4 text-[15px] leading-relaxed text-slate-700">
          {lesson.blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
          {live && lesson.live && <LiveBids kind={lesson.live} live={live} stateName={stateName} />}
          <p className="text-xs text-slate-500">
            Sources:{" "}
            {lesson.sources.map((s, i) => (
              <span key={s.url}>
                {i > 0 && " · "}
                <a className="underline" href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.label}
                </a>
              </span>
            ))}
          </p>
          <Quiz lesson={lesson} done={done} onPass={onFinish} />
          <Ask lessonId={lesson.id} />
        </div>
      )}
    </article>
  );
}

function BlockView({ block }: { block: Block }) {
  if ("p" in block) return <p>{block.p}</p>;
  if ("tip" in block) return <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">💡 {block.tip}</p>;
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {block.list.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
}

function BidList({ title, bids }: { title: string; bids: CourseBid[] }) {
  if (!bids.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <ul className="mt-1 divide-y divide-slate-100">
        {bids.map((b) => (
          <li key={b.id} className="py-2 text-sm">
            <a href={`/bid/${b.id}`} onClick={() => trackEvent("course_bid_click", String(b.id))} className="font-semibold text-blue-700 underline">
              {b.title}
            </a>
            <span className="block text-xs text-slate-500">{[b.agency, b.set_aside, b.due_date && `due ${due(b.due_date)}`].filter(Boolean).join(" · ")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LiveBids({ kind, live, stateName }: { kind: NonNullable<Lesson["live"]>; live: Live; stateName: string }) {
  const box = "space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-3";
  if (kind === "count") {
    if (!live.total) return null;
    return (
      <div className={box}>
        <p className="text-sm font-semibold text-emerald-900">
          Right now: {live.total.toLocaleString("en-US")} open construction bids in {stateName} on Contrax.
        </p>
      </div>
    );
  }
  if (kind === "set-aside") {
    if (!live.setAside.length) return null;
    return (
      <div className={box}>
        <BidList title={`Open set-aside construction bids in ${stateName}`} bids={live.setAside} />
      </div>
    );
  }
  if (kind === "practice") {
    if (!live.practice.length) return null;
    return (
      <div className={box}>
        <p className="text-sm text-emerald-900">Practice: open one of these and run the 2-minute check.</p>
        <BidList title={`Open construction bids in ${stateName}`} bids={live.practice.slice(0, 2)} />
      </div>
    );
  }
  if (!live.openEnrollment.length && !live.practice.length) return null;
  return (
    <div className={box}>
      <BidList title={`Open-enrollment agreements in ${stateName}`} bids={live.openEnrollment} />
      <a href={`/radar?trade=${courseTrade(live.trade).id === "all" ? "construction" : courseTrade(live.trade).naics}&state=${live.state}`} className="inline-block text-sm font-semibold text-blue-700 underline">
        See every open construction bid in {stateName} →
      </a>
      <a href="/suppliers/join" className="block text-sm font-semibold text-blue-700 underline">
        List your company in the supplier directory →
      </a>
    </div>
  );
}

function Quiz({ lesson, done, onPass }: { lesson: Lesson; done: boolean; onPass: () => void }) {
  const [picked, setPicked] = useState<(number | null)[]>(() => lesson.quiz.map(() => null));
  const answered = picked.every((p) => p !== null);
  const allRight = answered && picked.every((p, i) => p === lesson.quiz[i].answer);
  useEffect(() => {
    if (allRight && !done) onPass();
  }, [allRight, done]);
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="text-sm font-semibold text-slate-900">Quick check</p>
      {lesson.quiz.map((q, qi) => (
        <fieldset key={q.q}>
          <legend className="text-sm font-medium text-slate-900">{q.q}</legend>
          <div className="mt-1.5 space-y-1">
            {q.options.map((o, oi) => {
              const chosen = picked[qi] === oi;
              const right = oi === q.answer;
              return (
                <label
                  key={o}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-sm ${
                    chosen ? (right ? "border-emerald-400 bg-emerald-50" : "border-red-300 bg-red-50") : "border-slate-200 bg-white"
                  }`}
                >
                  <input
                    type="radio"
                    name={`${lesson.id}-${qi}`}
                    checked={chosen}
                    onChange={() => setPicked((p) => p.map((v, i) => (i === qi ? oi : v)))}
                    className="mt-0.5"
                  />
                  {o}
                </label>
              );
            })}
          </div>
          {picked[qi] !== null && (
            <p className={`mt-1 text-xs ${picked[qi] === q.answer ? "text-emerald-700" : "text-red-700"}`}>
              {picked[qi] === q.answer ? "Correct. " : "Not quite. "}
              {q.why}
            </p>
          )}
        </fieldset>
      ))}
      {done && <p className="text-sm font-semibold text-emerald-700">✓ Lesson complete</p>}
    </div>
  );
}

function Ask({ lessonId }: { lessonId: string }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const ask = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setAnswer("");
    trackEvent("course_ask", lessonId);
    try {
      const r = await fetch("/api/course/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId, question: q }),
      });
      const j = await r.json().catch(() => ({}));
      setAnswer(j.answer || j.error || "The helper is unavailable right now.");
    } catch {
      setAnswer("The helper is unavailable right now.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={ask} className="rounded-xl border border-slate-200 px-3 py-3">
      <label className="text-sm font-semibold text-slate-900" htmlFor={`ask-${lessonId}`}>
        💬 Ask a question about this lesson
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id={`ask-${lessonId}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={400}
          placeholder="e.g. Do I need a bond for a $200K job?"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button type="submit" disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? "…" : "Ask"}
        </button>
      </div>
      {answer && <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{answer}</p>}
      <p className="mt-1 text-[11px] text-slate-400">AI answers come only from this course. Always confirm details with the official source.</p>
    </form>
  );
}

function Complete({ initialState, trade }: { initialState: string; trade: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      let visitorId: string | undefined;
      try {
        visitorId = trackingIds().visitor_id;
      } catch {
        visitorId = undefined;
      }
      const r = await fetch("/api/course/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, state, visitorId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.token) throw new Error(j.error || "Couldn't save your completion.");
      trackEvent("course_completed", state);
      setToken(j.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your completion.");
    } finally {
      setBusy(false);
    }
  };
  if (token) {
    return (
      <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-5 text-center">
        <p className="text-lg font-bold text-emerald-900">🎉 You finished the course!</p>
        <a href={`/learn/certificate/${token}`} className="mt-3 inline-block rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white">
          View and print your certificate
        </a>
        <a href={`/radar?trade=${courseTrade(trade).id === "all" ? "construction" : courseTrade(trade).naics}&state=${state}`} className="mt-3 block text-sm font-semibold text-blue-700 underline">
          Find open construction bids in your state →
        </a>
      </div>
    );
  }
  const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-amber-300 bg-white p-5">
      <p className="text-lg font-bold text-slate-900">Get your certificate</p>
      <label className="block text-sm font-medium text-slate-700">
        Name for the certificate
        <input value={name} onChange={(e) => setName(e.target.value)} className={input} required />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} required />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Your state
        <input value={state} onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))} className={input} />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-slate-950 disabled:opacity-60">
        {busy ? "Saving…" : "Get my certificate"}
      </button>
      <p className="text-xs text-slate-500">Contrax uses your email only to follow up about this course. We never sell it.</p>
    </form>
  );
}
