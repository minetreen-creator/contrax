/**
 * Connecticut CTsource Bid Board — `ct_webprocure`, the State of Connecticut's
 * public bid board (portal.ct.gov/das/ctsource/bidboard), which embeds
 * Proactis WebProcure (customer id 51).
 *
 * WHY: Contrax had no Connecticut feed (owner 2026-10-04). CTsource carries
 * state agencies (DOT, DAS, UConn, UConn Health, the Airport Authority, …)
 * AND Connecticut towns and cities (Stamford, Bristol, Meriden, Old
 * Saybrook, …) on one board.
 *
 * SOURCE (verified live 2026-10-04, no login, no CAPTCHA: 171 open):
 *   GET https://webprocure.proactiscloud.com/wp-full-text-search/search/sols
 *       ?customerid=51&q=*&from=<offset>&sort=r&f=ps%3DOpen&oids=
 * (the same JSON the public board itself loads; 10 records per page, `hits`
 * is the total). The base URL comes from the board's own
 * /wp-web-public/en/resource/?eboId=51.
 *
 * TLS: webprocure.proactiscloud.com serves its leaf certificate WITHOUT the
 * intermediate (Thawte TLS RSA CA G1, issued by DigiCert Global Root G2).
 * Browsers fetch it via AIA; Bun does not. The public intermediate (fetched
 * from cacerts.digicert.com 2026-10-04, verified against the system root,
 * SHA-256 4B:CC:5E:23:…:EB:20:C2, valid to 2027-11-02) is supplied below,
 * ALONGSIDE the normal root store. Verification stays fully on.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = title; `solicitation_number` = bidNumber; `notice_type` =
 *     the board's class (Invitation to Bid, Request for Proposal, …).
 *   - `agency` = the issuing organization (creatorOrg), "Stamford, City of"
 *     → "City of Stamford"; `location` = "Connecticut".
 *   - `due_date` = openDate (the bid opening, i.e. the response deadline).
 *   - `description` = the board's own description (trimmed).
 *   - `estimated_value` = estimatedTotal when published.
 *   - `source_url` = the bid's public page on the board.
 * Skipped: non-Open status (`not_open`), deadline passed (`closed`),
 * missing title/date (`missing_fields`), repeats (`duplicate`).
 *
 * IDENTITY: `external_id = ctwp-<bidid>` (WebProcure's own id).
 */
import { rootCertificates } from "node:tls";
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const CT_WEBPROCURE_SOURCE = "ct_webprocure";
export const CT_CUSTOMER_ID = 51;
export const CT_SEARCH_BASE = "https://webprocure.proactiscloud.com/wp-full-text-search/search/sols";
export const CT_BOARD_URL = "https://portal.ct.gov/das/ctsource/bidboard";

/** Thawte TLS RSA CA G1 (public intermediate; see header). */
export const THAWTE_TLS_RSA_CA_G1 = `-----BEGIN CERTIFICATE-----
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

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const MAX_PAGES = 100;
const PAGE_DELAY_MS = 300;

export interface CtRecord {
  bidid: number;
  bidNumber?: string | null;
  title?: string | null;
  description?: string | null;
  openDate?: number | null;
  startDate?: number | null;
  estimatedTotal?: number | null;
  orgBidClassType?: { description?: string | null } | null;
  ctBidstatus?: { publicStatus?: string | null } | null;
  creatorOrg?: { name?: string | null } | null;
  ownerOrg?: { name?: string | null } | null;
}

export interface CtParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

export function ctSearchUrl(offset: number): string {
  return `${CT_SEARCH_BASE}?customerid=${CT_CUSTOMER_ID}&q=*&from=${offset}&sort=r&f=ps%3DOpen&oids=`;
}

/** The bid's own public page on the board. */
export function ctBidUrl(bidid: number): string {
  return `https://webprocure.proactiscloud.com/wp-web-public/en/#/bidboard/bid/${bidid}?customerid=${CT_CUSTOMER_ID}`;
}

/** "Stamford, City of" → "City of Stamford"; "Transportation, Dept. of" → "Dept. of Transportation". */
export function ctAgencyName(name: string | null | undefined): string {
  const n = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!n) return "State of Connecticut";
  const m = n.match(/^(.+?),\s*((?:Town|City|Borough|Dept\.?|Department|Office|Board|Commission|Division) of(?: the)?)$/i);
  return m ? `${m[2]} ${m[1]}` : n;
}

function money(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? `$${Math.round(v).toLocaleString("en-US")}` : "Not specified";
}

function recordSkip(result: CtParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseCtRecords(records: CtRecord[], now: number = Date.now()): CtParseResult {
  const result: CtParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const r of records) {
    const rowId = `ctwp-${r.bidid}`;
    if (seen.has(rowId)) {
      recordSkip(result, rowId, "duplicate");
      continue;
    }
    seen.add(rowId);
    const status = String(r.ctBidstatus?.publicStatus ?? "").toLowerCase();
    if (status && status !== "open") {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    const title = String(r.title ?? "").replace(/\s+/g, " ").trim();
    if (!r.bidid || !title || typeof r.openDate !== "number") {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    if (r.openDate < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const type = String(r.orgBidClassType?.description ?? "").trim() || null;
    const agency = ctAgencyName(r.creatorOrg?.name ?? r.ownerOrg?.name);
    const body = String(r.description ?? "").replace(/\s+/g, " ").trim().slice(0, 1500);
    const description = [
      body,
      `${agency}${type ? ` ${type}` : " solicitation"}${r.bidNumber ? ` ${r.bidNumber}` : ""} on the CTsource Bid Board.`,
    ]
      .filter(Boolean)
      .join(" ");
    result.rows.push({
      external_id: rowId,
      title,
      agency,
      description,
      location: "Connecticut",
      category: mapCategory("", title, description),
      due_date: new Date(r.openDate).toISOString(),
      estimated_value: money(r.estimatedTotal),
      source_url: ctBidUrl(r.bidid),
      set_aside: null,
      notice_type: type,
      solicitation_number: r.bidNumber ? String(r.bidNumber) : null,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${CT_WEBPROCURE_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(CT_WEBPROCURE_SOURCE, [detail]);
}

/** Fetch every open solicitation (10 per page) and return ingest rows. */
export async function fetchCtWebprocureBids(now: number = Date.now()): Promise<FetchResult> {
  const records: CtRecord[] = [];
  const ca = [...rootCertificates, THAWTE_TLS_RSA_CA_G1];
  let hits = Infinity;
  for (let page = 0; page < MAX_PAGES && records.length < hits; page++) {
    const url = ctSearchUrl(records.length);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    let body: any;
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: controller.signal,
        tls: { ca },
      } as RequestInit);
      if (resp.status !== 200) fail(httpFailureDetail(resp.status, url));
      body = await resp.json();
    } catch (e) {
      if (e instanceof SourceUnreachableError) throw e;
      fail(requestFailureDetail(e));
    } finally {
      clearTimeout(timer);
    }
    if (!body || typeof body.hits !== "number" || !Array.isArray(body.records)) fail("response shape changed: no hits/records");
    hits = body.hits;
    if (body.records.length === 0) break;
    records.push(...(body.records as CtRecord[]));
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }
  const { rows, skipped, skippedRows } = parseCtRecords(records, now);
  console.log(
    `  ${CT_WEBPROCURE_SOURCE}: ${rows.length} open solicitations accepted (listed: ${records.length} of ${hits}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
