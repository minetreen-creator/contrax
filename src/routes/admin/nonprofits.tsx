import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { getCurrentUser } from "~/lib/auth";
import { AdminHeader, AdminTabs, SectionError, SectionLoading, timeFmt } from "~/components/AdminShared";
import {
  NONPROFIT_REVIEW_APPROVE_NOTICE,
  NONPROFIT_REVIEW_AUDIT_EMPTY_COPY,
  NONPROFIT_REVIEW_DENY_NOTE_LABEL,
  NONPROFIT_REVIEW_DOMAIN_DETAIL,
  NONPROFIT_REVIEW_DOMAIN_LABEL,
  NONPROFIT_REVIEW_QUEUE_EMPTY_COPY,
  NONPROFIT_REVIEW_QUEUE_HEADLINE,
  NONPROFIT_REVIEW_REFRESH_FLAG,
  NONPROFIT_REVIEW_RELEASE_CONFIRMATION,
  NONPROFIT_REVIEW_RELEASE_NOTICE,
  NONPROFIT_REVIEW_REQUEST_INFO_NOTICE,
  NONPROFIT_REVIEW_SLA_DETAIL,
  NONPROFIT_REVIEW_SLA_WORDING,
  nonprofitReviewElapsedCopy,
} from "~/lib/nonprofit-copy";

/**
 * /admin/nonprofits — the Nonprofit Free review queue (phase 2 unit B).
 *
 * WHAT A REVIEWER SEES (one screen, no tabs to hunt through):
 *   • the QUEUE: the owner's default view (`pending` + `manual_review`, oldest first, so
 *     the applicant waiting longest is at the top) plus a filter for "Denied & revoked" —
 *     without it a released-EIN decision could never be reached (owner lock: release is an
 *     EXPLICIT admin action, no automatic cooldown) — and for "Approved"/"All".
 *   • the DETAIL: the applicant's fields, the whole IRS match result the engine recorded
 *     (verdict, reason, matched name + tier, BMF status/meaning, subsection, group number,
 *     public-78, revocation and reinstatement dates, and which mirror file/date decided it),
 *     the refresh-driven reverify evidence, the AUDIT HISTORY from migration 046, and the
 *     domain comparison — recomputed server-side on this request and labelled
 *     "secondary signal — never a verdict", because the owner's rule is that a domain never
 *     decides anything.
 *
 * THE SLA IS A WORDING, NOT A DATE. Public holidays are not modelled, so the queue shows
 * the ticket's age (weekdays elapsed) and the owner's "within 3 business days" commitment —
 * never a computed due-by date and never a promise of an instant decision.
 *
 * AUTH: the loader mirrors /admin and /admin/signups exactly — no user ⇒ /login, a
 * non-admin ⇒ /dashboard?notice=admin-only — and the page declares `noindex, nofollow`. The
 * data itself is fetched from /api/admin/nonprofit-applications, which re-derives the admin
 * gate on every request (the loader guard is UX, the API gate is the security boundary).
 *
 * NO SERVER MODULE IS IMPORTED HERE. This file is a client bundle: the types below are
 * declared locally and every string comes from ~/lib/nonprofit-copy (the same reason Unit A
 * split that module out — a `*.server` import in a client route fails the build).
 */

type QueueFilter = "queue" | "denied_revoked" | "approved" | "all";
type ReviewAction = "approve" | "deny" | "request_info" | "release";

interface QueueAge {
  calendarDays: number;
  businessDays: number;
}

interface QueueRow {
  id: number;
  orgName: string;
  workEmail: string;
  website: string | null;
  state: string | null;
  contactName: string;
  contactRole: string | null;
  status: string;
  decision: string | null;
  reasonClass: string | null;
  submittedNameNormalized: string | null;
  matchedBmfName: string | null;
  bmfNameTier: string | null;
  supportingDocsRequested: boolean;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  age?: QueueAge;
}

interface AuditRow {
  id: number;
  action: string;
  actorUserId: number | null;
  actorEmail: string | null;
  reasonCode: string | null;
  internalNote: string | null;
  priorStatus: string;
  newStatus: string;
  createdAt: string | null;
}

