/**
 * /nonprofit/status — the applicant's own Nonprofit Free state.
 *
 * Reads /api/nonprofit/status (session-scoped there and structurally unable to return
 * another account's row). This page shows the state, the copy that belongs to it, the
 * owner's verification wording WHEN the mirror has a posting date, and the pending
 * counters' promise — never the EIN, never a reason class, never anyone else's data.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  NONPROFIT_APPEAL_EMAIL,
  NONPROFIT_PROMISE,
  NONPROFIT_STATUS_APPLY_LINK_LABEL,
  NONPROFIT_STATUS_HEADLINE,
  NONPROFIT_STATUS_NONE_COPY,
} from "~/lib/nonprofit-copy";

const TITLE = "Your Nonprofit Free status — Contrax";
const DESC = "Your Nonprofit Free application state and what it unlocks.";

export const Route = createFileRoute("/nonprofit/status")({
  component: NonprofitStatusPage,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

interface PublicApplication {
  orgName: string;
  state: string | null;
  status: string;
  statusLabel: string | null;
  statusDetail: string | null;
  submittedAt: string | null;
  grantedAt: string | null;
  reverifyDueAt: string | null;
  verificationMethod: string | null;
  verificationWording: string | null;
  supportingDocsRequested: boolean;
  tier: string;
  pendingLimits: string | null;
}

type LoadState = "loading" | "signed-out" | "ready" | "error";

function NonprofitStatusPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [application, setApplication] = useState<PublicApplication | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/nonprofit/status", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 401) {
          setState("signed-out");
          return;
        }
        if (!response.ok) {
          setState("error");
          return;
        }
        const data = (await response.json().catch(() => null)) as
          | { application?: PublicApplication | null }
          | null;
        setApplication(data?.application ?? null);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        <h1 className="text-3xl font-bold text-slate-900">{NONPROFIT_STATUS_HEADLINE}</h1>
        <p className="mt-3 text-slate-600">{NONPROFIT_PROMISE}</p>

        {state === "loading" && <p className="mt-8 text-sm text-slate-500">Loading your status…</p>}

        {state === "signed-out" && (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-slate-700">Sign in to see the status of your application.</p>
            <a
              href="/login?next=%2Fnonprofit%2Fstatus"
              className="mt-4 inline-block rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Sign in
            </a>
          </div>
        )}

        {state === "error" && (
          <p className="mt-8 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
            We couldn't load your status just now. Please refresh, or write to {NONPROFIT_APPEAL_EMAIL}.
          </p>
        )}

        {state === "ready" && application === null && (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-slate-700">{NONPROFIT_STATUS_NONE_COPY}</p>
            <a
              href="/nonprofit/apply"
              className="mt-4 inline-block rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              {NONPROFIT_STATUS_APPLY_LINK_LABEL}
            </a>
          </div>
        )}

        {state === "ready" && application !== null && (
          <section className="mt-8 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {application.statusLabel ?? "Application"}
              </p>
              <h2 className="mt-1 text-xl font-bold text-slate-900">{application.orgName}</h2>
            </div>
            {application.statusDetail && (
              <p className="text-sm text-slate-600">{application.statusDetail}</p>
            )}
            {application.status === "approved" && application.verificationWording && (
              <p className="rounded-xl bg-green-50 p-3 text-sm text-green-800">
                {application.verificationWording}
              </p>
            )}
            {application.supportingDocsRequested && application.status !== "approved" && (
              <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">
                A supporting document is needed to finish the review — reply to the email we sent, or
                write to {NONPROFIT_APPEAL_EMAIL}.
              </p>
            )}
            {application.pendingLimits && (
              <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                {application.pendingLimits}
              </p>
            )}
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Submitted</dt>
                <dd className="text-slate-800">
                  {application.submittedAt ? application.submittedAt.slice(0, 10) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">State</dt>
                <dd className="text-slate-800">{application.state ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Access granted</dt>
                <dd className="text-slate-800">
                  {application.grantedAt ? application.grantedAt.slice(0, 10) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Next review</dt>
                <dd className="text-slate-800">
                  {application.reverifyDueAt ? application.reverifyDueAt.slice(0, 10) : "—"}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-slate-500">
              Your EIN is never displayed here or anywhere public — it is used only to check your
              organization against IRS tax-exempt records.
            </p>
            <a href="/grants" className="inline-block text-sm font-semibold text-blue-700 hover:text-blue-800">
              Go to Contrax Grants →
            </a>
          </section>
        )}

      </main>
    </div>
  );
}
