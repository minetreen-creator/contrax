/**
 * Ohio Department of Transportation construction lettings — `oh_odot`.
 *
 * WHY: Ohio's state agency bids are on OhioBuys, whose public bid list sits
 * behind a Google reCAPTCHA; Contrax does not get around bot protection, so
 * that portal is out (owner 2026-10-01 chose ODOT instead). ODOT lets heavy
 * highway construction (resurfacing, bridges, culverts, slides, interchanges,
 * signing, mowing, …) on a regular schedule and publishes it openly.
 *
 * SOURCE (verified live 2026-10-01, no login, no CAPTCHA): the "Planholders
 * Summary" linked from ODOT Contract Administration,
 *   https://www.dot.state.oh.us/divisions/contractadmin/contracts/Planholders/bidlist.txt
 * a fixed-width text file with ONE LINE PER (project, planholder):
 *   col 0   letting date (M/D/YYYY)     col 14  project number
 *   col 28  county code (HAM) or district (D03)
 *   col 42  planholder company …        col 210 work type ("BRIDGE REPAIR")
 * This connector groups the lines by project and keeps only the project-level
 * fields; planholder companies, phones and addresses are NOT ingested. A
 * project appears once a contractor has requested its plans, so a project
 * with no planholders yet is not in the file (it shows up when one does).
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title`       = "<Work type> — ODOT project <number>, <County> County"
 *                     (or ", District <n>" for district-wide projects).
 *   - `agency`      = "Ohio Department of Transportation".
 *   - `location`    = "<County> County, Ohio", or "Ohio" for district-wide
 *                     projects and for Delaware and Washington counties (the
 *                     shared state resolver reads "Delaware County, Ohio" as
 *                     the state of Delaware; the county stays in the title).
 *   - `due_date`    = the letting date at 12:00 AM Eastern. The file has no
 *                     time; bids are opened at the letting that day, so the
 *                     row is never shown as open later than it really is.
 *   - `solicitation_number` = project number; `notice_type` = "Construction letting".
 *   - `source_url`  = ODOT Contract Administration (proposals, plans, the
 *                     Bid Letting Pamphlet). There is no per-project page.
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * Projects whose letting date has passed are skipped (`closed`).
 *
 * IDENTITY: `external_id = odot-<project number>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import {
  httpFailureDetail,
  requestFailureDetail,
  SourceUnreachableError,
} from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const ODOT_SOURCE = "oh_odot";
export const ODOT_BIDLIST_URL =
  "https://www.dot.state.oh.us/divisions/contractadmin/contracts/Planholders/bidlist.txt";
export const ODOT_CONTRACTS_URL =
  "https://www.dot.state.oh.us/Divisions/ContractAdmin/Contracts/Pages/default.aspx";
const ODOT_AGENCY = "Ohio Department of Transportation";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** ODOT's three-letter county codes → county names (all 88 Ohio counties). */
export const ODOT_COUNTIES: Record<string, string> = {
  ADA: "Adams", ALL: "Allen", ASD: "Ashland", ATB: "Ashtabula", ATH: "Athens", AUG: "Auglaize",
  BEL: "Belmont", BRO: "Brown", BUT: "Butler", CAR: "Carroll", CHP: "Champaign", CLA: "Clark",
  CLE: "Clermont", CLI: "Clinton", COL: "Columbiana", COS: "Coshocton", CRA: "Crawford",
  CUY: "Cuyahoga", DAR: "Darke", DEF: "Defiance", DEL: "Delaware", ERI: "Erie", FAI: "Fairfield",
  FAY: "Fayette", FRA: "Franklin", FUL: "Fulton", GAL: "Gallia", GEA: "Geauga", GRE: "Greene",
  GUE: "Guernsey", HAM: "Hamilton", HAN: "Hancock", HAR: "Hardin", HAS: "Harrison", HEN: "Henry",
  HIG: "Highland", HOC: "Hocking", HOL: "Holmes", HUR: "Huron", JAC: "Jackson", JEF: "Jefferson",
  KNO: "Knox", LAK: "Lake", LAW: "Lawrence", LIC: "Licking", LOG: "Logan", LOR: "Lorain",
  LUC: "Lucas", MAD: "Madison", MAH: "Mahoning", MAR: "Marion", MED: "Medina", MEG: "Meigs",
  MER: "Mercer", MIA: "Miami", MOE: "Monroe", MOT: "Montgomery", MRG: "Morgan", MRW: "Morrow",
  MUS: "Muskingum", NOB: "Noble", OTT: "Ottawa", PAU: "Paulding", PER: "Perry", PIC: "Pickaway",
  PIK: "Pike", POR: "Portage", PRE: "Preble", PUT: "Putnam", RIC: "Richland", ROS: "Ross",
  SAN: "Sandusky", SCI: "Scioto", SEN: "Seneca", SHE: "Shelby", STA: "Stark", SUM: "Summit",
  TRU: "Trumbull", TUS: "Tuscarawas", UNI: "Union", VAN: "Van Wert", VIN: "Vinton", WAR: "Warren",
  WAS: "Washington", WAY: "Wayne", WIL: "Williams", WOO: "Wood", WYA: "Wyandot",
};