interface ReviewDetail extends Omit<QueueRow, "age"> {
  age: QueueAge;
  decisionReason: string | null;
  decisionFlags: string[];
  grantedAt: string | null;
  reverifyDueAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  bmfStatus: string | null;
  bmfSubsection: string | null;
  bmfGroupNo: string | null;
  bmfPostingDate: string | null;
  bmfSourceRef: string | null;
  pub78: boolean | null;
  pub78DeductibilityCode: string | null;
  onRevocationList: boolean | null;
  revocationDate: string | null;
  revocationPostingDate: string | null;
  reinstatementDate: string | null;
  irs: {
    decision: string | null;
    decisionReason: string | null;
    reasonClass: string | null;
    decisionFlags: string[];
    matchedBmfName: string | null;
    bmfNameTier: string | null;
    bmfStatus: string | null;
    bmfStatusMeaning: string | null;
    bmfSubsection: string | null;
    bmfSubsectionLabel: string | null;
    bmfGroupNo: string | null;
    bmfPostingDate: string | null;
    bmfSourceRef: string | null;
    pub78: boolean | null;
    pub78DeductibilityCode: string | null;
    onRevocationList: boolean | null;
    revocationDate: string | null;
    revocationPostingDate: string | null;
    reinstatementDate: string | null;
    decidedBy: string | null;
    decidedAt: string | null;
  };
  einClaim: { claimedByUserId: number | null; claimedOrgName: string | null } | null;
  refreshReverify: unknown;
  domainSignal: { label: string; corresponds: boolean; checked: string | null; basis: string | null };
  audit: AuditRow[];
}

const FILTERS: { key: QueueFilter; label: string }[] = [
  { key: "queue", label: "Queue" },
  { key: "denied_revoked", label: "Denied & revoked" },
  { key: "approved", label: "Approved" },
  { key: "all", label: "All" },
];

const ACTION_LABELS: Record<ReviewAction, string> = {
  approve: "Approve",
  deny: "Deny",
  request_info: "Request documents",
  release: "Release EIN",
};

/** Which actions the guarded transitions will actually accept for a row in this status. */
function actionsFor(status: string): ReviewAction[] {
  if (status === "pending" || status === "manual_review") return ["approve", "deny", "request_info"];
  if (status === "denied" || status === "revoked") return ["release"];
  return [];
}

function statusChip(status: string): string {
  if (status === "approved") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "denied") return "bg-rose-50 text-rose-700 border-rose-200";
  if (status === "revoked") return "bg-amber-50 text-amber-800 border-amber-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function Field({ label, value }: { label: string; value: string | number | boolean | null | undefined }) {
  const shown = value === null || value === undefined || value === "" ? "—" : String(value);
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800 break-words">{shown}</dd>
    </div>
  );
}

