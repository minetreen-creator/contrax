/**
 * Iowa Bid Opportunities — `ia_das`, the State of Iowa's public list of open
 * solicitations (bidopportunities.iowa.gov, run by the Department of
 * Administrative Services).
 *
 * WHY: Contrax had no state Iowa feed. State agencies (Administrative
 * Services, Natural Resources, Health and Human Services, Transportation,
 * Corrections, …), area education agencies and some local bodies post their
 * RFPs, RFQs and bids there.
 *
 * SOURCE (verified live 2026-10-01, no login, no CAPTCHA: 51 open bids): the
 * listing page's own DataTables request,
 *   GET /Home/DT_HostedBidsSearch?agencyId=&enteredSearchText=&draw=1&start=0&length=-1
 * answered with `{iTotalRecords, aaData: [{ID, BidNumber, Solicitation,
 * Description, AgencyName, EffectiveDate, ExpirationDate, Status, …}]}`.
 * Dates are .NET JSON dates, `/Date(<epoch ms>)/`, true UTC instants (the
 * bid page shows the same instant in Central time: 1792522800000 =
 * "10/20/2026 2:00:00 PM"). `length=-1` returns every row; the count is
 * checked against `iTotalRecords` so nothing is silently cut.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = "Solicitation"; `solicitation_number` = "BidNumber".
 *   - `agency` = "AgencyName", with Iowa's "X, Dept" / "X, Dept Of" written
 *     as "Department of X".
 *   - `location` = "Iowa" (every buyer is an Iowa public body).
 *   - `due_date` = "ExpirationDate" (the listing's "Until").
 *   - `description` = the bid's description with emails, phone numbers and
 *     the buyer's name replaced (contacts are not ingested; agency words
 *     cause false trade matches), plus its keywords.
 *   - `source_url` = the bid's information page, /Home/BidInfo?bidId=<ID>.
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * Rows that are not Open/active, or whose expiration has passed, are skipped.
 *
 * IDENTITY: `external_id = iadas-<ID>` (the site's own bid GUID).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const IA_DAS_SOURCE = "ia_das";
export const IA_DAS_ORIGIN = "https://bidopportunities.iowa.gov";
export const IA_DAS_LIST_URL = `${IA_DAS_ORIGIN}/Home/DT_HostedBidsSearch?agencyId=&enteredSearchText=&draw=1&start=0&length=-1`;
const MAX_DESCRIPTION = 1500;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface IaDasRow {
  ID?: string | null;
  BidNumber?: string | null;
  Solicitation?: string | null;
  Description?: string | null;
  Keywords?: string | null;
  AgencyName?: string | null;
  EffectiveDate?: string | null;
  ExpirationDate?: string | null;
  IsActive?: boolean | null;
  Status?: string | null;
}

export interface IaDasList {
  iTotalRecords?: number;
  aaData?: IaDasRow[];
}

export interface IaDasParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/g;

function clean(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "/Date(1792522800000)/" → ISO. Anything else → null. */
export function iaDateToIso(text: string | null | undefined): string | null {
  const m = String(text ?? "").match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);
  if (!m) return null;
  const ms = Number(m[1]);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

/** "Natural Resources, Dept Of" → "Department of Natural Resources"; others unchanged. */
export function iaAgencyName(name: string | null | undefined): string {
  const n = clean(name);
  const m = n.match(/^(.+?),\s*Dept\.?(?:\s+of)?$/i);
  return m ? `Department of ${m[1]}` : n;
}

function recordSkip(result: IaDasParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseIaDasList(list: IaDasList, now: number = Date.now()): IaDasParseResult {
  const result: IaDasParseResult = { rows: [], skipped: {}, skippedRows: [] };
  for (const r of list.aaData ?? []) {
    const guid = clean(r.ID);
    const rowId = `iadas-${guid}`;
    const title = clean(r.Solicitation);
    const agencyRaw = clean(r.AgencyName);
    if (!/^[0-9a-f-]{36}$/i.test(guid) || !title || !agencyRaw) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    if (r.IsActive === false || (r.Status && r.Status !== "Open")) {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    const due = iaDateToIso(r.ExpirationDate);
    if (!due) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const agency = iaAgencyName(agencyRaw);
    const names = [...new Set([agencyRaw, agency])].map(escapeRegExp).join("|");
    const scrub = (s: string) =>
      s
        .replace(EMAIL_RE, "(email on the bid page)")
        .replace(PHONE_RE, "(phone on the bid page)")
        .replace(new RegExp(`(?:\\bthe\\s+)?(?:${names})`, "gi"), "the buyer");
    let text = scrub(clean(r.Description));
    if (text.length > MAX_DESCRIPTION) text = `${text.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`;
    const keywords = scrub(clean(r.Keywords));
    const number = clean(r.BidNumber);
    const description = [
      text,
      keywords ? `Keywords: ${keywords}.` : "",
      `Posted on Iowa Bid Opportunities${number ? ` as ${number}` : ""}.`,
    ]
      .filter(Boolean)
      .join(" ");
    result.rows.push({
      external_id: rowId,
      title,
      agency,
      description,
      location: "Iowa",
      category: mapCategory("", title, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: `${IA_DAS_ORIGIN}/Home/BidInfo?bidId=${guid}`,
      set_aside: null,
      notice_type: "Solicitation",
      solicitation_number: number || guid,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${IA_DAS_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(IA_DAS_SOURCE, [detail]);
}

/** Fetch every open Iowa bid opportunity and return ingest rows. */
export async function fetchIaDasBids(now: number = Date.now()): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let body: string;
  try {
    const resp = await fetch(IA_DAS_LIST_URL, {
      headers: { "User-Agent": UA, Accept: "application/json", "X-Requested-With": "XMLHttpRequest", Referer: `${IA_DAS_ORIGIN}/` },
      signal: controller.signal,
    });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, IA_DAS_LIST_URL));
    body = await resp.text();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  let list: IaDasList;
  try {
    list = JSON.parse(body) as IaDasList;
  } catch {
    fail(`page shape changed: listing did not return JSON (${body.length} bytes)`);
  }
  if (!Array.isArray(list.aaData)) fail("page shape changed: listing has no aaData array");
  if (typeof list.iTotalRecords === "number" && list.iTotalRecords > list.aaData.length) {
    fail(`list truncated: ${list.aaData.length} of ${list.iTotalRecords} rows returned`);
  }
  const { rows, skipped, skippedRows } = parseIaDasList(list, now);
  console.log(
    `  ${IA_DAS_SOURCE}: ${rows.length} open bids accepted (listed: ${list.aaData.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
