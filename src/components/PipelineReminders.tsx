/**
 * PipelineReminders — the Follow-up reminders panel inside My Pipeline (CRM phase
 * 3a, owner handoff 2026-10-10 item 4: "Show upcoming and overdue follow-ups. If
 * implementing email delivery, require an opt-in preference. Use the user's
 * timezone…").
 *
 * PRESENTATIONAL ABOUT ENTITLEMENT, exactly like the phase-2 contacts panel: it
 * never decides a tier. It reads `access` (the SERVER-computed object GET /api/crm
 * returns) and renders one of two states —
 *   * `access.reminders` (Professional) → the upcoming/overdue lists + the email
 *     opt-in switch and timezone picker;
 *   * anything else → a locked, read-only state whose only action is an UPGRADE
 *     ATTEMPT. Per owner rule 8 the prompt is attempt-only: this component renders a
 *     locked card on view and calls `onUpgrade()` — which opens the house
 *     PremiumUpgradeModal — only when the user clicks a gated control.
 *
 * THE LISTS COME FROM THE PAGE'S OWN DATA. `items` is what GET /api/my-pipeline
 * already returned, so the follow-up date shown here is the SAME
 * `saved_matches.follow_up_date` the bid workspace edits — there is no second notion
 * of a reminder, no extra query, and a follow-up changed in the page is reflected
 * here immediately. The classification uses the shared pure helpers in
 * src/lib/crm-reminders.ts with the user's own timezone, i.e. exactly the rules the
 * scheduled worker applies.
 *
 * WHAT IS NOT CLAIMED: no delivery guarantee, no frequency promise beyond "one email
 * per follow-up date that comes due", and no price. The opt-in note is the honest
 * description of what the worker does.
 */
import { useEffect, useState } from "react";
import {
  CRM_REMINDERS_LOCK_BODY,
  CRM_REMINDERS_LOCK_CTA,
  CRM_REMINDERS_LOCK_TITLE,
  CRM_REMINDERS_OPT_IN_LABEL,
  CRM_REMINDERS_OPT_IN_NOTE,
  buildReminderLists,
  normalizeTimezone,
  timezoneOptions,
  type CrmReminderPrefsView,
  type ReminderBidSource,
} from "~/lib/crm-reminders";
import type { CrmAccessView } from "~/lib/pipeline-contacts";

/** The slice of a GET /api/my-pipeline item this panel needs (`id` = the saved match). */
export interface PipelineReminderItem {
  id: number;
  bid_id: number;
  title: string;
  follow_up_date: string | null;
  next_action: string;
}

