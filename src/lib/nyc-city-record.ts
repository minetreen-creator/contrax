/**
 * New York City's City Record Online, read the way it is meant to be (owner 2026-11-16: "we need
 * more janitorial sources nationwide", then "Go" on New York). Every city agency, the Housing
 * Authority, Health + Hospitals and the Department of Education advertise their solicitations in
 * the City Record, which the city publishes as an open dataset (NYC Open Data dg92-zbpx, more than
 * a million notices of every kind since 2003).
 *
 * `nyc_open_data` used to read the first 200 rows of that dataset with no filter, so it stored old
 * notices of any kind and, on 2026-11-16, timed out. These helpers ask for what a bidder can act
 * on: Procurement-section notices of type "Solicitation" whose deadline is still ahead (99 on
 * 2026-11-16). Contact columns (name, phone, email) are never requested. All PURE.
 */
import type { RawBid } from "~/jobs/sources/sam-gov";

export const NYC_CROL_DATASET = "dg92-zbpx";
export const NYC_CROL_COLUMNS = "request_id,start_date,agency_name,short_title,category_description,selection_method_description,type_of_notice_description,pin,due_date,additional_description_1";

const WALL: Intl.DateTimeFormatOptions = { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
const parts = (t: number) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", WALL).formatToParts(new Date(t)).map((x) => [x.type, x.value]));

/** The SODA parameters for open solicitations. Dates in the dataset are New York wall time. */
export function nycCrolQuery(now: number): Record<string, string> {
  const p = parts(now);
  // From the start of today, so a notice due later today is still read. The dataset also holds
  // placeholder years such as 9999; a real deadline is within three years.
  const where = `section_name='Procurement' AND type_of_notice_description='Solicitation' AND due_date >= '${p.year}-${p.month}-${p.day}T00:00:00' AND due_date < '${Number(p.year) + 3}-01-01T00:00:00'`;
  return { $select: NYC_CROL_COLUMNS, $where: where, $order: "request_id DESC" };
}

/** "2026-11-20T12:00:00.000" printed with no zone is New York time → ISO UTC; null if not that shape. */
export function nycDeadline(v: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(v ?? ""));
  if (!m) return null;
  // A date with no time of day (midnight) closes at the end of that day.
  const [h, mi] = +m[4] === 0 && +m[5] === 0 ? [23, 59] : [+m[4], +m[5]];
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], h, mi);
  const want = `${m[1]}-${m[2]}-${m[3]} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  for (const offset of [4, 5]) {
    const t = wall + offset * 3_600_000;
    const p = parts(t);
    if (`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` === want) return new Date(t).toISOString();
  }
  return null;
}

/** "Housing Authority" → "NYC Housing Authority"; a name that already says NYC or New York stays. */
export function nycAgency(name: string): string {
  const n = name.trim();
  if (!n) return "City of New York";
  return /^(NYC|New York)\b/i.test(n) ? n : `NYC ${n}`;
}

/** "Bid Extension: Correction: X" → "X": the prefix says the notice was re-advertised, not what it buys. */
export function nycTitle(title: string): string {
  return title.replace(/^(?:(?:bid extension|correction|re-?ad|rescheduled|cancellation of)\s*:\s*)+/i, "").trim() || title.trim();
}

/**
 * One row per solicitation. A "Bid Extension:" or "Correction:" notice is a later advertisement of
 * the same PIN, so the newest notice (highest request id) per PIN is kept. Rows with no PIN stay.
 */
export function newestPerPin(rows: readonly RawBid[]): RawBid[] {
  const best = new Map<string, RawBid>();
  const out: RawBid[] = [];
  for (const r of rows) {
    const pin = String(r.solicitation_number ?? "").trim().toLowerCase();
    if (!pin) { out.push(r); continue; }
    const seen = best.get(pin);
    if (!seen || r.external_id > seen.external_id) best.set(pin, r);
  }
  return [...out, ...best.values()];
}
