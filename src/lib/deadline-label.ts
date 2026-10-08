/**
 * DEADLINE LABELS — countdown suppression for ZONE-UNVERIFIED sources.
 *
 * Owner ruling 2026-10-08 (Virginia drive): a source can publish a close date
 * whose TIME ZONE IS NOT SETTLED. Virginia's eVA states its deadlines in Eastern
 * Time but serves a bare `Z` marker on `closedate`, so the stored instant is the
 * Eastern wall-clock read as UTC — up to 4-5 hours off the real deadline. Four
 * Virginia locality boards on the shared CivicEngage/CivicPlus reader
 * (`va_loudoun`, `va_suffolk`, `va_lynchburg`, `va_charlottesville`) are the same
 * shape.
 *
 * POLICY: never derive a countdown ("due in N days", "3d left", "Closing in N
 * days", "is due in less than 24 hours", an ICS VALARM) from a zone-unverified
 * source. Show the raw published close date instead — and show it in UTC, so a
 * US browser cannot shift the bare-`Z` value and make the label stop being "as
 * published" (same reasoning as `pipeline.tsx`'s date-only `fmtDate`).
 *
 * FAIL-OPEN: `source` is NULL/unknown/anything not in the pinned set ⇒ this
 * module returns exactly what the caller would have computed anyway. Adding a
 * source to the set is the ONLY way to change behaviour, and that set is pinned
 * to the connectors that mint a `*_DUE_DATE_ZONE_UNVERIFIED` flag — see
 * `deadline-label.test.ts`, which derives the flag-bearing connector set from
 * the repo and fails loud if the two ever drift.
 *
 * PURE MODULE (same contract as `source-class.ts`): no `~/db`, no server fns,
 * no `node:*`, no `process.env`. It is reachable from CLIENT code
 * (`routes/dashboard.tsx`, `routes/tracking.tsx`, `routes/radar.tsx`), so it
 * must stay a plain constant table + pure functions.
 */

/** Whole days between two instants (ceil), the convention every surface uses. */
const MS_PER_DAY = 86_400_000;

/**
 * Source labels whose published due-date time zone is NOT settled. Every entry
 * is a connector that mints a per-source `*_DUE_DATE_ZONE_UNVERIFIED` flag:
 *
 *   `va_eva`              → `VA_EVA_DUE_DATE_ZONE_UNVERIFIED` (va-eva.ts)
 *   `va_loudoun`          → `VA_LOUDOUN_DUE_DATE_ZONE_UNVERIFIED` (va-loudoun.ts)
 *   `va_suffolk`          → `VA_SUFFOLK_DUE_DATE_ZONE_UNVERIFIED` (va-suffolk.ts)
 *   `va_lynchburg`        → `VA_LYNCHBURG_DUE_DATE_ZONE_UNVERIFIED` (va-lynchburg.ts)
 *   `va_charlottesville`  → `VA_CHARLOTTESVILLE_DUE_DATE_ZONE_UNVERIFIED` (va-charlottesville.ts)
 *
 * Deliberately NOT here (each has its own deliberate rule — do not add without
 * an owner ruling): `oh_dayton` (Dayton, OH — CivicEngage board, but the
 * connector mints no zone flag: follow-up), `pennbid` (unverified — follow-up),
 * and the Virginia Bonfire boards `va_fairfax_bonfire` / `va_alexandria_bonfire`
 * (#615 pinned their zone-less `DateClose` as a UTC read, deliberately).
 */
export const COUNTDOWN_SUPPRESSED_SOURCES = [
  "va_eva",
  "va_loudoun",
  "va_suffolk",
  "va_lynchburg",
  "va_charlottesville",
] as const;

const SUPPRESSED_SOURCE_SET: ReadonlySet<string> = new Set<string>(COUNTDOWN_SUPPRESSED_SOURCES);

/**
 * The long-form honesty note, for surfaces with room for a sentence. It quotes
 * the owner-written sentence `VA_EVA_COPY.timeZoneNote` already promises
 * ("Contrax stores the value exactly as published, never shifted, and does not
 * show a countdown for these rows") — the promise this module finally meets.
 * `deadline-label.test.ts` asserts the quoted sentence is still verbatim.
 */