/** The refresh-driven reverify surface: the flag plus whatever the pass recorded. */
function RefreshReverifyPanel({ flags, refresh }: { flags: string[]; refresh: unknown }) {
  const entries =
    refresh && typeof refresh === "object"
      ? Object.entries(refresh as Record<string, unknown>).filter(
          ([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value),
        )
      : [];
  const flagged = flags.includes(NONPROFIT_REVIEW_REFRESH_FLAG);
  if (!flagged && entries.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-xs font-semibold text-amber-900">
        Refresh-driven reverify
        {flagged ? " — this row was re-checked after an IRS records refresh" : ""}
      </p>
      <p className="mt-1 text-[11px] text-amber-800">
        Re-read the IRS mirror (a refresh can change a verdict) before deciding.
      </p>
      {entries.length > 0 ? (
        <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {entries.map(([key, value]) => (
            <Field key={key} label={key} value={value as string | number | boolean | null} />
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function NonprofitsPage() {
  const [filter, setFilter] = useState<QueueFilter>("queue");
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [result, setResult] = useState("");

  const loadQueue = useCallback(async (next: QueueFilter) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/nonprofit-applications?filter=${next}`);
      const body = (await res.json()) as { applications?: QueueRow[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to load the review queue");
      setRows(body.applications ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the review queue");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    setDetailError("");
    try {
      const res = await fetch(`/api/admin/nonprofit-applications?id=${id}`);
      const body = (await res.json()) as { application?: ReviewDetail; error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to load this application");
      setDetail(body.application ?? null);
    } catch (err) {
      setDetail(null);
      setDetailError(err instanceof Error ? err.message : "Failed to load this application");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue(filter);
  }, [filter, loadQueue]);

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    setNote("");
    setResult("");
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const decide = useCallback(
    async (action: ReviewAction) => {
      if (selectedId == null) return;
      if (action === "release" && !window.confirm(`${NONPROFIT_REVIEW_RELEASE_NOTICE}\n\nRelease this EIN?`)) {
        return;
      }
      setBusy(action);
      setResult("");
      setDetailError("");
      try {
        const res = await fetch("/api/admin/nonprofit-decide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: selectedId, action, note }),
        });
        const body = (await res.json()) as { ok?: boolean; error?: string; newStatus?: string };
        if (!res.ok) throw new Error(body.error || "Failed to record the decision");
        setResult(action === "release" ? NONPROFIT_REVIEW_RELEASE_CONFIRMATION : `${ACTION_LABELS[action]} recorded.`);
        setNote("");
        await loadDetail(selectedId);
        await loadQueue(filter);
      } catch (err) {
        setDetailError(err instanceof Error ? err.message : "Failed to record the decision");
      } finally {
        setBusy(null);
      }
    },
    [selectedId, note, filter, loadDetail, loadQueue],
  );

  const actions = detail ? actionsFor(detail.status) : [];

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{NONPROFIT_REVIEW_QUEUE_HEADLINE}</h1>
          <p className="mt-1 text-sm text-slate-600">
            SLA: {NONPROFIT_REVIEW_SLA_WORDING}. {NONPROFIT_REVIEW_SLA_DETAIL}
          </p>
        </div>
        <AdminTabs active="nonprofits" />

        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
          {FILTERS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => {
                setFilter(entry.key);
                setSelectedId(null);
              }}
              aria-current={filter === entry.key ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                filter === entry.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">Applications ({rows.length})</h2>
            {error ? (
              <SectionError message={error} />
            ) : loading ? (
              <SectionLoading message="Loading the queue…" />
            ) : rows.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
                {NONPROFIT_REVIEW_QUEUE_EMPTY_COPY}
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <ul className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(row.id)}
                        className={`w-full px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                          selectedId === row.id ? "bg-slate-50" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{row.orgName}</p>
                            <p className="truncate text-xs text-slate-500">
                              {row.contactName}
                              {row.state ? ` · ${row.state}` : ""} · submitted {timeFmt(row.createdAt)}
                            </p>
                            <p className="truncate text-xs text-slate-400">
                              {nonprofitReviewElapsedCopy(row.age?.businessDays ?? 0)}
                              {row.matchedBmfName ? ` · IRS record: ${row.matchedBmfName}` : ""}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusChip(row.status)}`}>
                              {row.status}
                            </span>
                            {row.supportingDocsRequested ? (
                              <span className="text-[10px] font-semibold uppercase text-amber-700">doc request open</span>
                            ) : null}
                            {row.releasedAt ? (
                              <span className="text-[10px] font-semibold uppercase text-slate-500">EIN released</span>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">Application detail</h2>
            {selectedId == null ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
                Select an application to review it.
              </div>
            ) : detailError ? (
              <SectionError message={detailError} />
            ) : detailLoading || !detail ? (
              <SectionLoading message="Loading the application…" />
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">{detail.orgName}</h3>
                      <p className="text-xs text-slate-500">
                        Submitted {timeFmt(detail.createdAt)} · {nonprofitReviewElapsedCopy(detail.age.businessDays)}{" "}
                        ({detail.age.calendarDays} calendar days) · SLA {NONPROFIT_REVIEW_SLA_WORDING}
                      </p>
                    </div>
                    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusChip(detail.status)}`}>
                      {detail.status}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3">
                    <Field label="Legal name (submitted)" value={detail.submittedNameNormalized} />
                    <Field label="Work email" value={detail.workEmail} />
                    <Field label="Website" value={detail.website} />
                    <Field label="State" value={detail.state} />
                    <Field label="Contact" value={detail.contactName} />
                    <Field label="Role" value={detail.contactRole} />
                    <Field label="Granted at" value={detail.grantedAt ? timeFmt(detail.grantedAt) : null} />
                    <Field label="Reverify due" value={detail.reverifyDueAt ? timeFmt(detail.reverifyDueAt) : null} />
                    <Field label="Reviewed by (last)" value={detail.reviewedBy} />
                    <Field label="Reviewed at (last)" value={detail.reviewedAt ? timeFmt(detail.reviewedAt) : null} />
                    <Field label="Last note (internal)" value={detail.reviewNotes} />
                    <Field label="EIN released at" value={detail.releasedAt ? timeFmt(detail.releasedAt) : null} />
                  </dl>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-bold text-slate-900">IRS match result</h3>
                  <dl className="mt-3 grid grid-cols-2 gap-3">
                    <Field label="Verdict" value={detail.irs.decision} />
                    <Field label="Reason" value={detail.irs.decisionReason} />
                    <Field label="Reason class" value={detail.irs.reasonClass} />
                    <Field label="Name tier" value={detail.irs.bmfNameTier} />
                    <Field label="Matched IRS name" value={detail.irs.matchedBmfName} />
                    <Field label="BMF status" value={detail.irs.bmfStatus} />
                    <Field label="BMF status meaning" value={detail.irs.bmfStatusMeaning} />
                    <Field label="Subsection" value={detail.irs.bmfSubsectionLabel ?? detail.irs.bmfSubsection} />
                    <Field label="Group number" value={detail.irs.bmfGroupNo} />
                    <Field label="BMF posting date" value={detail.irs.bmfPostingDate} />
                    <Field label="Source" value={detail.irs.bmfSourceRef} />
                    <Field label="Public 78" value={detail.irs.pub78} />
                    <Field label="Deductibility code" value={detail.irs.pub78DeductibilityCode} />
                    <Field label="On revocation list" value={detail.irs.onRevocationList} />
                    <Field label="Revocation date" value={detail.irs.revocationDate} />
                    <Field label="Revocation posting date" value={detail.irs.revocationPostingDate} />
                    <Field label="Reinstatement date" value={detail.irs.reinstatementDate} />
                    <Field label="Decided by" value={detail.irs.decidedBy} />
                    <Field label="Decided at" value={detail.irs.decidedAt ? timeFmt(detail.irs.decidedAt) : null} />
                  </dl>
                  {detail.irs.decisionFlags.length > 0 ? (
                    <p className="mt-3 text-xs text-slate-500">
                      Decision flags: <span className="font-mono">{detail.irs.decisionFlags.join(", ")}</span>
                    </p>
                  ) : null}
                  {detail.einClaim ? (
                    <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                      EIN conflict on record: another account (user id {detail.einClaim.claimedByUserId ?? "unknown"}) was
                      found holding this EIN{detail.einClaim.claimedOrgName ? ` as ${detail.einClaim.claimedOrgName}` : ""}.
                    </p>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-bold text-slate-900">Domain comparison</h3>
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {NONPROFIT_REVIEW_DOMAIN_LABEL}
                  </p>
                  <p className="mt-2 text-sm text-slate-800">
                    {detail.domainSignal.corresponds
                      ? "The submitted domain corresponds to the organization name."
                      : "No correspondence found between the submitted domain and the organization name."}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Checked: {detail.domainSignal.checked ?? "—"}
                    {detail.domainSignal.basis ? ` (from the ${detail.domainSignal.basis.replace("_", " ")})` : ""}
                  </p>
                  <p className="mt-2 text-[11px] text-slate-400">{NONPROFIT_REVIEW_DOMAIN_DETAIL}</p>
                </div>

                <RefreshReverifyPanel flags={detail.irs.decisionFlags} refresh={detail.refreshReverify} />

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-bold text-slate-900">Audit history</h3>
                  {detail.audit.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">{NONPROFIT_REVIEW_AUDIT_EMPTY_COPY}</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {detail.audit.map((entry) => (
                        <li key={entry.id} className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                          <p className="text-xs font-semibold text-slate-800">
                            {entry.action} · {entry.priorStatus} → {entry.newStatus} · {timeFmt(entry.createdAt)}
                          </p>
                          <p className="text-[11px] text-slate-500">{entry.actorEmail ?? "—"}</p>
                          {entry.internalNote ? (
                            <p className="mt-1 text-[11px] text-slate-600">{entry.internalNote}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-bold text-slate-900">Decision</h3>
                  {actions.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">
                      No reviewer action is available for a row in this status.
                    </p>
                  ) : (
                    <>
                      <ul className="mt-2 space-y-1 text-[11px] text-slate-500">
                        <li>{NONPROFIT_REVIEW_APPROVE_NOTICE}</li>
                        <li>{NONPROFIT_REVIEW_REQUEST_INFO_NOTICE}</li>
                        <li>{NONPROFIT_REVIEW_RELEASE_NOTICE}</li>
                      </ul>
                      <label className="mt-3 block">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {NONPROFIT_REVIEW_DENY_NOTE_LABEL}
                        </span>
                        <textarea
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          rows={3}
                          className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
                          placeholder="What did you check, and what should the next reviewer know?"
                        />
                      </label>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {actions.map((action) => (
                          <button
                            key={action}
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void decide(action)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                              action === "deny" || action === "release"
                                ? "bg-rose-600 text-white hover:bg-rose-700"
                                : "bg-slate-900 text-white hover:bg-slate-800"
                            }`}
                          >
                            {busy === action ? "Working…" : ACTION_LABELS[action]}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {result ? <p className="mt-3 text-xs font-semibold text-emerald-700">{result}</p> : null}
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

export const Route = createFileRoute("/admin/nonprofits")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: NonprofitsPage,
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Nonprofit Reviews | Admin | Contrax" }],
  }),
});
