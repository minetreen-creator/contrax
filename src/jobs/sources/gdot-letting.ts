/**
 * Georgia DOT's public "Project Letting by Month" forecast (owner 2026-11-08: "Add as 'Upcoming'").
 *
 * WHAT IT IS: GDOT's own forecast of the road and bridge jobs it plans to let (put out to bid) in
 * each of the next six months, with county, work type and estimated cost. It is NOT a bid notice:
 * planned months slip, and the advertised notice (with plans and the real bid date) is posted on Bid
 * Express, which needs a login. So these rows go to the Upcoming forecasts page
 * (procurement_forecasts, source `ga_gdot_lettings`), never into the open-bids table.
 *
 * SOURCE (verified 2026-11-08, anonymous, no sign-in): GDOT's dashboard at gdotbiext.dot.ga.gov
 * (anon=1). dot.ga.gov's robots file allows it (`search=yes`). The page is Oracle Analytics, so
 * .github/scripts/gdot-letting-fetch.mjs opens it in headless Chrome and hands over the HTML.
 *
 * CHECKS (the read fails loudly instead of half-reading): the page title and the seven column
 * headings must be the ones this reader knows; every month table must have a "Month Total" row and
 * its project costs must add up to that total exactly; project ids must look like GDOT ids
 * (0016573, M006532, 122060-); the page's "Processed on" date must be within 10 days of the capture.
 */
import { SourceUnreachableError } from "../fetch-failure";

export const GDOT_LETTING_SOURCE = "ga_gdot_lettings";
export const GDOT_LETTING_PAGE =
  "https://gdotbiext.dot.ga.gov/ext-bi/saw.dll?Dashboard&PortalPath=/shared/External/_portal/Project%20Letting%20by%20Month&Page=Project%20Letting%20By%20Month&Action=Navigate&Syndicate=true&anon=1";

export const GDOT_LETTING_COLUMNS = [
  "Project ID",
  "Short Description",
  "County",
  "Primary Work Type",
  "Project Let By",
  "Project Sponsor",
  "Total Estimated Cost",
] as const;

export interface GdotLettingProject {
  projectId: string;
  /** "2026-11" */
  letMonth: string;
  /** "Nov 2026", as the page prints it. */
  letLabel: string;
  description: string;
  county: string;
  workType: string;
  letBy: string;
  sponsor: string;
  /** Whole dollars, as GDOT rounds them. */
  estimatedCost: number;
}

export interface GdotLettingParse {
  processedOn: string;
  months: { letMonth: string; letLabel: string; projects: number; total: number }[];
  projects: GdotLettingProject[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|[a-z]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? (e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) : m))
    .replace(/\s+/g, " ")
    .trim();
}

function dollars(s: string): number | null {
  const m = /^\$([\d,]+)$/.exec(s.trim());
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** "Nov-08-2026 12:19 PM" → "2026-11-08". */
function processedDate(html: string): string | null {
  const m = /Processed on:\s*([A-Z][a-z]{2})-(\d{2})-(\d{4})/.exec(decode(html.slice(0, 600_000)));
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1]);
  return mo < 0 ? null : `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[2]}`;
}

