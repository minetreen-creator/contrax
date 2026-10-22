/**
 * Bid amendment history (owner 2026-10-22: "do we have an addenda?" → yes,
 * build it). The `bid_amendments` table and its readers (the tracking page's
 * change list, the AI brief's source fingerprint) already existed, but nothing
 * ever wrote to it. The sync's batch upsert (runner.ts insertBidsBatch) now
 * records what changed whenever it really rewrites an existing bid:
 *
 *   deadline     — the stored due date moved (by more than a minute);
 *   title        — the notice was retitled;
 *   description  — the text changed (an empty incoming description never
 *                  overwrites, so it is never recorded either);
 *   value        — the estimated value changed.
 *
 * A first fill (stored value empty, incoming value present) is enrichment, not
 * an amendment, so it is not recorded. This records CHANGES to the listing;
 * Contrax does not download addendum documents.
 *
 * `bid_id` is `bids.id` as text — the key the existing readers use.
 */

export type AmendmentType = "deadline" | "title" | "description" | "value";

export interface StoredBidFields {
  title: string | null;
  description: string | null;
  due_date: string | Date | null;
  estimated_value: string | null;
}

export interface IncomingBidFields {
  title: string | null;
  description: string | null;
  /** ISO timestamp (runner's toIsoDueDate) or null. */
  due_date: string | null;
  estimated_value: string | null;
}

export interface DetectedAmendment {
  change_type: AmendmentType;
  old_value: string;
  new_value: string;
}

/** Long descriptions are stored trimmed: the change list shows a preview. */
export const AMENDMENT_VALUE_MAX = 2000;

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const clip = (s: string) => (s.length > AMENDMENT_VALUE_MAX ? `${s.slice(0, AMENDMENT_VALUE_MAX - 1)}…` : s);
const ms = (v: string | Date | null) => (v == null ? NaN : new Date(v).getTime());

/** What changed between the stored row and the incoming source row. */
export function detectAmendments(stored: StoredBidFields, incoming: IncomingBidFields): DetectedAmendment[] {
  const out: DetectedAmendment[] = [];
  const oldDue = ms(stored.due_date);
  const newDue = ms(incoming.due_date);
  if (Number.isFinite(oldDue) && Number.isFinite(newDue) && Math.abs(newDue - oldDue) > 60_000) {
    out.push({
      change_type: "deadline",
      old_value: new Date(oldDue).toISOString(),
      new_value: new Date(newDue).toISOString(),
    });
  }
  const pairs: [AmendmentType, string | null, string | null][] = [
    ["title", stored.title, incoming.title],
    ["description", stored.description, incoming.description],
    ["value", stored.estimated_value, incoming.estimated_value],
  ];
  for (const [type, before, after] of pairs) {
    const a = norm(before);
    const b = norm(after);
    if (a && b && a !== b) out.push({ change_type: type, old_value: clip(a), new_value: clip(b) });
  }
  return out;
}

/**
 * A chunk where most already-stored rows "changed" description at once is a
 * source reformatting its text, not a wave of real amendments; recording it
 * would bury the real ones. Above this share, description changes in the chunk
 * are dropped (deadline/title/value changes are still kept).
 */
export const BULK_DESCRIPTION_CHANGE_SHARE = 0.5;

export function dropBulkDescriptionChanges<T extends { change_type: AmendmentType }>(
  perRow: T[][],
  existingRows: number,
): { kept: T[][]; dropped: number } {
  const changedDesc = perRow.filter((r) => r.some((a) => a.change_type === "description")).length;
  if (existingRows < 4 || changedDesc / existingRows <= BULK_DESCRIPTION_CHANGE_SHARE) {
    return { kept: perRow, dropped: 0 };
  }
  return {
    kept: perRow.map((r) => r.filter((a) => a.change_type !== "description")),
    dropped: changedDesc,
  };
}

export const CREATE_BID_AMENDMENTS_TABLE =
  "CREATE TABLE IF NOT EXISTS bid_amendments (id SERIAL PRIMARY KEY, bid_id TEXT NOT NULL, change_type TEXT NOT NULL, old_value TEXT, new_value TEXT, detected_at TIMESTAMPTZ DEFAULT NOW())";
