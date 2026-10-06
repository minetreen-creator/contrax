/**
 * Rhode Island Ocean State Procures (OSP) open solicitations — `ri_osp`, the
 * State of Rhode Island's statewide bid board (Division of Purchases, every
 * state agency, and RIDOT), hosted on Proactis WebProcure (customer 46).
 *
 * WHY: Contrax had no Rhode Island state feed (owner 2026-10-06: "lets do
 * Rhode Island first", after an SBA Rhode Island district office asked for a
 * resource-list description).
 *
 * SOURCE (verified live 2026-10-06, no login, no CAPTCHA: 81 open):
 * the public bid board RIDOT and ridop.ri.gov embed
 *   https://webprocure.proactiscloud.com/wp-web-public/en/#/bidboard/search?customerid=46
 * loads its rows from the board's own call
 *   GET https://webprocure.proactiscloud.com/wp-full-text-search/search/sols
 *       ?customerid=46&q=*&from=<n>&sort=od&f=ps=Open&oids=
 * (10 per page; `hits` is the total). `sort=od` pages stably — the default
 * relevance sort repeats rows across pages — and the fetch still dedupes by
 * bid id and fails when it ends short of `hits`.
 *
 * TLS: webprocure.proactiscloud.com serves its leaf certificate WITHOUT the
 * intermediate (Thawte TLS RSA CA G1). Browsers fetch it themselves; Bun does
 * not, so the request fails verification. The fetch therefore trusts the
 * system roots PLUS that one public intermediate (DigiCert-issued, from
 * cacerts.digicert.com/ThawteTLSRSACAG1.crt, expires 2027-11-02). Certificate
 * verification stays fully on.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = the bid title; `solicitation_number` = the bid number.
 *   - `agency` = "State of Rhode Island" plus the creating agency when it is not
 *     the Division of Purchases itself (e.g. "Dept of Transportation").
 *   - `due_date` = `openDate`, the bid opening (an absolute timestamp).
 *   - `notice_type` = the bid type ("Request for Quotation", "Open Enrollment
 *     Vendor Assessment", "RIDOT Construction Bid", …). Open-enrollment master
 *     price agreements stay open for months or years; their real close date is
 *     kept, and the type says what they are.
 *   - `description` = the posted description (tags stripped) + how to respond.
 *   - `source_url` = the bid's page on the public board.
 *   - `location` = "Rhode Island"; `naics_code` / `psc` / `set_aside` NULL.
 * Skipped: no id or title (`missing_fields`), repeated id (`duplicate`),
 * unreadable opening (`bad_date`), opening passed (`closed`).
 *
 * IDENTITY: `external_id = riosp-<bid id>`.
 */
import { rootCertificates } from "node:tls";
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const RI_OSP_SOURCE = "ri_osp";
const SEARCH_URL = "https://webprocure.proactiscloud.com/wp-full-text-search/search/sols";
export const RI_OSP_BOARD_URL = "https://webprocure.proactiscloud.com/wp-web-public/en/#/bidboard/search?customerid=46";
const PAGE_SIZE = 10;
const MAX_PAGES = 60;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** Thawte TLS RSA CA G1 (issued by DigiCert Global Root G2; expires 2027-11-02). See TLS above. */
const THAWTE_TLS_RSA_CA_G1 = `-----BEGIN CERTIFICATE-----
MIIEizCCA3OgAwIBAgIQCQ7oxd5b+mLSri/3CXxIVzANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0xNzExMDIxMjI0MjVaFw0yNzExMDIxMjI0MjVaMF4xCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xHTAbBgNVBAMTFFRoYXd0ZSBUTFMgUlNBIENBIEcxMIIBIjANBgkqhkiG9w0B
AQEFAAOCAQ8AMIIBCgKCAQEAxjngmPhVetC0b/ozbYJdzOBUA1sMog47030cAP+P
23ANUN8grXECL8NhDEF4F1R9tL0wY0mczHaR0a7lYanlxtwWo1s2uGnnyDs6mOCs
66ew2w3YETr6Tb14xgjpu1gGFtAeewaikO9Fud8hxGJTSwn8xeNkfKVWpD2L4vFN
36FNgxeilK6aE4ykgGAzNlokTp6hNOLAYpDySdLAPKzuJSQ7JCEZ6O+SDKywIdXL
oMTnpxuBKGSG88NWTo3CHCOGmQECia2yqdPDjgLqnEiYNjwQL8uMqj8rOvlMgviB
cHA7xty+7/uYLN6ZS7Vq1/F/lVhVOf5ej6jZdmB85szFbQIDAQABo4IBQDCCATww
HQYDVR0OBBYEFKWM/jLM6w8s1BnGCLgAJIhdw8W3MB8GA1UdIwQYMBaAFE4iVCAY
lebjbuYP+vq5Eu0GF485MA4GA1UdDwEB/wQEAwIBhjAdBgNVHSUEFjAUBggrBgEF
BQcDAQYIKwYBBQUHAwIwEgYDVR0TAQH/BAgwBgEB/wIBADA0BggrBgEFBQcBAQQo
MCYwJAYIKwYBBQUHMAGGGGh0dHA6Ly9vY3NwLmRpZ2ljZXJ0LmNvbTBCBgNVHR8E
OzA5MDegNaAzhjFodHRwOi8vY3JsMy5kaWdpY2VydC5jb20vRGlnaUNlcnRHbG9i
YWxSb290RzIuY3JsMD0GA1UdIAQ2MDQwMgYEVR0gADAqMCgGCCsGAQUFBwIBFhxo
dHRwczovL3d3dy5kaWdpY2VydC5jb20vQ1BTMA0GCSqGSIb3DQEBCwUAA4IBAQC6
km0KA4sTb2VYpEBm/uL2HL/pZX9B7L/hbJ4NcoBe7V56oCnt7aeIo8sMjCRWTCWZ
D1dY0+2KZOC1dKj8d1VXXAtnjytDDuPPf6/iow0mYQTO/GAg/MLyL6CDm3FzDB8V
tsH/aeMgP6pgD1XQqz+haDnfnJTKBuxhcpnx3Adbleue/QnPf1hHYa8L+Rv8Pi5U
h4V9FwHOfphdMXOxi14OqmsiTbc5cOs9/uukH+YVsuFdWTna6IVw1qh+tEtyH16R
vmi7pkqyZYULOPMIE7avrljVVBZuikwARtY8tCVV6Pp9l3VeagBqb2ffgqNJt3C0
TYNYQI+BXG1R1cABlold
-----END CERTIFICATE-----`;