export const ZONE_UNVERIFIED_DEADLINE_NOTE =
  "The time zone on this publication's close date is not settled, so no countdown is derived from it. Contrax stores the value exactly as published, never shifted, and does not show a countdown for these rows.";

/** Owner-locked short label for a row whose countdown is suppressed and whose
 *  date cannot be read (precedent: `SET_ASIDE_NOT_SPECIFIED_LABEL`). */
export const DEADLINE_AS_PUBLISHED_LABEL = "Deadline as published";

/** True when a countdown must never be derived from this source's due date. */
export function isCountdownSuppressed(source: string | null | undefined): boolean {
  if (typeof source !== "string") return false; // NULL / undefined ⇒ fail open
  return SUPPRESSED_SOURCE_SET.has(source.trim());
}

/**
 * The published close date, rendered with the value's OWN offset (UTC), never
 * the browser's zone: a bare-`Z` Eastern wall-clock must not shift a day.
 * Returns null when the value is missing or unreadable.
 */
export function publishedDateText(due: string | Date | null | undefined): string | null {
  if (due == null || due === "") return null;
  const d = due instanceof Date ? due : new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Day-of-month + short month of the published close date, read in UTC so a
 * calendar tile never shows the day a US browser would shift the bare-`Z` value
 * to. Returns null when the value is missing or unreadable.
 */
export function publishedDateParts(
  due: string | Date | null | undefined,
): { day: number; month: string } | null {
  if (due == null || due === "") return null;
  const d = due instanceof Date ? due : new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString(); // always the stored instant, never the reader's zone
  const day = Number(iso.slice(8, 10));
  const month = MONTHS_SHORT[Number(iso.slice(5, 7)) - 1];
  if (!Number.isFinite(day) || !month) return null;
  return { day, month };
}

/** Whole days from `now` to `due` (ceil, negative once past). Null if unreadable.
 *  `-0` is normalized to `0` so the same instant never yields two spellings. */
export function daysUntilDeadline(due: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (due == null || due === "") return null;
  const d = due instanceof Date ? due : new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.ceil((d.getTime() - now.getTime()) / MS_PER_DAY);
  return days === 0 ? 0 : days;
}

/** The canonical un-suppressed countdown text (`Closed` / `Due today!` / `Nd left`). */
export function countdownText(days: number): string {
  if (days < 0) return "Closed";
  if (days === 0) return "Due today!";
  return `${days}d left`;
}

export interface DeadlineLabelInput {
  due_date?: string | Date | null;
  source?: string | null;
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

export interface DeadlineLabelResult {
  /** True ⇒ the caller must render `text` (a published date) and no countdown. */
  suppressed: boolean;
  /** The label to render in place of a countdown pill. */
  text: string;
  /** The published date rendered in UTC, or null when unreadable. */
  dateText: string | null;
  /** Whole days until the deadline (informational; null when unreadable). */
  days: number | null;
  /** Long-form honesty note — only for suppressed rows (null otherwise). */
  note: string | null;
}

/**
 * The one place the policy is applied. Suppressed sources get the raw published
 * date (UTC-rendered) instead of a derived countdown; every other source — and
 * every NULL/unknown source — gets the unchanged countdown label.
 */
export function deadlineLabel(input: DeadlineLabelInput): DeadlineLabelResult {
  const dateText = publishedDateText(input.due_date);
  const days = daysUntilDeadline(input.due_date, input.now);
  if (isCountdownSuppressed(input.source)) {
    return {
      suppressed: true,
      text: dateText ? `Closes ${dateText}` : DEADLINE_AS_PUBLISHED_LABEL,
      dateText,
      days,
      note: ZONE_UNVERIFIED_DEADLINE_NOTE,
    };
  }
  return {
    suppressed: false,
    text: days == null ? (dateText ? `Due ${dateText}` : DEADLINE_AS_PUBLISHED_LABEL) : countdownText(days),
    dateText,
    days,
    note: null,
  };
}
