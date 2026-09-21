/**
 * /nonprofit/apply — the Nonprofit Free application page (greenfield).
 *
 * Deliberately NOT an extension of signup.tsx: that page is conversion-instrumented and
 * frozen, and this is an account feature that happens AFTER signup. The page collects
 * exactly the owner's field list (legal org name, EIN, website, work email, state,
 * applicant name + role) plus the authorization tick, posts them to
 * /api/nonprofit/apply, and renders per-field validation errors from the API without
 * inventing any wording of its own — every string comes from src/lib/nonprofit-copy.ts.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import {
  NONPROFIT_APPLY_AUTHORIZATION_LABEL,
  NONPROFIT_APPLY_ELIGIBILITY,
  NONPROFIT_APPLY_FIELDS,
  NONPROFIT_APPLY_HEADLINE,
  NONPROFIT_APPLY_INTRO,
  NONPROFIT_APPLY_MANUAL_PATH,
  NONPROFIT_APPLY_REVIEW_WINDOW,
  NONPROFIT_APPLY_SIGNED_OUT_COPY,
  NONPROFIT_APPLY_SIGNED_OUT_LOGIN_LABEL,
  NONPROFIT_APPLY_SIGNED_OUT_SIGNUP_LABEL,
  NONPROFIT_APPLY_SUBMIT_LABEL,
  NONPROFIT_STATUS_PAGE_LINK_LABEL,
  safeNonprofitReturnPath,
} from "~/lib/nonprofit-copy";
import { US_STATES } from "~/lib/states";

const TITLE = "Apply for Nonprofit Free — Contrax";
// The description is the owner's promise, read from the ONE place it is written down.
const DESC = NONPROFIT_APPLY_INTRO;
const APPLY_PATH = "/nonprofit/apply";

export const Route = createFileRoute("/nonprofit/apply")({
  component: NonprofitApplyPage,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type SessionState = "checking" | "signed-in" | "signed-out";
interface FormState {
  orgName: string;
  ein: string;
  workEmail: string;
  website: string;
  state: string;
  contactName: string;
  contactRole: string;
}

const EMPTY_FORM: FormState = {
  orgName: "",
  ein: "",
  workEmail: "",
  website: "",
  state: "",
  contactName: "",
  contactRole: "",
};

function NonprofitApplyPage() {
  const [session, setSession] = useState<SessionState>("checking");
  const [existingStatus, setExistingStatus] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [authorized, setAuthorized] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [returnPath, setReturnPath] = useState("/nonprofit/status");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Only a same-site absolute path is honoured; anything else returns to the status page.
    // The guard itself lives in the copy module (`safeNonprofitReturnPath`) so the
    // open-redirect rule — never `//evil.com`, never a backslash — is testable rather than a
    // regex re-read by hand at every call site.
    const next = safeNonprofitReturnPath(params.get("next"));
    if (next) setReturnPath(next);
    let cancelled = false;
    fetch("/api/nonprofit/status", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 401) {
          setSession("signed-out");
          return;
        }
        const data = (await response.json().catch(() => null)) as
          | { application?: { status?: string } | null }
          | null;
        setExistingStatus(data?.application?.status ?? null);
        setSession("signed-in");
      })
      .catch(() => {
        if (!cancelled) setSession("signed-out");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function setField(field: keyof FormState, value: string) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const response = await fetch("/api/nonprofit/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, orgUseConfirmed: authorized }),
      });
      const data = (await response.json().catch(() => null)) as
        | { errors?: Record<string, string>; error?: string }
        | null;
      if (response.status === 401) {
        setSession("signed-out");
        return;
      }
      if (response.status === 400) {
        setErrors(data?.errors ?? {});
        setFormError(data?.errors ? null : (data?.error ?? "Please check the form and try again."));
        return;
      }
      if (!response.ok) {
        setFormError(data?.error ?? "We couldn't submit the application just now. Please try again.");
        return;
      }
      window.location.assign(returnPath);
    } catch {
      setFormError("We couldn't reach Contrax just now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <a href="/" className="text-lg font-bold text-slate-900">
            Contrax
          </a>
          <a href="/grants" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            Grants
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-bold text-slate-900">{NONPROFIT_APPLY_HEADLINE}</h1>
        <p className="mt-3 text-slate-600">{NONPROFIT_APPLY_INTRO}</p>
        <ul className="mt-6 space-y-2 text-sm text-slate-600">
          {NONPROFIT_APPLY_ELIGIBILITY.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden="true" className="text-blue-600">
                •
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 rounded-xl bg-white p-4 text-sm text-slate-600 shadow-sm">
          {NONPROFIT_APPLY_MANUAL_PATH} {NONPROFIT_APPLY_REVIEW_WINDOW}
        </p>

        {session === "checking" && (
          <p className="mt-8 text-sm text-slate-500">Checking your account…</p>
        )}

        {session === "signed-out" && (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-slate-700">{NONPROFIT_APPLY_SIGNED_OUT_COPY}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a
                href={`/signup?next=${encodeURIComponent(APPLY_PATH)}`}
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                {NONPROFIT_APPLY_SIGNED_OUT_SIGNUP_LABEL}
              </a>
              <a
                href={`/login?next=${encodeURIComponent(APPLY_PATH)}`}
                className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                {NONPROFIT_APPLY_SIGNED_OUT_LOGIN_LABEL}
              </a>
            </div>
          </div>
        )}

        {session === "signed-in" && existingStatus !== null && (
          <div className="mt-8 rounded-2xl border border-blue-200 bg-blue-50 p-6">
            <p className="text-sm text-slate-700">
              This account already has a Nonprofit Free application on file. Applying again updates
              the same application — you can also check it on your status page.
            </p>
            <a
              href="/nonprofit/status"
              className="mt-3 inline-block text-sm font-semibold text-blue-700 hover:text-blue-800"
            >
              {NONPROFIT_STATUS_PAGE_LINK_LABEL} →
            </a>
          </div>
        )}

        {session === "signed-in" && (
          <form onSubmit={onSubmit} className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div>
              <label htmlFor="orgName" className="block text-sm font-semibold text-slate-700">
                {NONPROFIT_APPLY_FIELDS.orgName}
              </label>
              <input
                id="orgName"
                name="orgName"
                type="text"
                value={form.orgName}
                onChange={(event) => setField("orgName", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
              />
              {errors.orgName && <p className="mt-1 text-sm text-red-600">{errors.orgName}</p>}
            </div>
            <div>
              <label htmlFor="ein" className="block text-sm font-semibold text-slate-700">
                {NONPROFIT_APPLY_FIELDS.ein}
              </label>
              <input
                id="ein"
                name="ein"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={form.ein}
                onChange={(event) => setField("ein", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
              />
              <p className="mt-1 text-xs text-slate-500">
                Nine digits, as they appear on IRS records (for example 01-2345678).
              </p>
              {errors.ein && <p className="mt-1 text-sm text-red-600">{errors.ein}</p>}
            </div>
            <div>
              <label htmlFor="workEmail" className="block text-sm font-semibold text-slate-700">
                {NONPROFIT_APPLY_FIELDS.workEmail}
              </label>
              <input
                id="workEmail"
                name="workEmail"
                type="text"
                inputMode="email"
                value={form.workEmail}
                onChange={(event) => setField("workEmail", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
              />
              {errors.workEmail && <p className="mt-1 text-sm text-red-600">{errors.workEmail}</p>}
            </div>
            <div>
              <label htmlFor="website" className="block text-sm font-semibold text-slate-700">
                {NONPROFIT_APPLY_FIELDS.website}
              </label>
              <input
                id="website"
                name="website"
                type="text"
                value={form.website}
                onChange={(event) => setField("website", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
              />
              {errors.website && <p className="mt-1 text-sm text-red-600">{errors.website}</p>}
            </div>
            <div>
              <label htmlFor="state" className="block text-sm font-semibold text-slate-700">
                {NONPROFIT_APPLY_FIELDS.state}
              </label>
              <select
                id="state"
                name="state"
                value={form.state}
                onChange={(event) => setField("state", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
              >
                <option value="">Select a state</option>
                {US_STATES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              {errors.state && <p className="mt-1 text-sm text-red-600">{errors.state}</p>}
            </div>
            <div>
              <label htmlFor="contactName" className="block text-sm font-semibold text-slate-700">
                {NONPROFIT_APPLY_FIELDS.contactName}
              </label>
              <input
                id="contactName"
                name="contactName"
                type="text"
                value={form.contactName}
                onChange={(event) => setField("contactName", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
              />
              {errors.contactName && <p className="mt-1 text-sm text-red-600">{errors.contactName}</p>}
            </div>
            <div>
              <label htmlFor="contactRole" className="block text-sm font-semibold text-slate-700">
                {NONPROFIT_APPLY_FIELDS.contactRole}
              </label>
              <input
                id="contactRole"
                name="contactRole"
                type="text"
                value={form.contactRole}
                onChange={(event) => setField("contactRole", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
              />
              {errors.contactRole && <p className="mt-1 text-sm text-red-600">{errors.contactRole}</p>}
            </div>
            <div>
              <label htmlFor="authorized" className="flex items-start gap-3 text-sm text-slate-700">
                <input
                  id="authorized"
                  name="authorized"
                  type="checkbox"
                  checked={authorized}
                  onChange={(event) => setAuthorized(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <span>{NONPROFIT_APPLY_AUTHORIZATION_LABEL}</span>
              </label>
              {errors.orgUseConfirmed && (
                <p className="mt-1 text-sm text-red-600">{errors.orgUseConfirmed}</p>
              )}
            </div>
            {formError && (
              <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                {formError}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {busy ? "Submitting…" : NONPROFIT_APPLY_SUBMIT_LABEL}
            </button>
            <p className="text-xs text-slate-500">
              Your EIN is used only to check your organization against IRS tax-exempt records. It is
              never shown publicly.
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