/** System roots + the missing intermediate (verification stays on). */
const RI_OSP_TLS = { ca: [...rootCertificates, THAWTE_TLS_RSA_CA_G1] };

export interface RiOspRecord {
  bidid: number | string;
  bidNumber?: string | null;
  title?: string | null;
  description?: string | null;
  openDate?: number | null;
  orgBidClassType?: { description?: string | null } | null;
  creatorOrg?: { name?: string | null } | null;
}

export interface RiOspParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

function text(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

export function riOspBidUrl(bidid: number | string): string {
  return `https://webprocure.proactiscloud.com/wp-web-public/en/#/bidboard/bid/${encodeURIComponent(String(bidid))}?customerid=46`;
}

function riOspAgency(creator: string): string {
  const c = creator.trim();
  if (!c || /^state of rhode island$/i.test(c)) return "State of Rhode Island";
  return `State of Rhode Island, ${c}`;
}

function recordSkip(result: RiOspParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function buildRiOspRows(records: RiOspRecord[], now: number = Date.now()): RiOspParseResult {
  const result: RiOspParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const r of records) {
    const id = String(r.bidid ?? "").trim();
    const rowId = `riosp-${id}`;
    const title = text(r.title);
    if (!id || !title) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    if (seen.has(rowId)) {
      recordSkip(result, rowId, "duplicate");
      continue;
    }
    seen.add(rowId);
    const dueMs = typeof r.openDate === "number" ? r.openDate : Number.NaN;
    if (!Number.isFinite(dueMs)) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (dueMs < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const type = text(r.orgBidClassType?.description) || null;
    const number = text(r.bidNumber) || null;
    const posted = text(r.description);
    const description = [
      posted ? (/[.!?]$/.test(posted) ? posted : `${posted}.`) : "",
      `Rhode Island Ocean State Procures ${type ?? "solicitation"}${number ? ` ${number}` : ""}.`,
      "Documents and responses through Ocean State Procures (free vendor registration); see source link.",
    ]
      .filter(Boolean)
      .join(" ");
    result.rows.push({
      external_id: rowId,
      title,
      agency: riOspAgency(text(r.creatorOrg?.name)),
      description,
      location: "Rhode Island",
      category: mapCategory("", title, description),
      due_date: new Date(dueMs).toISOString(),
      estimated_value: "Not specified",
      source_url: riOspBidUrl(id),
      set_aside: null,
      notice_type: type,
      solicitation_number: number,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${RI_OSP_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(RI_OSP_SOURCE, [detail]);
}

/** Page the open-solicitation search and return ingest rows. */
export async function fetchRiOspBids(now: number = Date.now()): Promise<FetchResult> {
  const records: RiOspRecord[] = [];
  const ids = new Set<string>();
  let hits = -1;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ customerid: "46", q: "*", from: String(page * PAGE_SIZE), sort: "od", f: "ps=Open", oids: "" });
    const url = `${SEARCH_URL}?${params}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    let body: any;
    try {
      const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: controller.signal, tls: RI_OSP_TLS } as RequestInit);
      if (resp.status !== 200) fail(httpFailureDetail(resp.status, url));
      body = await resp.json();
    } catch (e) {
      if (e instanceof SourceUnreachableError) throw e;
      fail(requestFailureDetail(e));
    } finally {
      clearTimeout(timer);
    }
    if (!Array.isArray(body?.records) || typeof body?.hits !== "number") fail("response shape changed: no records/hits");
    hits = body.hits;
    for (const r of body.records as RiOspRecord[]) {
      const id = String(r?.bidid ?? "");
      if (id && !ids.has(id)) {
        ids.add(id);
        records.push(r);
      }
    }
    if ((page + 1) * PAGE_SIZE >= hits || body.records.length === 0) break;
  }
  if (records.length < hits) fail(`only ${records.length} of ${hits} open solicitations read`);
  const { rows, skipped, skippedRows } = buildRiOspRows(records, now);
  console.log(
    `  ${RI_OSP_SOURCE}: ${rows.length} open solicitations accepted (listed: ${hits}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
