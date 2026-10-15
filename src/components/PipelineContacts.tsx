/**
 * PipelineContacts — the Contacts section of My Pipeline (CRM phase 2, owner
 * handoff 2026-10-10 item 1: "contacts inside the existing Pipeline interface,
 * with create/edit/archive and clear error handling").
 *
 * The component is PRESENTATIONAL about entitlement: it never decides a tier. It
 * reads `access` (the server-computed object GET /api/crm returns) and renders one
 * of two states —
 *   * `access.canEdit` (Starter/Professional) → the full list + create/edit/archive
 *   * Basic (or `access` not yet loaded) → a locked, read-only state whose only
 *     action is an UPGRADE ATTEMPT. Per owner rule 8 the prompt is attempt-only:
 *     this component renders a locked card on view and calls `onUpgrade()` — which
 *     opens the house PremiumUpgradeModal — only when the user clicks a gated
 *     control.
 *
 * ERROR HANDLING (the brief's "clear error handling"): every write goes to the
 * LIVE phase-1 route (POST /api/crm) and the SERVER's own message is what gets
 * shown — in particular the 409 cap ("Your plan allows N contacts."), which the
 * route computes from the real limit. A 403 is rendered differently from a
 * transient error (a plan problem is not "try again"), and a Professional-only
 * read (activity history) that the server 403s shows the server's message instead
 * of an empty list — the client never fakes an entitlement.
 *
 * CRM PHASE 3b (owner handoff item 5) — the AI follow-up DRAFT editor. A second,
 * independent gate hangs off the same panel:
 *   * `access.aiDrafts` (Professional, server-decided) → a per-contact "Draft
 *     follow-up" control. It POSTs to the same live route
 *     (`{ action: "generateDraft", contactId, instructions? }`), and the server's
 *     answer is TEXT, rendered into an EDITABLE textarea with a copy button.
 *   * anything else → the house locked card (`CRM_DRAFT_LOCK_*`), whose only action
 *     is an upgrade attempt via `onUpgradeProfessional()` (owner rule 8).
 *
 * DRAFTS ONLY, BY CONSTRUCTION: there is no send button, no "sent" state, no
 * scheduled delivery and no activity write in this component — the draft is text
 * the user reviews, edits and copies themselves. A failed draft (403 plan problem,
 * 429 daily cap, or a transient error) is shown in the server's own words and
 * changes nothing else on the page (fail-soft, like the phase-2 contacts read).
 */
import { useState } from "react";
import {
  CRM_CONTACTS_LOCK_BODY,
  CRM_CONTACTS_LOCK_CTA,
  CRM_CONTACTS_LOCK_PRICE,
  CRM_CONTACTS_LOCK_TITLE,
  CRM_CONTACTS_READ_ONLY_NOTE,
  type CrmAccessView,
  type CrmActivityView,
  type CrmContactView,
} from "~/lib/pipeline-contacts";
import {
  CRM_DRAFT_ACTION_LABEL,
  CRM_DRAFT_CLOSE_LABEL,
  CRM_DRAFT_COPIED_LABEL,
  CRM_DRAFT_COPY_FAILED_LABEL,
  CRM_DRAFT_COPY_LABEL,
  CRM_DRAFT_EDITOR_NOTE,
  CRM_DRAFT_EDITOR_TITLE,
  CRM_DRAFT_GENERATE_LABEL,
  CRM_DRAFT_GENERATING_LABEL,
  CRM_DRAFT_INSTRUCTIONS_LABEL,
  CRM_DRAFT_INSTRUCTIONS_MAX,
  CRM_DRAFT_INSTRUCTIONS_PLACEHOLDER,
  CRM_DRAFT_LOCK_BODY,
  CRM_DRAFT_LOCK_CTA,
  CRM_DRAFT_LOCK_TITLE,
  CRM_DRAFT_REGENERATE_LABEL,
  CRM_DRAFT_TEXT_MAX,
} from "~/lib/crm-drafts";

/** The field bounds the phase-1 route enforces (mirrored so the UI cannot exceed them). */
const BOUNDS = { name: 200, organization: 200, role: 200, email: 254, phone: 60, notes: 5000 } as const;

