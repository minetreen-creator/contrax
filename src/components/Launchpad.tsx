import { useEffect, useState, type FormEvent } from "react";
import {
  Rocket,
  ArrowRight,
  Check,
  BookOpen,
  FileText,
  Printer,
  Download,
} from "lucide-react";
import { STATE_NAMES } from "~/lib/contract-map";
import { trackEvent } from "~/lib/track";
import {
  LAUNCHPAD_KEY,
  REGISTRATION_TASKS,
  emptyLaunchpad,
  parseLaunchpad,
  launchpadSteps,
  launchpadRadarHref,
  capabilityReady,
  capabilityText,
  capabilityPrintHtml,
  safeOpportunityUrl,
  type LaunchpadProfile,
  type LaunchpadBidPlan,
} from "~/lib/launchpad";
import type { launchpadLearning } from "~/lib/launchpad-learning";

const FIELD =
  "mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";
const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50";
const PANEL =
  "scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8";
type CourseProgress = ReturnType<typeof launchpadLearning>;

export function Launchpad() {
  const [data, setData] = useState(emptyLaunchpad);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [courses, setCourses] = useState<CourseProgress>([]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    let alive = true;
    try {
      setData(parseLaunchpad(localStorage.getItem(LAUNCHPAD_KEY)));
    } catch {
      setError(
        "Saved data could not be read. You can work here, but saving will replace the unreadable draft. Download your statement before leaving if storage is unavailable.",
      );
    }
    setReady(true);
    async function refreshCourses() {
      try {
        const { launchpadLearning } = await import("~/lib/launchpad-learning");
        const progress = launchpadLearning((key) => localStorage.getItem(key));
        if (alive) setCourses(progress);
      } catch {
        if (alive)
          setError(
            "Course progress could not be read from this browser. Your courses are still available from the Learning Hub.",
          );
      }
    }
    void refreshCourses();
    window.addEventListener("focus", refreshCourses);
    window.addEventListener("storage", refreshCourses);
    trackEvent("launchpad_viewed");
    return () => {
      alive = false;
      window.removeEventListener("focus", refreshCourses);
      window.removeEventListener("storage", refreshCourses);
    };
  }, []);

  function changed() {
    setDirty(true);
    setMessage("");
  }
  function profile(field: keyof LaunchpadProfile, value: string) {
    changed();
    setData((previous) => ({
      ...previous,
      profile: { ...previous.profile, [field]: value },
    }));
  }
  function bid<K extends keyof LaunchpadBidPlan>(
    field: K,
    value: LaunchpadBidPlan[K],
  ) {
    changed();
    setData((previous) => ({
      ...previous,
      bid: { ...previous.bid, [field]: value },
    }));
  }
  function save(event?: FormEvent) {
    event?.preventDefault();
    if (!ready) return;
    try {
      const next = { ...data, updatedAt: new Date().toISOString() };
      localStorage.setItem(LAUNCHPAD_KEY, JSON.stringify(next));
      setData(next);
      setDirty(false);
      setError("");
      setMessage("Launchpad saved on this device.");
      trackEvent("launchpad_saved");
    } catch {
      setError(
        "This browser could not save your changes. Keep this page open and download your capability statement to preserve it.",
      );
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([capabilityText(data.profile)], {
        type: "text/plain;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "capability-statement.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    trackEvent("launchpad_statement_downloaded");
  }
  function printStatement() {
    const frame = document.createElement("iframe");
    frame.title = "Print capability statement";
    frame.style.cssText =
      "position:fixed;left:-10000px;top:0;width:800px;height:1000px;border:0";
    frame.srcdoc = capabilityPrintHtml(data.profile);
    frame.onload = () => {
      if (!frame.contentWindow) {
        setError("Printing is unavailable. Download the text version instead.");
        frame.remove();
        return;
      }
      frame.contentWindow.addEventListener("afterprint", () => frame.remove(), {
        once: true,
      });
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch {
        setError("Printing is unavailable. Download the text version instead.");
        frame.remove();
      }
    };
    document.body.append(frame);
    trackEvent("launchpad_statement_printed");
  }

  const steps = launchpadSteps(
    data,
    !!courses[0] && courses[0].done === courses[0].total,
  );
  const done = steps.filter((step) => step.done).length;
  const next = steps.find((step) => !step.done);
  const statementReady = capabilityReady(data.profile);
  const radarHref = launchpadRadarHref(data.profile);

  return (
    <main className="min-h-screen bg-slate-50 pb-16 text-slate-900">
      <section className="bg-[#07162e] px-5 py-12 text-white sm:px-8 sm:py-16">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-blue-300">
              <Rocket className="h-5 w-5" aria-hidden="true" /> Contrax
              Launchpad · Free
            </p>
            <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Learn it. Build it.
              <br />
              <span className="text-blue-400">Pursue your first contract.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300">
              Your free classes now lead somewhere practical: a clearer business
              profile, a capability statement, and a plan for your first
              opportunity.
            </p>
            <p className="mt-4 text-sm text-slate-400">
              No account or payment required. Drafts and course progress stay in
              this browser on this device. Save your changes before leaving.
            </p>
          </div>
          <div className="self-center rounded-2xl border border-blue-400/30 bg-blue-400/10 p-6">
            <p className="text-xs font-bold uppercase tracking-widest text-blue-200">
              Your next step
            </p>
            <h2 className="mt-3 text-2xl font-bold">
              {!ready
                ? "Loading your Launchpad…"
                : (next?.title ?? "Your launch plan is complete")}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              {next?.detail ??
                "Review your work, keep learning, and revisit your plan as new opportunities appear. Completed steps do not establish eligibility or guarantee an award."}
            </p>
            {ready && (
              <a
                href={next?.href ?? radarHref}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-500 px-5 py-3 font-bold text-white hover:bg-blue-600"
              >
                {next?.action ?? "Explore opportunities"}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      </section>
      <div className="mx-auto max-w-6xl space-y-8 px-5 pt-8 sm:px-8">
        <section className={PANEL} aria-label="Your launch plan">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
                From learning to action
              </p>
              <h2 className="mt-2 text-2xl font-bold">Your launch plan</h2>
            </div>
            <p className="text-sm font-semibold text-slate-600">
              {ready ? `${done} of ${steps.length} steps prepared` : "Loading…"}
            </p>
          </div>
          <progress
            value={done}
            max={steps.length}
            className="mt-5 h-3 w-full accent-blue-600"
            aria-label="Launch plan steps prepared"
          />
          <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {steps.map((step, index) => (
              <a
                key={step.id}
                href={step.href}
                className={`rounded-xl border p-4 transition hover:border-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${step.done ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}
              >
                <span className="flex items-center gap-2 text-sm font-bold">
                  {step.done ? (
                    <Check
                      aria-hidden="true"
                      className="h-4 w-4 text-emerald-700"
                    />
                  ) : (
                    <span className="text-blue-700">{index + 1}.</span>
                  )}
                  {step.title}
                </span>
                <span className="mt-2 block text-xs leading-relaxed text-slate-600">
                  {step.done ? "Prepared — review any time" : step.detail}
                </span>
              </a>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5">
            <p className="text-sm text-slate-600">
              {dirty
                ? "You have unsaved changes."
                : data.updatedAt
                  ? "Your saved draft is loaded."
                  : "Start below. You can save an incomplete draft."}
            </p>
            <button
              type="button"
              onClick={() => save()}
              disabled={!ready}
              className={BUTTON}
            >
              Save my Launchpad
            </button>
          </div>
          <p
            role="status"
            className="mt-3 text-sm font-medium text-emerald-800"
          >
            {message}
          </p>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </section>

        <section aria-labelledby="learning-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="learning-title" className="text-2xl font-bold">
              Your learning, connected
            </h2>
            <a
              href="/learn"
              className="text-sm font-semibold text-blue-700 underline underline-offset-4"
            >
              All free resources →
            </a>
          </div>
          {courses.length ? (
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {courses.map((course) => (
                <article key={course.id} className={PANEL}>
                  <BookOpen
                    aria-hidden="true"
                    className="h-6 w-6 text-blue-600"
                  />
                  <p className="mt-4 text-xs font-bold uppercase tracking-wide text-blue-700">
                    {course.level} · Free
                  </p>
                  <h3 className="mt-2 text-lg font-bold">{course.title}</h3>
                  <p className="mt-3 text-sm text-slate-600">
                    {course.done} of {course.total} lessons completed on this
                    device
                  </p>
                  <progress
                    value={course.done}
                    max={course.total}
                    aria-label={`${course.level} course progress`}
                    className="mt-3 h-2 w-full accent-blue-600"
                  />
                  <a
                    href={`${course.href}${data.profile.state && course.id !== "beginner" ? `?${new URLSearchParams({ state: data.profile.state, trade: data.profile.trade })}` : ""}`}
                    className="mt-4 inline-block text-sm font-bold text-blue-700 underline underline-offset-4"
                  >
                    {course.done === course.total
                      ? "Review course"
                      : course.done
                        ? "Continue learning"
                        : "Start course"}{" "}
                    →
                  </a>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-slate-600">
              Course progress loads from this device.{" "}
              <a href="/learn" className="text-blue-700 underline">
                Open the free courses
              </a>
              .
            </p>
          )}
        </section>

        <form
          onSubmit={save}
          id="business-profile"
          className={PANEL}
          aria-label="Business profile"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
            Step 1 · Your foundation
          </p>
          <h2 className="mt-2 text-2xl font-bold">Tell your business story</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Start with your company name, one main service and your state. The
            details you add here also fill your capability statement.
          </p>
          <fieldset
            disabled={!ready}
            className="mt-6 grid gap-5 md:grid-cols-2"
          >
            <ProfileField
              field="company"
              label="Business name"
              value={data.profile.company}
              onChange={profile}
            />
            <ProfileField
              field="trade"
              label="Main service or trade"
              hint="Use a service such as janitorial, trucking or HVAC."
              value={data.profile.trade}
              onChange={profile}
            />
            <label className="block text-sm font-semibold">
              Primary service state
              <select
                value={data.profile.state}
                onChange={(event) => profile("state", event.target.value)}
                className={FIELD}
              >
                <option value="">Choose your state</option>
                {Object.entries(STATE_NAMES)
                  .sort((a, b) => a[1].localeCompare(b[1]))
                  .map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
              </select>
            </label>
            <ProfileField
              field="contact"
              label="Contact name and role"
              value={data.profile.contact}
              onChange={profile}
            />
            <ProfileField
              field="email"
              label="Business email"
              type="email"
              value={data.profile.email}
              onChange={profile}
            />
            <ProfileField
              field="phone"
              label="Business phone (optional)"
              type="tel"
              value={data.profile.phone}
              onChange={profile}
            />
            <ProfileField
              field="website"
              label="Website (optional)"
              value={data.profile.website}
              onChange={profile}
            />
            <ProfileField
              field="naics"
              label="NAICS codes (optional)"
              hint="Include only codes relevant to the work you actually provide."
              value={data.profile.naics}
              onChange={profile}
            />
          </fieldset>
          <button type="submit" disabled={!ready} className={`${BUTTON} mt-6`}>
            Save business profile
          </button>
        </form>

        <section
          id="registration-plan"
          className={PANEL}
          aria-labelledby="registration-title"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
            Step 3 · Prepare deliberately
          </p>
          <h2 id="registration-title" className="mt-2 text-2xl font-bold">
            Your registration checklist
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Mark a planning task when you have reviewed it. These checks record
            your own progress; they do not verify registration or certification.
          </p>
          <div className="mt-5 space-y-3">
            {REGISTRATION_TASKS.map((task) => (
              <label
                key={task.id}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm"
              >
                <input
                  type="checkbox"
                  disabled={!ready}
                  checked={data.registrations.includes(task.id)}
                  onChange={(event) => {
                    changed();
                    setData((previous) => ({
                      ...previous,
                      registrations: event.target.checked
                        ? [...previous.registrations, task.id]
                        : previous.registrations.filter((id) => id !== task.id),
                    }));
                  }}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-blue-700"
                />
                {task.label}
              </label>
            ))}
          </div>
          <label className="mt-5 block text-sm font-semibold">
            Registration notes and unresolved items
            <textarea
              rows={3}
              maxLength={4000}
              value={data.registrationNotes}
              onChange={(event) => {
                changed();
                setData((previous) => ({
                  ...previous,
                  registrationNotes: event.target.value,
                }));
              }}
              className={FIELD}
              placeholder="Buyer portal, registration status, renewal date, or questions to resolve"
            />
          </label>
          <div className="mt-5 flex flex-wrap gap-4">
            <button
              type="button"
              disabled={!ready}
              onClick={() => save()}
              className={BUTTON}
            >
              Save checklist
            </button>
            <a
              href="/learn"
              className="self-center text-sm font-semibold text-blue-700 underline"
            >
              Read the free registration and certification guides →
            </a>
          </div>
        </section>

        <form
          id="capability-builder"
          onSubmit={save}
          className={PANEL}
          aria-label="Capability statement builder"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
            Step 4 · Something you can use
          </p>
          <h2 className="mt-2 text-2xl font-bold">
            Build your capability statement
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Write in your own words. Use only experience and credentials you can
            support. No awards, certifications or qualifications are added
            automatically.
          </p>
          <fieldset
            disabled={!ready}
            className="mt-6 grid gap-5 md:grid-cols-2"
          >
            <ProfileField
              field="summary"
              label="Company overview"
              multiline
              hint="Who you help, what you deliver, and where you work."
              value={data.profile.summary}
              onChange={profile}
            />
            <ProfileField
              field="competencies"
              label="Core competencies"
              multiline
              hint="List your specific services, one per line."
              value={data.profile.competencies}
              onChange={profile}
            />
            <ProfileField
              field="differentiators"
              label="What makes your business different?"
              multiline
              hint="Use concrete, supportable strengths."
              value={data.profile.differentiators}
              onChange={profile}
            />
            <ProfileField
              field="experience"
              label="Relevant experience (optional)"
              multiline
              hint="Commercial work counts. Name clients only when you have permission."
              value={data.profile.experience}
              onChange={profile}
            />
            <ProfileField
              field="certifications"
              label="Current certifications (optional)"
              multiline
              hint="Enter only certifications you hold. Leave blank if none."
              value={data.profile.certifications}
              onChange={profile}
            />
            <div className="space-y-5">
              <ProfileField
                field="uei"
                label="UEI (optional)"
                value={data.profile.uei}
                onChange={profile}
              />
              <ProfileField
                field="cage"
                label="CAGE code (optional)"
                value={data.profile.cage}
                onChange={profile}
              />
            </div>
          </fieldset>
          <div className="mt-6 flex flex-wrap gap-3">
            <button disabled={!ready} type="submit" className={BUTTON}>
              Save statement draft
            </button>
            <a
              href="#statement-preview"
              className="self-center text-sm font-semibold text-blue-700 underline"
            >
              See my statement preview ↓
            </a>
          </div>
        </form>

        <form
          id="bid-plan"
          onSubmit={save}
          className={PANEL}
          aria-label="First opportunity plan"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
            Steps 5 &amp; 6 · Take a practical next step
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-2xl font-bold">Your first-opportunity plan</h2>
            <a
              href={radarHref}
              onClick={() => trackEvent("course_radar_clicked", "launchpad")}
              className={BUTTON}
            >
              Find live opportunities
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </a>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            Choose a real listing, read its official notice, and record your
            decision. Passing on an unsuitable bid is a valid outcome.
          </p>
          <fieldset disabled={!ready} className="mt-6 space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <label className="block text-sm font-semibold">
                Opportunity title
                <input
                  value={data.bid.title}
                  onChange={(event) => bid("title", event.target.value)}
                  maxLength={300}
                  className={FIELD}
                />
              </label>
              <label className="block text-sm font-semibold">
                Opportunity or official notice link
                <input
                  type="url"
                  value={data.bid.url}
                  onChange={(event) => bid("url", event.target.value)}
                  maxLength={1000}
                  placeholder="https://…"
                  className={FIELD}
                />
              </label>
            </div>
            <fieldset className="space-y-3">
              <legend className="mb-3 text-sm font-semibold">
                What have you checked?
              </legend>
              {(
                [
                  [
                    "scope",
                    "I reviewed the scope against my services and capacity",
                  ],
                  [
                    "eligibility",
                    "I reviewed mandatory qualifications and recorded any gaps",
                  ],
                  [
                    "timing",
                    "I checked the deadline, time zone and required events",
                  ],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={data.bid[key]}
                    onChange={(event) => bid(key, event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-blue-700"
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <label className="block text-sm font-semibold">
              My decision
              <select
                value={data.bid.decision}
                onChange={(event) => bid("decision", event.target.value)}
                className={FIELD}
              >
                <option value="">Choose a decision</option>
                <option value="investigate">
                  Investigate — I have questions to resolve
                </option>
                <option value="bid">Pursue — prepare a bid</option>
                <option value="pass">
                  Pass — this opportunity is not suitable
                </option>
              </select>
            </label>
            <label className="block text-sm font-semibold">
              Why, and what still needs checking?
              <textarea
                value={data.bid.notes}
                onChange={(event) => bid("notes", event.target.value)}
                rows={3}
                maxLength={4000}
                className={FIELD}
              />
            </label>
            <div
              id="next-action"
              className="grid scroll-mt-6 gap-5 md:grid-cols-2"
            >
              <label className="block text-sm font-semibold">
                My next action
                <input
                  value={data.bid.action}
                  onChange={(event) => bid("action", event.target.value)}
                  maxLength={500}
                  placeholder="e.g. ask the buyer about the site visit"
                  className={FIELD}
                />
              </label>
              <label className="block text-sm font-semibold">
                Action date
                <input
                  type="date"
                  value={data.bid.date}
                  onChange={(event) => bid("date", event.target.value)}
                  className={FIELD}
                />
              </label>
            </div>
            <p className="text-xs text-slate-500">
              This is your planning date. It does not create a reminder or
              change the solicitation deadline.
            </p>
          </fieldset>
          <div className="mt-6 flex flex-wrap gap-4">
            <button type="submit" disabled={!ready} className={BUTTON}>
              Save my opportunity plan
            </button>
            {safeOpportunityUrl(data.bid.url) && (
              <a
                href={safeOpportunityUrl(data.bid.url)!}
                target="_blank"
                rel="noopener noreferrer"
                className="self-center text-sm font-semibold text-blue-700 underline"
              >
                Open recorded opportunity ↗
              </a>
            )}
          </div>
          <p className="mt-4 text-sm text-slate-600">
            Ready to manage ongoing pursuits?{" "}
            <a
              href="/pipeline"
              className="font-semibold text-blue-700 underline"
            >
              Open the bid pipeline
            </a>
            . Your Launchpad worksheet stays here; pipeline access follows your
            plan.
          </p>
        </form>

        <section
          id="statement-preview"
          className="scroll-mt-6"
          aria-labelledby="statement-title"
        >
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
                Your work, ready to review
              </p>
              <h2 id="statement-title" className="mt-2 text-2xl font-bold">
                Capability statement preview
              </h2>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={download}
                disabled={!statementReady}
                className={BUTTON}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download text
              </button>
              <button
                type="button"
                onClick={printStatement}
                disabled={!statementReady}
                className={BUTTON}
              >
                <Printer className="h-4 w-4" aria-hidden="true" />
                Print / Save PDF
              </button>
            </div>
          </div>
          {!statementReady && (
            <p className="mb-4 text-sm text-slate-600">
              To export, add your business name, service, state, contact, valid
              business email, company overview, core competencies and
              differentiators.
            </p>
          )}
          <article className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
            <div className="border-b-4 border-blue-500 bg-[#102342] p-7 text-white">
              <p className="text-xs font-bold uppercase tracking-[.2em] text-blue-200">
                Capability statement · Draft
              </p>
              <h3 className="mt-3 break-words text-3xl font-bold">
                {data.profile.company || "Your company name"}
              </h3>
              <p className="mt-2 text-slate-300">
                {data.profile.trade || "Your services"}
                {data.profile.state
                  ? ` · ${STATE_NAMES[data.profile.state] ?? data.profile.state}`
                  : ""}
              </p>
            </div>
            <div className="grid gap-8 p-7 md:grid-cols-[1.5fr_1fr]">
              <div className="space-y-6">
                {(
                  [
                    ["Company overview", data.profile.summary],
                    ["Core competencies", data.profile.competencies],
                    ["Differentiators", data.profile.differentiators],
                    ["Relevant experience", data.profile.experience],
                  ] as const
                )
                  .filter(([, value], index) => index < 3 || value.trim())
                  .map(([label, value]) => (
                    <div key={label}>
                      <h4 className="text-sm font-bold uppercase tracking-wide text-blue-800">
                        {label}
                      </h4>
                      <p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-slate-700">
                        {value || "Add your details in the builder above."}
                      </p>
                    </div>
                  ))}
              </div>
              <dl className="space-y-4 rounded-xl bg-slate-50 p-5">
                {(
                  [
                    ["Contact", data.profile.contact],
                    ["Email", data.profile.email],
                    ["Phone", data.profile.phone],
                    ["Website", data.profile.website],
                    ["NAICS", data.profile.naics],
                    ["UEI", data.profile.uei],
                    ["CAGE", data.profile.cage],
                    [
                      "Certifications (business-reported)",
                      data.profile.certifications,
                    ],
                  ] as const
                )
                  .filter(([, value]) => value.trim())
                  .map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        {label}
                      </dt>
                      <dd className="mt-1 whitespace-pre-line break-words text-sm text-slate-800">
                        {value}
                      </dd>
                    </div>
                  ))}
              </dl>
            </div>
            <p className="border-t border-slate-200 px-7 py-4 text-xs text-slate-500">
              Prepared using Contrax Launchpad. Business-provided information;
              verify all claims before sharing. This document is not a
              certification or submitted proposal.
            </p>
          </article>
        </section>
        <aside className="rounded-2xl border border-blue-200 bg-blue-50 p-6 text-sm leading-relaxed text-slate-700">
          <FileText aria-hidden="true" className="mb-3 h-6 w-6 text-blue-700" />
          <h2 className="text-lg font-bold text-slate-900">
            Free learning. Useful work. A clearer path forward.
          </h2>
          <p className="mt-2">
            Courses, Launchpad planning and capability statement exports are
            free. Radar preview limits and paid tool access still apply. Save
            locally and export your statement before clearing browser data;
            drafts do not sync between devices.
          </p>
          <a
            href="/pricing"
            className="mt-3 inline-block font-semibold text-blue-700 underline"
          >
            Explore optional paid tools →
          </a>
        </aside>
      </div>
    </main>
  );
}

function ProfileField({
  field,
  label,
  hint,
  value,
  onChange,
  multiline = false,
  type = "text",
}: {
  field: keyof LaunchpadProfile;
  label: string;
  hint?: string;
  value: string;
  onChange: (field: keyof LaunchpadProfile, value: string) => void;
  multiline?: boolean;
  type?: string;
}) {
  const id = `launchpad-${field}`;
  return (
    <label htmlFor={id} className="block text-sm font-semibold">
      {label}
      {multiline ? (
        <textarea
          id={id}
          value={value}
          rows={4}
          maxLength={4000}
          onChange={(event) => onChange(field, event.target.value)}
          className={FIELD}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          maxLength={300}
          onChange={(event) => onChange(field, event.target.value)}
          className={FIELD}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
      )}{" "}
      {hint && (
        <span
          id={`${id}-hint`}
          className="mt-2 block text-xs font-normal leading-relaxed text-slate-500"
        >
          {hint}
        </span>
      )}
    </label>
  );
}