export interface OdotProject {
  project: string;
  letting: string; // M/D/YYYY as printed
  area: string; // county code or district code
  workType: string;
}

export interface OdotParseResult {
  rows: RawBid[];
  projects: OdotProject[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

const LINE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\S+)\s+([A-Z0-9]{3})\s/;
const WORK_TYPE_COL = 210;
const WORK_TYPE_WIDTH = 50;

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\((\d+) Bridges?\)/i, (m) => m.replace(/Bridge/i, "bridge"));
}

/** US Eastern offset (hours) for a calendar date: EDT 2nd Sun Mar – 1st Sun Nov. */
function easternOffset(year: number, month: number, day: number): number {
  const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
  const day0 = Date.UTC(year, month - 1, day);
  return day0 >= dstStart && day0 < dstEnd ? -4 : -5;
}

/** "10/29/2026" → 2026-10-29T04:00:00Z (12:00 AM Eastern). Invalid → null. */
export function odotLettingToIso(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day) - easternOffset(year, month, day) * 3_600_000).toISOString();
}

/** Ohio counties named like a US state: their name would win the state resolver. */
const STATE_NAMED_COUNTIES = new Set(["Delaware", "Washington"]);

/** "HAM" → "Hamilton County, Ohio"; "D03", unknown, Delaware, Washington → "Ohio". */
export function odotLocation(area: string): string {
  const county = ODOT_COUNTIES[area];
  return county && !STATE_NAMED_COUNTIES.has(county) ? `${county} County, Ohio` : "Ohio";
}

/** "HAM" → "Hamilton County"; "D03" → "District 3"; unknown → the code. */
export function odotAreaLabel(area: string): string {
  const county = ODOT_COUNTIES[area];
  if (county) return `${county} County`;
  const d = area.match(/^D(\d{2})$/);
  return d ? `District ${Number(d[1])}` : area;
}

/** Group the planholder lines into one record per project (first line wins). */
export function readOdotBidList(text: string): OdotProject[] {
  const byProject = new Map<string, OdotProject>();
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(LINE_RE);
    if (!m) continue;
    const project = m[4];
    if (byProject.has(project)) continue;
    byProject.set(project, {
      project,
      letting: `${Number(m[1])}/${Number(m[2])}/${m[3]}`,
      area: m[5],
      workType: raw.slice(WORK_TYPE_COL, WORK_TYPE_COL + WORK_TYPE_WIDTH).trim(),
    });
  }
  return [...byProject.values()];
}

function recordSkip(result: OdotParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseOdotBidList(text: string, now: number = Date.now()): OdotParseResult {
  const result: OdotParseResult = { rows: [], projects: readOdotBidList(text), skipped: {}, skippedRows: [] };
  for (const p of result.projects) {
    const rowId = `odot-${p.project}`;
    const due = odotLettingToIso(p.letting);
    if (!due) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const work = p.workType ? titleCase(p.workType) : "Highway construction";
    const area = odotAreaLabel(p.area);
    const title = `${work} — ODOT project ${p.project}, ${area}`;
    const description =
      `Ohio DOT construction project ${p.project} (${work.toLowerCase()}), ${area}, let on ${p.letting}. ` +
      "Bidders must be prequalified by ODOT. Proposals, plans and the bid letting pamphlet are on ODOT's Contracts page (see source link).";
    result.rows.push({
      external_id: rowId,
      title,
      agency: ODOT_AGENCY,
      description,
      location: odotLocation(p.area),
      category: mapCategory("", title, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: ODOT_CONTRACTS_URL,
      set_aside: null,
      notice_type: "Construction letting",
      solicitation_number: p.project,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${ODOT_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(ODOT_SOURCE, [detail]);
}

/** Fetch ODOT's planholders summary and return one bid per upcoming project. */
export async function fetchOhOdotBids(now: number = Date.now()): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let text: string;
  try {
    const resp = await fetch(ODOT_BIDLIST_URL, {
      headers: { "User-Agent": UA, Accept: "text/plain,*/*" },
      signal: controller.signal,
    });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, ODOT_BIDLIST_URL));
    text = await resp.text();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  const { rows, projects, skipped, skippedRows } = parseOdotBidList(text, now);
  if (projects.length === 0) fail(`file shape changed: no project lines (${text.length} bytes)`);
  console.log(
    `  ${ODOT_SOURCE}: ${rows.length} upcoming projects accepted (projects in file: ${projects.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