/** A calendar date, rendered in UTC — it is a calendar day, not an instant. */
function fmtDay(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "today" / "tomorrow" / "3 days ago" — plain English for the two lists. */
function fmtDistance(kind: string, days: number): string {
  if (kind === "due_today") return "due today";
  if (kind === "overdue") return days === 1 ? "1 day overdue" : `${days} days overdue`;
  if (days === 1) return "due tomorrow";
  return `in ${days} days`;
}

export function PipelineReminders({
  access,
  items,
  loading,
  onUpgrade,
}: {
  access: CrmAccessView | null;
  items: PipelineReminderItem[];
  /** The pipeline read is still in flight. */
  loading: boolean;
  /** Attempt-only: opens the Professional upgrade prompt (never on page view). */
  onUpgrade: () => void;
}) {
  const allowed = access?.reminders === true;
  const [prefs, setPrefs] = useState<CrmReminderPrefsView | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [prefsError, setPrefsError] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [timezone, setTimezone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [saveError, setSaveError] = useState("");

  /**
   * The preference read. FAIL-SOFT (like the contacts read): a failure shows in the
   * panel and never blocks the pipeline. It is only issued for an entitled account —
   * a non-Professional caller would get a 403 by design.
   */
  useEffect(() => {
    if (!allowed) {
      setPrefsLoading(false);
      return;
    }
    let cancelled = false;
    fetch("/api/crm?resource=reminders", { credentials: "same-origin" })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error || "Could not load your reminder settings.");
        return body as { prefs?: CrmReminderPrefsView } | null;
      })
      .then((body) => {
        if (cancelled) return;
        const next = body?.prefs ?? null;
        setPrefs(next);
        setOptIn(next?.opt_in === true);
        setTimezone(next?.timezone ?? "");
        setPrefsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPrefsError(
          err instanceof Error ? err.message : "Could not load your reminder settings.",
        );
        setPrefsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  /**
   * Which zone to classify in. Before the preference arrives we use the BROWSER's
   * own zone as a placeholder (the least surprising guess for the person looking at
   * the screen), then the stored preference takes over — the worker only ever uses
   * the stored one. Neither value is written back without the user pressing Save.
   */
  const browserZone =
    typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function"
      ? normalizeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)
      : "UTC";
  const zone = normalizeTimezone(timezone || prefs?.timezone || browserZone);

  // A follow-up date is a calendar day, so the buckets are measured against the
  // CURRENT local day each render.
  const now = new Date();
  const sources: ReminderBidSource[] = items.map((item) => ({
    saved_match_id: item.id,
    bid_id: item.bid_id,
    title: item.title,
    follow_up_date: item.follow_up_date,
    next_action: item.next_action,
  }));
  const lists = allowed ? buildReminderLists(sources, zone, now) : { overdue: [], upcoming: [] };
  const total = lists.overdue.length + lists.upcoming.length;
  const withFollowUp = sources.filter((s) => s.follow_up_date).length;
  /** Plain English, never a number that overstates or understates what is listed. */
  const status = loading
    ? "Loading your pipeline…"
    : withFollowUp === 0
      ? "No follow-up dates set yet"
      : total === 0
        ? `${withFollowUp} follow-up date${withFollowUp === 1 ? "" : "s"} tracked · nothing due yet · times shown in ${zone}`
        : `${total} of ${withFollowUp} follow-up date${withFollowUp === 1 ? "" : "s"} need${total === 1 ? "s" : ""} attention · times shown in ${zone}`;

  async function savePreferences() {
    if (saving) return;
    setSaving(true);
    setSaved("");
    setSaveError("");
    try {
      const res = await fetch("/api/crm", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveReminderPrefs", opt_in: optIn, timezone: zone }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || "Could not save your reminder settings.");
      const next: CrmReminderPrefsView | null = body?.prefs ?? null;
      setPrefs(next);
      setOptIn(next?.opt_in === true);
      setTimezone(next?.timezone ?? zone);
      setSaved(
        next?.opt_in
          ? "Saved. Reminder email is on."
          : "Saved. Reminder email is off — you will not be emailed.",
      );
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Could not save your reminder settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  // ── Non-Professional: the read-only locked card + an UPGRADE ATTEMPT ─────────
  if (!allowed) {
    return (
      <section
        className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        aria-labelledby="pipeline-reminders-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="pipeline-reminders-heading" className="text-lg font-semibold text-slate-900">
              Follow-up reminders
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {loading ? "Loading your pipeline…" : "Professional feature"}
            </p>
          </div>
          <button
            type="button"
            onClick={onUpgrade}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-600"
          >
            {CRM_REMINDERS_LOCK_CTA}
          </button>
        </div>
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">🔒 {CRM_REMINDERS_LOCK_TITLE}</p>
          <p className="mt-1 text-sm text-slate-600">{CRM_REMINDERS_LOCK_BODY}</p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      aria-labelledby="pipeline-reminders-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="pipeline-reminders-heading" className="text-lg font-semibold text-slate-900">
            Follow-up reminders
          </h2>
          <p className="mt-1 text-sm text-slate-500">{status}</p>
        </div>
      </div>

      {prefsError && (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {prefsError}
        </p>
      )}

      {!loading && withFollowUp === 0 && (
        <p className="mt-4 text-sm text-slate-500">
          Add a follow-up date to a saved bid below ("Manage bid"), and it will show up here —
          overdue first, then what is coming up.
        </p>
      )}

      {lists.overdue.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-red-700">Overdue</h3>
          <ul className="mt-2 divide-y divide-slate-100">
            {lists.overdue.map((row) => (
              <li key={row.saved_match_id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">{row.title || "Untitled opportunity"}</p>
                  {row.next_action && <p className="text-slate-600">{row.next_action}</p>}
                </div>
                <p className="shrink-0 text-red-700">
                  {fmtDay(row.follow_up_date)} · {fmtDistance(row.kind, row.days)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lists.upcoming.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-slate-700">Upcoming</h3>
          <ul className="mt-2 divide-y divide-slate-100">
            {lists.upcoming.map((row) => (
              <li key={row.saved_match_id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">{row.title || "Untitled opportunity"}</p>
                  {row.next_action && <p className="text-slate-600">{row.next_action}</p>}
                </div>
                <p className="shrink-0 text-slate-600">
                  {fmtDay(row.follow_up_date)} · {fmtDistance(row.kind, row.days)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The email opt-in. OPTIONAL by construction: the switch starts OFF for every
          account (user_crm_prefs has no row until the user saves one), and the only
          writer is this panel's Save button. */}
      <div className="mt-5 rounded-xl bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-800">Email reminders</p>
        {prefsLoading ? (
          <p className="mt-1 text-sm text-slate-500">Loading your reminder settings…</p>
        ) : (
          <>
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={optIn}
                onChange={(e) => {
                  setOptIn(e.target.checked);
                  setSaved("");
                }}
              />
              {CRM_REMINDERS_OPT_IN_LABEL}
            </label>
            <p className="mt-1 text-xs text-slate-500">{CRM_REMINDERS_OPT_IN_NOTE}</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="space-y-1 text-sm text-slate-700">
                Your timezone
                <select
                  className="block w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  value={zone}
                  onChange={(e) => {
                    setTimezone(e.target.value);
                    setSaved("");
                  }}
                >
                  {timezoneOptions(zone).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={saving}
                onClick={savePreferences}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save reminder settings"}
              </button>
            </div>
            {saved && <p className="mt-2 text-sm text-green-700">{saved}</p>}
            {saveError && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {saveError}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
