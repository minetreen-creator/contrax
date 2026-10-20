/**
 * COUNTER STATE-SET CHANGE ALERT — the notification half of the owner's
 * 2026-10-19 amendment ("the state count follows the REAL data … the import
 * ALWAYS proceeds; when the open-counter state set would change, log it
 * prominently and alert").
 *
 * WHY THIS FILE EXISTS
 * -------------------
 * The nightly SAM.gov CSV ingest used to REFUSE to write (and exit non-zero)
 * when its run would move the homepage /map counter's state count off the
 * "approved set". That is gone: the count follows the real data (50 today, 51
 * with Maine the moment real Maine notices enter the live counter, and back down
 * again when they close). What remains is the reporting obligation, and this is
 * where it lives:
 *
 *   1. a PROMINENT LOG LINE (`counterStateChangeReport().lines`), always —
 *      before/after sets plus per-state open-count deltas in both directions;
 *   2. an ALERT through the repo's existing notification path: the business
 *      inbox (`contrax.companyllc@gmail.com` — the same address the repo already
 *      alerts for ops events, see `sendDataAccessRequestNotice` in
 *      ./../lib/email.ts) over the repo's existing Resend integration, sent from
 *      the SAME verified sender (`Contrax <hello@contrax.company>`);
 *   3. a NOTIFICATION ARTIFACT: the same text is written to
 *      `sam-csv-state-change.md` (override with SAM_CSV_STATE_CHANGE_FILE), which
 *      `.github/workflows/sync-sam-csv.yml` uploads as a run artifact — the
 *      persistence pattern `.github/workflows/nonzero-watch.yml` already uses for
 *      a job whose output must survive an ephemeral runner.
 *
 * FIRE-AND-FORGET, NEVER FATAL: every function here is wrapped so a missing key,
 * a rejected email or an unwritable file logs a warning and returns — an alert
 * failure may never fail (or delay into failure) the import itself.
 *
 * No PII: the report carries state codes, counts and the run's own numbers, and
 * nothing else.
 */
import type { CounterRowStats, StateOpenCountDelta, StateSetChange } from "./sam-csv";

/** The business inbox the repo already alerts for ops events. */
export const COUNTER_STATE_ALERT_TO = "contrax.companyllc@gmail.com";
/** Verified sender used by every other transactional email in the repo. */
export const COUNTER_STATE_ALERT_FROM = "Contrax <hello@contrax.company>";
/** Default artifact file the workflow uploads (see the workflow's upload step). */
export const COUNTER_STATE_ALERT_ARTIFACT = "sam-csv-state-change.md";

export interface CounterStateAlert {
  subject: string;
  /** Full report text — the email body and the artifact are the same bytes. */
  text: string;
  /** The report as log lines, in order, for the run's stdout. */
  lines: string[];
}

/**
 * Pure formatter: a changed state set → the exact log lines / email / artifact
 * text. No I/O, so the wording is unit-tested byte-for-byte.
 */
export function counterStateChangeReport(
  change: StateSetChange,
  deltas: readonly StateOpenCountDelta[],
  stats: CounterRowStats,
): CounterStateAlert {
  const pad = (n: number) => String(n).padStart(5, " ");
  const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
  const lines = [
    "⚠️  COUNTER STATE SET CHANGED — the import CONTINUES (owner rule 2026-10-19)",
    `    jurisdictions: ${change.before.length} -> ${change.after.length}`,
    `    before: ${change.before.join(", ")}`,
    `    after : ${change.after.join(", ")}`,
    `    added : ${change.added.join(", ") || "(none)"}`,
    `    removed: ${change.removed.join(", ") || "(none)"}`,
    "    per-state open-count deltas (both directions):",
  ];
  if (deltas.length === 0) {
    lines.push("      (none — the set changed with no per-state count move)");
  } else {
    for (const d of deltas) {
      const flags = [
        d.added ? "[NEW state in the counter]" : "",
        d.removed ? "[LEFT the counter]" : "",
      ]
        .filter(Boolean)
        .join(" ");
      lines.push(
        `      ${d.state}: ${pad(d.before)} -> ${pad(d.after)} (${signed(d.delta)})${flags ? " " + flags : ""}`,
      );
    }
  }
  const addedRows = deltas
    .filter((d) => d.added)
    .reduce((a, d) => a + d.after, 0);
  const removedRows = deltas
    .filter((d) => d.removed)
    .reduce((a, d) => a + d.before, 0);
  lines.push(
    `    counted rows behind the move: +${addedRows} in new state(s), -${removedRows} in state(s) that left;`,
    `    this run keeps ${stats.counted} kept row(s) in the counter (${stats.withPopState} carry a PopState, ` +
      `${stats.withoutPopState} publish none, ${stats.refusedLowContent} refused as low-content)`,
    "    ACTION: none required — this is the count following the real data. It may move back when the",
    "            bids behind it close; if a move looks wrong, check the extract, not the counter.",
  );
  return {
    subject: `Contrax nightly SAM CSV: counter state set changed ${change.before.length} → ${change.after.length} (${[
      ...change.added,
      ...change.removed.map((s) => `-${s}`),
    ].join(", ")})`,
    text: lines.join("\n"),
    lines,
  };
}

/**
 * Deliver the alert. Returns what actually happened so the run can log it; it
 * NEVER throws and never blocks the write path with a failure.
 *
 * - `writeArtifact` (default true) writes the report to the artifact file so the
 *   workflow can upload it (and so the file is greppable in the run's workspace).
 * - The email is sent over the repo's existing Resend integration, and SKIPPED
 *   (logged, not an error) when RESEND_API_KEY is absent — exactly how every
 *   other email path in the repo behaves.
 */
export async function alertCounterStateChange(
  report: CounterStateAlert,
  opts: { writeArtifact?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<{ emailed: "sent" | "skipped" | "failed"; artifact: string | null }> {
  let artifact: string | null = null;
  if (opts.writeArtifact !== false) {
    try {
      const { writeFileSync } = await import("node:fs");
      const path =
        process.env.SAM_CSV_STATE_CHANGE_FILE?.trim() || COUNTER_STATE_ALERT_ARTIFACT;
      writeFileSync(path, `${report.subject}\n\n${report.text}\n`, "utf8");
      artifact = path;
    } catch (e) {
      console.warn(
        `[sam-csv-state-alert] could not write the notification artifact: ${(e as Error).message}`,
      );
    }
  }
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(
      "[sam-csv-state-alert] RESEND_API_KEY is not set — alert email skipped (the log line and the artifact above are the record)",
    );
    return { emailed: "skipped", artifact };
  }
  try {
    const doFetch = opts.fetchImpl ?? fetch;
    const res = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: COUNTER_STATE_ALERT_FROM,
        to: [COUNTER_STATE_ALERT_TO],
        subject: report.subject,
        text: report.text,
      }),
    });
    if (!res.ok) {
      console.warn(
        `[sam-csv-state-alert] alert email rejected (HTTP ${res.status}) — the log line and the artifact above are the record`,
      );
      return { emailed: "failed", artifact };
    }
    return { emailed: "sent", artifact };
  } catch (e) {
    console.warn(
      `[sam-csv-state-alert] alert email failed: ${(e as Error).message} — the import continues regardless`,
    );
    return { emailed: "failed", artifact };
  }
}
