import { useState } from "react";
import { submitFeedback, type FeedbackContext, type UnhelpfulReason } from "~/lib/feedback";

interface FeedbackWidgetProps {
  context: FeedbackContext;
  solicitationRef?: string;
  aiOutputSummary: string;
}

const reasonOptions: { value: UnhelpfulReason; label: string }[] = [
  { value: "inaccurate", label: "Inaccurate" },
  { value: "too_vague", label: "Too vague" },
  { value: "too_generic", label: "Too generic" },
  { value: "missed_requirements", label: "Missed requirements" },
  { value: "other", label: "Other" },
];

function anonymousSessionId() {
  const key = "contrax_feedback_session";
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(key, id);
    return id;
  } catch { return crypto.randomUUID(); }
}

export function FeedbackWidget({ context, solicitationRef, aiOutputSummary }: FeedbackWidgetProps) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const [reason, setReason] = useState<UnhelpfulReason | "">("");
  const [detail, setDetail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const send = async (wasHelpful: boolean) => {
    setChoice(wasHelpful); setError("");
    if (wasHelpful) {
      setSaving(true);
      try { await submitFeedback({ data: { context, solicitationRef, aiOutputSummary, wasHelpful, sessionId: anonymousSessionId() } }); setSubmitted(true); }
      catch { setError("Could not save feedback. Try again."); setChoice(null); }
      finally { setSaving(false); }
    }
  };
  const submitNegative = async () => {
    setSaving(true); setError("");
    try { await submitFeedback({ data: { context, solicitationRef, aiOutputSummary, wasHelpful: false, unhelpfulReason: reason || "other", unhelpfulDetail: detail, sessionId: anonymousSessionId() } }); setSubmitted(true); }
    catch { setError("Could not save feedback. Try again."); }
    finally { setSaving(false); }
  };
  if (submitted) return <div className="mt-3 text-xs font-medium text-slate-500" role="status">Thanks for your feedback!</div>;
  return (
    <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5 text-xs text-slate-500" aria-label="AI feedback">
      <div className="flex items-center gap-2">
        <span>Was this helpful?</span>
        <button type="button" onClick={() => send(true)} disabled={saving || choice !== null} aria-label="Yes, helpful" className="rounded px-1.5 py-0.5 text-base leading-none hover:bg-green-100 disabled:opacity-50">👍</button>
        <button type="button" onClick={() => { setChoice(false); setError(""); }} disabled={saving || choice !== null} aria-label="No, not helpful" className="rounded px-1.5 py-0.5 text-base leading-none hover:bg-red-100 disabled:opacity-50">👎</button>
      </div>
      {choice === false && <div className="mt-2 space-y-2">
        <label className="sr-only" htmlFor={`feedback-reason-${context}`}>Why was this not helpful?</label>
        <select id={`feedback-reason-${context}`} value={reason} onChange={(e) => setReason(e.target.value as UnhelpfulReason)} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
          <option value="">Why wasn’t it helpful?</option>{reasonOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <textarea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Anything else? (optional)" rows={2} maxLength={2000} className="block w-full resize-none rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400" />
        <button type="button" onClick={submitNegative} disabled={saving} className="rounded bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">{saving ? "Saving…" : "Send feedback"}</button>
      </div>}
      {error && <p className="mt-1 text-red-600">{error}</p>}
    </div>
  );
}
