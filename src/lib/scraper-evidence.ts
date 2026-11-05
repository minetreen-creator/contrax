import { blockedUserAgent } from "~/lib/blocked-user-agents";

/**
 * Scraper evidence export (owner 2026-11-05: "do that"). The Nov 5 bid-page
 * scrape and the Oct 29-31 server recon, as CSV files the owner downloads
 * while signed in as admin. The rows go from the database to the owner's
 * browser only: never into logs, the repo or any other service. PURE.
 */
export type EvidencePart = "burst" | "recon";

export const EVIDENCE_PARTS: Record<EvidencePart, { from: string; to: string; file: string }> = {
  // Nov 5, 12:00 PM to 2:00 PM ET: the burst ran 12:20 PM to 1:34 PM.
  burst: { from: "2026-11-05T17:00:00Z", to: "2026-11-05T19:00:00Z", file: "contrax-scrape-2026-11-05.csv" },
  // Oct 28 to Oct 31 ET: the SkyQuantum server recon ran Oct 29-31.
  recon: { from: "2026-10-28T04:00:00Z", to: "2026-11-01T04:00:00Z", file: "contrax-recon-2026-10-29-to-31.csv" },
};

/** The two SkyQuantum /23 blocks (Houston 69.25.90.0/23, Fremont 155.103.64.0/23). */
const RECON_PREFIXES = ["69.25.90.", "69.25.91.", "155.103.64.", "155.103.65."];

export function evidencePart(v: unknown): EvidencePart | null {
  return v === "burst" || v === "recon" ? v : null;
}

/** The Nov 5 scraper's browser: stale desktop Chrome 118-121 / Firefox 120-121. */
export function isScraperFingerprint(userAgent: string | null | undefined): boolean {
  return /^Stale desktop /.test(blockedUserAgent(userAgent) ?? "");
}

export function inReconBlock(ip: string | null | undefined): boolean {
  const v = String(ip ?? "").trim();
  return RECON_PREFIXES.some((p) => v.startsWith(p));
}

export const EVIDENCE_COLUMNS = ["time_et", "time_utc", "ip", "path", "user_agent", "city", "region", "browser", "visitor_id", "referrer"] as const;
export type EvidenceRow = Record<(typeof EVIDENCE_COLUMNS)[number], string>;

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

export function etStamp(d: Date): string {
  const p = Object.fromEntries(ET.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === "24" ? "00" : p.hour}:${p.minute}:${p.second}`;
}

function cell(v: string): string {
  // Quote every cell; neutralize spreadsheet formulas.
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function evidenceCsv(rows: EvidenceRow[]): string {
  const lines = [EVIDENCE_COLUMNS.join(",")];
  for (const r of rows) lines.push(EVIDENCE_COLUMNS.map((c) => cell(r[c] ?? "")).join(","));
  return lines.join("\r\n") + "\r\n";
}