interface Draft {
  id?: number;
  name: string;
  organization: string;
  role: string;
  email: string;
  phone: string;
  notes: string;
}
const emptyDraft = (): Draft => ({ name: "", organization: "", role: "", email: "", phone: "", notes: "" });
const draftOf = (c: CrmContactView): Draft => ({
  id: c.id,
  name: c.name,
  organization: c.organization,
  role: c.role,
  email: c.email,
  phone: c.phone,
  notes: c.notes,
});

/** `updated_at` as a calendar day (never the viewer's zone for a date-only value). */
function fmtStamp(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** The message a failed /api/crm call should show, and whether it is a plan problem. */
function describeFailure(status: number, body: { error?: unknown; message?: unknown } | null): {
  message: string;
  forbidden: boolean;
} {
  const serverMessage =
    typeof body?.message === "string" && body.message
      ? body.message
      : typeof body?.error === "string" && body.error
        ? body.error
        : "";
  if (status === 403) {
    return { message: serverMessage || "Editing contacts needs an active Starter plan.", forbidden: true };
  }
  if (serverMessage) return { message: serverMessage, forbidden: false };
  return { message: "Could not save that change. Please try again.", forbidden: false };
}

const inputClass = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900";

export function PipelineContacts({
  access,
  contacts,
  loading,
  loadError,
  onChange,
  onUpgrade,
  onUpgradeProfessional,
}: {
  access: CrmAccessView | null;
  contacts: CrmContactView[];
  loading: boolean;
  /** A failed GET /api/crm — shown in the panel; the pipeline itself keeps working. */
  loadError: string;
  onChange: (next: CrmContactView[]) => void;
  /** Attempt-only: opens the Starter upgrade prompt (never on page view). */
  onUpgrade: () => void;
  /**
   * Attempt-only: opens the PROFESSIONAL upgrade prompt (CRM phase 3b). Wired to the
   * `aiDrafts` gate only — the draft affordance for an entitled account, and the
   * locked card's click for everyone else.
   */
  onUpgradeProfessional: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [listError, setListError] = useState("");
  const [archiveId, setArchiveId] = useState<number | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [history, setHistory] = useState<CrmActivityView[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  // ── CRM phase 3b: the AI follow-up DRAFT editor (drafts only — never sent) ────
  /** Which contact's draft box is open (one at a time), or null. */
  const [draftsFor, setDraftsFor] = useState<number | null>(null);
  /** The user's optional instruction for the next draft. */
  const [draftNote, setDraftNote] = useState("");
  /** The draft text — EDITABLE, and the only thing this feature produces. */
  const [draftText, setDraftText] = useState("");
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [draftCopied, setDraftCopied] = useState(false);
  const canEdit = access?.canEdit === true;
  /** Professional only — the SERVER decides this (`aiDrafts`), never the client. */
  const canDraft = access?.aiDrafts === true;

  const atLimit = canEdit && access ? contacts.length >= access.contactLimit : false;

  /** ONE place that talks to /api/crm and turns a failure into the server's words. */
  async function callCrm(init: RequestInit): Promise<{ ok: true; body: any } | { ok: false; message: string; forbidden: boolean }> {
    try {
      const res = await fetch("/api/crm", { credentials: "same-origin", ...init });
      const body = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, ...describeFailure(res.status, body) };
      return { ok: true, body };
    } catch {
      return { ok: false, message: "Could not reach the server. Please try again.", forbidden: false };
    }
  }

  async function saveDraft() {
    if (!draft || busy) return;
    if (!draft.name.trim()) {
      setFormError("A contact name is required.");
      return;
    }
    setBusy(true);
    setFormError("");
    setListError("");
    const result = await callCrm({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "saveContact",
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name,
        organization: draft.organization,
        role: draft.role,
        email: draft.email,
        phone: draft.phone,
        notes: draft.notes,
      }),
    });
    setBusy(false);
    if (!result.ok) {
      // The 409 cap arrives here as the route's own sentence: "Your plan allows N contacts."
      setFormError(result.message);
      return;
    }
    const savedId = Number(result.body?.id);
    const stored: CrmContactView = {
      id: savedId,
      name: draft.name.trim(),
      organization: draft.organization.trim(),
      role: draft.role.trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      notes: draft.notes.trim(),
      created_at: draft.id ? (contacts.find((c) => c.id === draft.id)?.created_at ?? null) : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    onChange(draft.id ? contacts.map((c) => (c.id === draft.id ? stored : c)) : [stored, ...contacts]);
    setDraft(null);
  }

  async function archive(id: number) {
    if (busy) return;
    setBusy(true);
    setListError("");
    const result = await callCrm({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archiveContact", id }),
    });
    setBusy(false);
    setArchiveId(null);
    if (!result.ok) {
      setListError(result.message);
      return;
    }
    // The list holds live contacts only; the archived row is gone from it, and the
    // server keeps the data (reads survive every plan change).
    onChange(contacts.filter((c) => c.id !== id));
  }

  async function loadHistory(id: number) {
    if (historyId === id) {
      setHistoryId(null);
      setHistory(null);
      setHistoryError("");
      return;
    }
    setHistoryId(id);
    setHistory(null);
    setHistoryError("");
    setHistoryLoading(true);
    // The history read has its own resource URL, so it does not go through
    // `callCrm` (which targets the default contacts resource) — but it is turned
    // into the same server-words failure, including the 403 a non-Professional
    // account gets. Nothing here decides entitlement.
    const response = await fetch(`/api/crm?resource=history&contactId=${id}`, { credentials: "same-origin" }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setHistoryLoading(false);
    if (!response) {
      setHistoryError("Could not reach the server. Please try again.");
      return;
    }
    if (!response.ok) {
      setHistoryError(describeFailure(response.status, body).message);
      return;
    }
    setHistory(Array.isArray(body?.activities) ? (body.activities as CrmActivityView[]) : []);
  }

  // ── CRM phase 3b: the draft editor's handlers ────────────────────────────────
  /**
   * Opens the draft box for one contact and clears any previous draft. Clicks only:
   * nothing here fetches on mount or on page view, and the Professional gate is the
   * SERVER's (`access.aiDrafts`, mirrored here just to decide what to render).
   */
  function openDrafts(contactId: number) {
    setDraftsFor(contactId);
    setDraftNote("");
    setDraftText("");
    setDraftError("");
    setDraftCopied(false);
  }

  function closeDrafts() {
    setDraftsFor(null);
    setDraftNote("");
    setDraftText("");
    setDraftError("");
    setDraftCopied(false);
  }

  /**
   * Asks the server for one draft. FAIL-SOFT, like every other CRM read here: a
   * failure shows the server's own words in the panel and leaves the contacts list
   * (and the rest of the pipeline) untouched. The response is TEXT — there is no
   * send step to follow it, because the feature has none.
   */
  async function requestDraft() {
    if (draftsFor === null || draftBusy) return;
    setDraftBusy(true);
    setDraftError("");
    setDraftCopied(false);
    const result = await callCrm({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "generateDraft",
        contactId: draftsFor,
        ...(draftNote.trim() ? { instructions: draftNote.trim() } : {}),
      }),
    });
    setDraftBusy(false);
    if (!result.ok) {
      // A 403 (Professional) is the server's sentence; a 429 is the honest cap
      // message; anything else is a transient failure. The client never fakes one.
      setDraftError(result.message);
      return;
    }
    const text = typeof result.body?.draft?.text === "string" ? result.body.draft.text : "";
    if (!text) {
      setDraftError("The draft came back empty. Please try again.");
      return;
    }
    setDraftText(text);
  }

  /** Copies the draft the user is looking at — the last step this feature offers. */
  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draftText);
      setDraftCopied(true);
      setDraftError("");
    } catch {
      setDraftCopied(false);
      setDraftError(CRM_DRAFT_COPY_FAILED_LABEL);
    }
  }

  // ── Basic / no-entitlement: read-only + an UPGRADE ATTEMPT (owner rule 8) ────
  if (!canEdit) {
    return (
      <section id="contacts" className="mb-6 scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="pipeline-contacts-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="pipeline-contacts-heading" className="text-lg font-semibold text-slate-900">Contacts</h2>
            <p className="mt-1 text-sm text-slate-500">
              {loading ? "Loading your contacts…" : `${contacts.length} contact${contacts.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onUpgrade}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-600"
          >
            {CRM_CONTACTS_LOCK_CTA}
          </button>
        </div>
        {loadError && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">🔒 {CRM_CONTACTS_LOCK_TITLE}</p>
          <p className="mt-1 text-sm text-slate-600">{CRM_CONTACTS_LOCK_BODY}</p>
          <p className="mt-2 text-xs text-slate-500">{CRM_CONTACTS_READ_ONLY_NOTE}</p>
          <p className="mt-1 text-xs text-slate-400">{CRM_CONTACTS_LOCK_PRICE}</p>
        </div>
        {contacts.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100">
            {contacts.map((contact) => (
              <li key={contact.id} className="py-2 text-sm text-slate-600">
                <span className="font-medium text-slate-800">{contact.name}</span>
                {contact.organization && <> · {contact.organization}</>}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section id="contacts" className="mb-6 scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="pipeline-contacts-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="pipeline-contacts-heading" className="text-lg font-semibold text-slate-900">Contacts</h2>
          <p className="mt-1 text-sm text-slate-500">
            {access ? `${contacts.length} of ${access.contactLimit} contacts` : `${contacts.length} contacts`}
            {access?.tier === "professional" && " · relationship history included"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setDraft(emptyDraft()); setFormError(""); setListError(""); }}
          disabled={atLimit || draft !== null}
          title={atLimit && access ? `Your plan allows ${access.contactLimit} contacts.` : undefined}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          + Add contact
        </button>
      </div>

      {loadError && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}
      {listError && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{listError}</p>}
      {atLimit && access && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Your plan allows {access.contactLimit} contacts.
        </p>
      )}

      {draft && (
        <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
          <p className="text-sm font-semibold text-slate-800 sm:col-span-2">{draft.id ? "Edit contact" : "New contact"}</p>
          <label className="space-y-1">Name (required)<input className={inputClass} maxLength={BOUNDS.name} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label className="space-y-1">Organization<input className={inputClass} maxLength={BOUNDS.organization} value={draft.organization} onChange={(e) => setDraft({ ...draft, organization: e.target.value })} /></label>
          <label className="space-y-1">Role<input className={inputClass} maxLength={BOUNDS.role} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} placeholder="Contracting officer" /></label>
          <label className="space-y-1">Email<input className={inputClass} type="email" maxLength={BOUNDS.email} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></label>
          <label className="space-y-1">Phone<input className={inputClass} maxLength={BOUNDS.phone} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></label>
          <label className="space-y-1 sm:col-span-2">Notes<textarea className={inputClass} rows={3} maxLength={BOUNDS.notes} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
          {formError && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{formError}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" disabled={busy} onClick={saveDraft} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50">
              {busy ? "Saving…" : draft.id ? "Save contact" : "Create contact"}
            </button>
            <button type="button" disabled={busy} onClick={() => { setDraft(null); setFormError(""); }} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">Loading your contacts…</p>
      ) : contacts.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          No contacts yet. Add the people you're pursuing bids with, then link one to any saved bid below.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {contacts.map((contact) => {
            const updated = fmtStamp(contact.updated_at);
            return (
              <li key={contact.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-semibold text-slate-900">
                      {contact.name}
                      {contact.role && <span className="ml-2 text-xs font-normal text-slate-500">{contact.role}</span>}
                    </p>
                    {contact.organization && <p className="text-slate-600">{contact.organization}</p>}
                    <p className="mt-0.5 text-xs text-slate-500">
                      {contact.email && <span>{contact.email}</span>}
                      {contact.email && contact.phone && <span> · </span>}
                      {contact.phone && <span>{contact.phone}</span>}
                    </p>
                    {contact.notes && <p className="mt-1 whitespace-pre-wrap text-slate-600">{contact.notes}</p>}
                    {updated && <p className="mt-1 text-xs text-slate-400">Updated {updated}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {canDraft && (
                      <button
                        type="button"
                        onClick={() => (draftsFor === contact.id ? closeDrafts() : openDrafts(contact.id))}
                        className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100"
                      >
                        {CRM_DRAFT_ACTION_LABEL}
                      </button>
                    )}
                    {access?.relationshipHistory && (
                      <button
                        type="button"
                        onClick={() => loadHistory(contact.id)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {historyId === contact.id ? "Hide history" : "History"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { setDraft(draftOf(contact)); setFormError(""); setListError(""); }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    {archiveId === contact.id ? (
                      <>
                        <button type="button" disabled={busy} onClick={() => archive(contact.id)} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                          {busy ? "Archiving…" : "Confirm archive"}
                        </button>
                        <button type="button" disabled={busy} onClick={() => setArchiveId(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => { setArchiveId(contact.id); setListError(""); }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700">
                        Archive
                      </button>
                    )}
                  </div>
                </div>
                {historyId === contact.id && (
                  <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm">
                    {historyLoading && <p className="text-slate-500">Loading history…</p>}
                    {historyError && <p role="alert" className="text-red-700">{historyError}</p>}
                    {!historyLoading && !historyError && (history ?? []).length === 0 && (
                      <p className="text-slate-500">No activity logged for this contact yet.</p>
                    )}
                    {(history ?? []).map((activity) => (
                      <p key={activity.id} className="text-slate-600">
                        <span className="font-medium text-slate-800">{activity.kind}</span>
                        {fmtStamp(activity.created_at) && <span className="text-xs text-slate-400"> · {fmtStamp(activity.created_at)}</span>}
                        {activity.body && <span className="block whitespace-pre-wrap">{activity.body}</span>}
                      </p>
                    ))}
                  </div>
                )}
                {/* CRM phase 3b — the ONE thing this feature produces: editable text
                    for the user to review and copy. There is deliberately no send
                    button, no "sent" state and no activity write. */}
                {draftsFor === contact.id && (
                  <div className="mt-2 rounded-lg bg-amber-50/60 p-3 text-sm">
                    <p className="font-semibold text-slate-800">{CRM_DRAFT_EDITOR_TITLE}</p>
                    <p className="mt-1 text-xs text-slate-500">{CRM_DRAFT_EDITOR_NOTE}</p>
                    <label className="mt-3 block text-sm text-slate-700">
                      {CRM_DRAFT_INSTRUCTIONS_LABEL}
                      <textarea
                        className={`${inputClass} mt-1`}
                        rows={2}
                        maxLength={CRM_DRAFT_INSTRUCTIONS_MAX}
                        value={draftNote}
                        onChange={(e) => setDraftNote(e.target.value)}
                        placeholder={CRM_DRAFT_INSTRUCTIONS_PLACEHOLDER}
                      />
                    </label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={draftBusy}
                        onClick={requestDraft}
                        className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:cursor-wait disabled:opacity-60"
                      >
                        {draftBusy
                          ? CRM_DRAFT_GENERATING_LABEL
                          : draftText
                            ? CRM_DRAFT_REGENERATE_LABEL
                            : CRM_DRAFT_GENERATE_LABEL}
                      </button>
                      <button
                        type="button"
                        onClick={closeDrafts}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {CRM_DRAFT_CLOSE_LABEL}
                      </button>
                    </div>
                    {draftError && (
                      <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                        {draftError}
                      </p>
                    )}
                    {draftText && (
                      <>
                        <textarea
                          className={`${inputClass} mt-3 font-mono`}
                          rows={10}
                          maxLength={CRM_DRAFT_TEXT_MAX}
                          aria-label={CRM_DRAFT_EDITOR_TITLE}
                          value={draftText}
                          onChange={(e) => setDraftText(e.target.value)}
                        />
                        <div className="mt-2 flex items-center gap-3">
                          <button
                            type="button"
                            onClick={copyDraft}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            {draftCopied ? CRM_DRAFT_COPIED_LABEL : CRM_DRAFT_COPY_LABEL}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* CRM phase 3b — the Professional gate for AI follow-up drafts. Shown to an
          account that can edit contacts but is not entitled to drafts (Starter):
          the house locked card on view, and its ONLY action is an upgrade attempt
          (owner rule 8), which opens the Professional prompt. No price is claimed
          here — the modal keeps the existing Professional defaults. */}
      {access && !canDraft && (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">🔒 {CRM_DRAFT_LOCK_TITLE}</p>
          <p className="mt-1 text-sm text-slate-600">{CRM_DRAFT_LOCK_BODY}</p>
          <button
            type="button"
            onClick={onUpgradeProfessional}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-600"
          >
            {CRM_DRAFT_LOCK_CTA}
          </button>
        </div>
      )}
    </section>
  );
}
