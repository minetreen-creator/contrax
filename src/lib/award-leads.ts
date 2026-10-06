/**
 * Award leads (owner 2026-10-06, revenue idea #6): new federal contract winners,
 * from public USAspending.gov records, sold to companies that sell TO contractors
 * (surety bonds, factoring, equipment rental, staffing, insurance). PURE helpers
 * shared by the sync job, the /leads page, the API and tests.
 */

export interface AwardLead {
  /** USAspending's stable award key, e.g. CONT_AWD_W91247..._9700_-NONE-_-NONE- */
  award_key: string;
  award_id: string;
  recipient_name: string;
  recipient_uei: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  amount: number;
  awarded_on: string | null;
  agency: string | null;
  sub_agency: string | null;
  description: string | null;
  pop_state: string | null;
  naics_code: string | null;
  naics_description: string | null;
}

/** Fields requested from spending_by_award (display names; see src/lib/fpds.ts). */
export const AWARD_LEAD_FIELDS = [
  "Award ID",
  "Recipient Name",
  "Recipient UEI",
  "Recipient Location",
  "Award Amount",
  "Base Obligation Date",
  "Start Date",
  "Awarding Agency",
  "Awarding Sub Agency",
  "Description",
  "Place of Performance State Code",
  "NAICS",
  "generated_internal_id",
] as const;

/** Smallest award worth selling as a lead (bonding/insurance firms ignore tiny buys). */
export const AWARD_LEAD_MIN_AMOUNT = 25_000;

const text = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};

const isoDate = (v: unknown): string | null => {
  const s = text(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  return s.slice(0, 10);
};

const state = (v: unknown): string | null => {
  const s = text(v)?.toUpperCase() ?? null;
  return s && /^[A-Z]{2}$/.test(s) ? s : null;
};

/**
 * One spending_by_award result row → a lead, or null when it isn't usable
 * (no stable key, no winner name, or an amount under the minimum).
 * NAICS and Recipient Location arrive as objects in current API versions and
 * as plain values in older ones; both are accepted.
 */
export function toAwardLead(r: Record<string, unknown>): AwardLead | null {
  const award_key = text(r.generated_internal_id);
  const recipient_name = text(r["Recipient Name"]);
  const amount = Number(r["Award Amount"]);
  if (!award_key || !recipient_name || !Number.isFinite(amount) || amount < AWARD_LEAD_MIN_AMOUNT) return null;

  const naics = r.NAICS;
  let naics_code: string | null = null;
  let naics_description: string | null = null;
  if (naics && typeof naics === "object") {
    naics_code = text((naics as Record<string, unknown>).code);
    naics_description = text((naics as Record<string, unknown>).description);
  } else {
    naics_code = text(naics);
  }
  if (naics_code && !/^\d{2,6}$/.test(naics_code)) naics_code = null;

  const loc = r["Recipient Location"];
  const locObj = loc && typeof loc === "object" ? (loc as Record<string, unknown>) : {};

  return {
    award_key,
    award_id: text(r["Award ID"]) ?? award_key,
    recipient_name,
    recipient_uei: text(r["Recipient UEI"]),
    recipient_city: text(locObj.city_name),
    recipient_state: state(locObj.state_code),
    amount: Math.round(amount),
    awarded_on: isoDate(r["Base Obligation Date"]) ?? isoDate(r["Start Date"]),
    agency: text(r["Awarding Agency"]),
    sub_agency: text(r["Awarding Sub Agency"]),
    description: text(r.Description),
    pop_state: state(r["Place of Performance State Code"]),
    naics_code,
    naics_description,
  };
}

/** Public USAspending page for an award (so buyers can verify every lead). */
export const usaspendingUrl = (awardKey: string) => `https://www.usaspending.gov/award/${encodeURIComponent(awardKey)}`;

export interface AwardLeadQuery {
  states: string[];
  naics: string[];
  /** Only awards made on/after this date (YYYY-MM-DD). */
  since: string | null;
  minAmount: number;
  limit: number;
  after: number;
}

export const LEADS_MAX_LIMIT = 1000;

/** Validate a leads query string (API and CSV). Never throws. */
export function parseLeadQuery(p: URLSearchParams): { ok: true; query: AwardLeadQuery } | { ok: false; error: string } {
  const list = (v: string | null) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const states = list(p.get("state")).map((s) => s.toUpperCase());
  const bad = states.find((s) => !/^[A-Z]{2}$/.test(s));
  if (bad) return { ok: false, error: `Unknown state code "${bad}". Use two-letter codes, e.g. state=VA,NC.` };
  const naics = list(p.get("naics"));
  const badN = naics.find((n) => !/^\d{2,6}$/.test(n));
  if (badN) return { ok: false, error: `naics must be 2–6 digits ("${badN}" is not).` };
  let since: string | null = null;
  const s = p.get("since");
  if (s) {
    const t = Date.parse(s);
    if (!Number.isFinite(t)) return { ok: false, error: "since must be a date, e.g. 2026-10-01." };
    since = new Date(t).toISOString().slice(0, 10);
  }
  const minRaw = p.get("min_amount");
  const minAmount = minRaw == null ? 0 : Number(minRaw);
  if (!Number.isFinite(minAmount) || minAmount < 0) return { ok: false, error: "min_amount must be a positive number of dollars." };
  const limRaw = p.get("limit");
  const limit = limRaw == null ? 100 : Number(limRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > LEADS_MAX_LIMIT) return { ok: false, error: `limit must be 1 to ${LEADS_MAX_LIMIT}.` };
  const aRaw = p.get("after");
  const after = aRaw == null ? 0 : Number(aRaw);
  if (!Number.isInteger(after) || after < 0) return { ok: false, error: "after must be the next_after value from the previous page." };
  return { ok: true, query: { states, naics, since, minAmount, limit, after } };
}

export const LEAD_CSV_COLUMNS = [
  "Winner",
  "Winner UEI",
  "Winner city",
  "Winner state",
  "Award amount",
  "Awarded on",
  "Agency",
  "Office",
  "Work state",
  "NAICS",
  "NAICS description",
  "Description",
  "Award ID",
  "USAspending link",
] as const;

const csvCell = (v: unknown): string => {
  if (v == null) return "";
  let s = String(v);
  // Spreadsheet formula injection guard: a cell starting with = + - @ is shown as text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function leadsToCsv(rows: AwardLead[]): string {
  const lines = [LEAD_CSV_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.recipient_name,
        r.recipient_uei,
        r.recipient_city,
        r.recipient_state,
        r.amount,
        r.awarded_on,
        r.agency,
        r.sub_agency,
        r.pop_state,
        r.naics_code,
        r.naics_description,
        r.description,
        r.award_id,
        usaspendingUrl(r.award_key),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