/** Parse the dashboard HTML. PURE; `capturedAt` is the collector's capture time. */
export function parseGdotLetting(html: string, capturedAt: string): GdotLettingParse {
  const fail = (detail: string): never => {
    throw new SourceUnreachableError(GDOT_LETTING_SOURCE, [detail]);
  };
  if (!/GDOT Project Letting Forecast/.test(html)) fail("Page shape changed: no 'GDOT Project Letting Forecast'");
  const processedOn = processedDate(html) ?? fail("Page shape changed: no 'Processed on' date");
  const captured = Date.parse(capturedAt);
  if (!Number.isFinite(captured)) fail("Undated capture");
  if (Math.abs(captured - Date.parse(`${processedOn}T12:00:00Z`)) > 10 * 86_400_000) fail(`Stale forecast (processed ${processedOn})`);

  // Month heading of each table: <table … id="<cid>_3_0_Tbl" …> … >Nov 2026<
  const monthOf = new Map<string, { letMonth: string; letLabel: string }>();
  for (const m of html.matchAll(/id="(saw_\d+_[0-9a-z]+)_3_0_Tbl"[\s\S]{0,800}?>\s*([A-Z][a-z]{2}) (20\d\d)\s*</g)) {
    const mo = MONTHS.indexOf(m[2]);
    if (mo >= 0 && !monthOf.has(m[1])) monthOf.set(m[1], { letMonth: `${m[3]}-${String(mo + 1).padStart(2, "0")}`, letLabel: `${m[2]} ${m[3]}` });
  }
  if (monthOf.size === 0) fail("Page shape changed: no month tables");

  // Cells: <td … id="e_<cid>_1_<col>_<row>" …>text</td>
  const cells = new Map<string, Map<number, string[]>>();
  for (const m of html.matchAll(/<td\b[^>]*\bid="e_(saw_\d+_[0-9a-z]+)_1_(\d+)_(\d+)"[^>]*>([\s\S]*?)<\/td>/g)) {
    const [, cid, col, row, text] = m;
    if (!monthOf.has(cid)) continue;
    const table = cells.get(cid) ?? new Map<number, string[]>();
    const r = table.get(Number(row)) ?? [];
    r[Number(col)] = decode(text);
    table.set(Number(row), r);
    cells.set(cid, table);
  }

  // Column headings of each table: <td … id="hl_<cid>_1_<col>" …>Heading<div…
  for (const cid of monthOf.keys()) {
    const heads = [...html.matchAll(new RegExp(`id="hl_${cid}_1_(\\d+)"[^>]*>([\\s\\S]*?)<div`, "g"))]
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map((h) => decode(h[2]));
    if (heads.join("|") !== GDOT_LETTING_COLUMNS.join("|")) fail(`Page shape changed: columns [${heads.join(", ")}]`);
  }

  const projects: GdotLettingProject[] = [];
  const months: GdotLettingParse["months"] = [];
  const seen = new Set<string>();
  for (const [cid, month] of monthOf) {
    const table = cells.get(cid);
    if (!table) fail(`No rows for ${month.letLabel}`);
    let total: number | null = null;
    let sum = 0;
    let count = 0;
    for (const [, r] of [...table!].sort((a, b) => a[0] - b[0])) {
      if (r[0] === "Month Total") {
        total = dollars(r[6] ?? "");
        continue;
      }
      const cost = dollars(r[6] ?? "");
      if (!/^[0-9A-Z][0-9A-Z-]{3,14}$/.test(r[0] ?? "") || !r[1] || cost === null) fail(`Row shape changed in ${month.letLabel}: ${JSON.stringify(r)}`);
      sum += cost!;
      count++;
      if (seen.has(r[0])) continue; // a project listed twice keeps its first (earliest) month
      seen.add(r[0]);
      projects.push({
        projectId: r[0],
        letMonth: month.letMonth,
        letLabel: month.letLabel,
        description: r[1],
        county: r[2] ?? "",
        workType: r[3] ?? "",
        letBy: r[4] ?? "",
        sponsor: r[5] ?? "",
        estimatedCost: cost!,
      });
    }
    if (total === null) fail(`No 'Month Total' for ${month.letLabel}`);
    if (sum !== total) fail(`${month.letLabel}: projects add up to $${sum}, page total is $${total}`);
    months.push({ ...month, projects: count, total: total! });
  }
  months.sort((a, b) => a.letMonth.localeCompare(b.letMonth));
  return { processedOn, months, projects };
}

/** Georgia's fiscal year runs July–June: Nov 2026 is FY2027. PURE. */
export function georgiaFiscalYear(letMonth: string): number {
  const [y, m] = letMonth.split("-").map(Number);
  return m >= 7 ? y + 1 : y;
}

export interface ForecastRecord {
  source: string;
  external_id: string;
  title: string;
  description: string;
  fiscal_year: number;
  fiscal_quarter: string;
  payload: Record<string, unknown>;
}

/** One procurement_forecasts row per project. PURE. */
export function gdotForecastRecord(p: GdotLettingProject, processedOn: string): ForecastRecord {
  const county = /^all counties$/i.test(p.county) ? "multiple counties" : `${p.county} County`;
  return {
    source: GDOT_LETTING_SOURCE,
    external_id: p.projectId,
    title: p.description,
    description: `Georgia DOT project ${p.projectId}: ${p.description} (${county}). Work type: ${p.workType || "not stated"}. Planned letting: ${p.letLabel}, per GDOT's Project Letting by Month forecast (processed ${processedOn}). This is a forecast, not a bid notice: the month can change, and when GDOT advertises the project the bid notice and plans are posted on Bid Express.`,
    fiscal_year: georgiaFiscalYear(p.letMonth),
    fiscal_quarter: p.letLabel,
    payload: {
      kind: "dot-letting",
      agency: "Georgia Department of Transportation",
      letMonth: p.letMonth,
      letLabel: p.letLabel,
      county: p.county,
      state: "GA",
      workType: p.workType,
      letBy: p.letBy === "LOC" ? "Local government" : p.letBy === "DOT" ? "GDOT" : p.letBy,
      sponsor: p.sponsor,
      estimatedCost: p.estimatedCost,
      processedOn,
      sourceUrl: GDOT_LETTING_PAGE,
    },
  };
}
