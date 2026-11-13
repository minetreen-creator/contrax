/**
 * PlanetBids public "Bid Opportunities" boards (owner 2026-11-08: "add the big Ohio buyers";
 * "Yes, use a real browser"). PlanetBids refuses direct data requests from programs
 * ("DIRECT_ACCESS"), so `.github/scripts/planetbids-bids-fetch.mjs` loads the agency's public
 * portal page in a real browser (as ContraxBot, never signed in) and records the "Bidding" stage
 * bids the page itself lists. This module validates that payload and maps it to bids.
 *
 *   `oh_toledo_planetbids`: City of Toledo (company id 22576), plus the City of San Diego, the San
 *   Diego airport and port, Valley Water, Sacramento RT and Metroparks Toledo (see PLANETBIDS_BOARDS).
 *
 * Skipped: invitation-only bids (`by_invitation`), RFIs (`not_a_solicitation`), anything not in
 * the Bidding stage (`not_bidding`) or already past due (`closed`). Due times are the agency's
 * local time (its PlanetBids time zone). Rows link to the bid's public PlanetBids detail page.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { mapCategory } from "~/lib/trade-classification";
import { SourceUnreachableError } from "../fetch-failure";
import type { FetchResult } from "../runner";
import type { RawBid } from "./sam-gov";
import { zonedIso } from "./revize-bids";

export interface PlanetbidsBoard {
  source: string;
  cid: number;
  agency: string;
  location: string;
  idPrefix: string;
}

export const PLANETBIDS_BOARDS: readonly PlanetbidsBoard[] = [
  { source: "oh_toledo_planetbids", cid: 22576, agency: "City of Toledo", location: "Toledo, OH", idPrefix: "toledoplanetbids" },
  // Owner 2026-11-08 ("yes"): agencies PlanetBids' own state pages list, IDs taken from each
  // agency's purchasing page and checked with the browser driver the same day.
  { source: "ca_san_diego_planetbids", cid: 17950, agency: "City of San Diego", location: "San Diego, CA", idPrefix: "sandiegoplanetbids" },
  { source: "ca_san_diego_airport_planetbids", cid: 16725, agency: "San Diego County Regional Airport Authority", location: "San Diego, CA", idPrefix: "sanplanetbids" },
  { source: "ca_port_of_san_diego_planetbids", cid: 13982, agency: "Port of San Diego", location: "San Diego, CA", idPrefix: "portsandiegoplanetbids" },
  { source: "ca_valley_water_planetbids", cid: 48397, agency: "Santa Clara Valley Water District", location: "San Jose, CA", idPrefix: "valleywaterplanetbids" },
  { source: "ca_sacrt_planetbids", cid: 39480, agency: "Sacramento Regional Transit District", location: "Sacramento, CA", idPrefix: "sacrtplanetbids" },
  { source: "oh_metroparks_toledo_planetbids", cid: 59805, agency: "Metroparks Toledo", location: "Toledo, OH", idPrefix: "metroparkstoledoplanetbids" },
  // Owner 2026-11-13 ("we need thousands"): agencies whose portal ids came from public search results,
  // each read with this browser driver the same day (open bids at the time in the PR).
  { source: "ca_bakersfield_planetbids", cid: 14660, agency: "City of Bakersfield", location: "Bakersfield, CA", idPrefix: "bakersfieldplanetbids" },
  { source: "ca_culver_city_planetbids", cid: 39483, agency: "City of Culver City", location: "Culver City, CA", idPrefix: "culvercityplanetbids" },
  { source: "ca_eastvale_planetbids", cid: 43976, agency: "City of Eastvale", location: "Eastvale, CA", idPrefix: "eastvaleplanetbids" },
  { source: "ca_ontario_planetbids", cid: 11434, agency: "City of Ontario", location: "Ontario, CA", idPrefix: "ontarioplanetbids" },
  { source: "ca_vallejo_planetbids", cid: 42510, agency: "City of Vallejo", location: "Vallejo, CA", idPrefix: "vallejoplanetbids" },
  { source: "ca_vernon_planetbids", cid: 40532, agency: "City of Vernon", location: "Vernon, CA", idPrefix: "vernonplanetbids" },
  { source: "ca_fillmore_planetbids", cid: 53681, agency: "City of Fillmore", location: "Fillmore, CA", idPrefix: "fillmoreplanetbids" },
  { source: "ca_beaumont_planetbids", cid: 66785, agency: "City of Beaumont", location: "Beaumont, CA", idPrefix: "beaumontplanetbids" },
  { source: "ca_buena_park_planetbids", cid: 39485, agency: "City of Buena Park", location: "Buena Park, CA", idPrefix: "buenaparkplanetbids" },
  { source: "ca_south_coast_water_planetbids", cid: 19768, agency: "South Coast Water District", location: "Orange County, CA", idPrefix: "southcoastwaterplanetbids" },
  { source: "ca_otay_water_planetbids", cid: 63777, agency: "Otay Water District", location: "San Diego County, CA", idPrefix: "otaywaterplanetbids" },
  { source: "ca_cvwd_planetbids", cid: 16339, agency: "Coachella Valley Water District", location: "Riverside County, CA", idPrefix: "cvwdplanetbids" },
  { source: "ca_san_bernardino_planetbids", cid: 39495, agency: "City of San Bernardino", location: "San Bernardino, CA", idPrefix: "sanbernardinoplanetbids" },
  { source: "ca_lacc_planetbids", cid: 21372, agency: "Los Angeles Community College District", location: "Los Angeles, CA", idPrefix: "laccplanetbids" },
  { source: "ca_duarte_planetbids", cid: 42035, agency: "City of Duarte", location: "Duarte, CA", idPrefix: "duarteplanetbids" },
  { source: "ca_compton_planetbids", cid: 69231, agency: "City of Compton", location: "Compton, CA", idPrefix: "comptonplanetbids" },
  { source: "ca_beverly_hills_planetbids", cid: 39493, agency: "City of Beverly Hills", location: "Beverly Hills, CA", idPrefix: "beverlyhillsplanetbids" },
  { source: "ca_lacoe_planetbids", cid: 61954, agency: "Los Angeles County Office of Education", location: "Los Angeles County, CA", idPrefix: "lacoeplanetbids" },
  { source: "ca_signal_hill_planetbids", cid: 36746, agency: "City of Signal Hill", location: "Signal Hill, CA", idPrefix: "signalhillplanetbids" },
  { source: "ca_la_habra_planetbids", cid: 56603, agency: "City of La Habra", location: "La Habra, CA", idPrefix: "lahabraplanetbids" },
  { source: "ca_santa_ana_planetbids", cid: 20137, agency: "City of Santa Ana", location: "Santa Ana, CA", idPrefix: "santaanaplanetbids" },
  { source: "ca_fountain_valley_planetbids", cid: 25002, agency: "City of Fountain Valley", location: "Fountain Valley, CA", idPrefix: "fountainvalleyplanetbids" },
  { source: "ca_huntington_beach_planetbids", cid: 15340, agency: "City of Huntington Beach", location: "Huntington Beach, CA", idPrefix: "huntingtonbeachplanetbids" },
  { source: "ca_riverside_planetbids", cid: 39475, agency: "City of Riverside", location: "Riverside, CA", idPrefix: "riversideplanetbids" },
  { source: "ca_ocfa_planetbids", cid: 14773, agency: "Orange County Fire Authority", location: "Orange County, CA", idPrefix: "ocfaplanetbids" },
  { source: "ca_sb_county_housing_planetbids", cid: 40135, agency: "Housing Authority of the County of San Bernardino", location: "San Bernardino County, CA", idPrefix: "sbcountyhousingplanetbids" },
  { source: "ca_corona_planetbids", cid: 39497, agency: "City of Corona", location: "Corona, CA", idPrefix: "coronaplanetbids" },
  { source: "ca_rctc_planetbids", cid: 17920, agency: "Riverside County Transportation Commission", location: "Riverside County, CA", idPrefix: "rctcplanetbids" },
  { source: "ca_peralta_cc_planetbids", cid: 71895, agency: "Peralta Community College District", location: "Oakland, CA", idPrefix: "peraltaccplanetbids" },
  { source: "ca_long_beach_usd_planetbids", cid: 23758, agency: "Long Beach Unified School District", location: "Long Beach, CA", idPrefix: "longbeachusdplanetbids" },
  { source: "ca_contra_costa_cc_planetbids", cid: 67229, agency: "Contra Costa Community College District", location: "Contra Costa County, CA", idPrefix: "contracostaccplanetbids" },
  { source: "ca_san_diego_usd_planetbids", cid: 43764, agency: "San Diego Unified School District", location: "San Diego, CA", idPrefix: "sandiegousdplanetbids" },
  { source: "ca_moreno_valley_usd_planetbids", cid: 59999, agency: "Moreno Valley Unified School District", location: "Moreno Valley, CA", idPrefix: "morenovalleyusdplanetbids" },
  { source: "ca_rialto_usd_planetbids", cid: 52215, agency: "Rialto Unified School District", location: "Rialto, CA", idPrefix: "rialtousdplanetbids" },
  { source: "tx_capmetro_planetbids", cid: 39494, agency: "Capital Metropolitan Transportation Authority", location: "Austin, TX", idPrefix: "capmetroplanetbids" },
  { source: "or_port_of_portland_planetbids", cid: 15598, agency: "Port of Portland", location: "Portland, OR", idPrefix: "portofportlandplanetbids" },
  { source: "ca_central_san_planetbids", cid: 14663, agency: "Central Contra Costa Sanitary District", location: "Contra Costa County, CA", idPrefix: "centralsanplanetbids" },
  { source: "ca_fresno_planetbids", cid: 14769, agency: "City of Fresno", location: "Fresno, CA", idPrefix: "fresnoplanetbids" },
  { source: "ca_smud_planetbids", cid: 73214, agency: "Sacramento Municipal Utility District", location: "Sacramento, CA", idPrefix: "smudplanetbids" },
];

export interface PlanetbidsBid {
  bidId: number;
  title: string;
  invitationNum: string | null;
  bidDueDate: string | null;
  stageId: number;
  stageStr: string;
  bidTypeId: number;
  byInvitation: boolean;
  companyId: number;
}

export interface PlanetbidsPayload {
  capturedAt: string;
  cid: number;
  agency: { companyId: number; companyName: string; timeZoneName: string };
  bids: PlanetbidsBid[];
}

const ZONES = new Set(["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"]);
const TYPE: Record<number, { label: string; notice: string | null }> = {
  1: { label: "Bid", notice: "ITB" },
  2: { label: "RFI", notice: null },
  4: { label: "RFP", notice: "RFP" },
  8: { label: "RFQ", notice: "RFQ" },
  16: { label: "Request for Qualifications", notice: "RFQ" },
  32: { label: "Informal Public Works Bid", notice: "ITB" },
};

/** "2026-11-10 13:30:00.000" in the agency's zone → ISO. PURE. */
export function planetbidsDue(value: string | null, zone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(String(value ?? "").trim());
  if (!m || !ZONES.has(zone)) return null;
  return zonedIso(zone as "America/New_York", +m[1], +m[2], +m[3], +m[4], +m[5]);
}

/** Validate a captured payload and map it to bids. PURE. */
export function mapPlanetbids(board: PlanetbidsBoard, payload: PlanetbidsPayload, now: number = Date.now()): FetchResult & { rows: RawBid[]; skipped: Record<string, number> } {
  const fail = (detail: string): never => { throw new SourceUnreachableError(board.source, [detail]); };
  if (!payload || payload.cid !== board.cid || payload.agency?.companyId !== board.cid || !Array.isArray(payload.bids)) fail("Payload missing or for another agency");
  const captured = Date.parse(payload.capturedAt);
  if (!Number.isFinite(captured) || Math.abs(now - captured) > 30 * 60_000) fail("Stale or undated payload");
  const zone = payload.agency.timeZoneName;
  if (!ZONES.has(zone)) fail(`Unknown agency time zone ${zone}`);
  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  const seen = new Set<number>();
  for (const b of payload.bids) {
    if (!Number.isInteger(b?.bidId) || typeof b.title !== "string") fail("Bid row shape changed");
    const id = `${board.idPrefix}-${b.bidId}`;
    const skip = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; skippedRows.push({ id, reason }); };
    if (seen.has(b.bidId)) { skip("duplicate"); continue; }
    seen.add(b.bidId);
    if (b.companyId !== board.cid) { skip("other_agency"); continue; }
    if (b.stageId !== 3) { skip("not_bidding"); continue; }
    if (b.byInvitation) { skip("by_invitation"); continue; }
    const type = TYPE[b.bidTypeId];
    if (!type) fail(`Unknown bid type ${b.bidTypeId}`);
    if (b.bidTypeId === 2) { skip("not_a_solicitation"); continue; }
    const title = b.title.replace(/\s+/g, " ").trim();
    if (!title) { skip("missing_fields"); continue; }
    const due = planetbidsDue(b.bidDueDate, zone);
    if (!due) { skip("bad_date"); continue; }
    if (Date.parse(due) <= now) { skip("closed"); continue; }
    const number = (b.invitationNum ?? "").trim();
    const dueText = String(b.bidDueDate).slice(0, 16);
    const description = `${board.agency} ${type.label}${number ? ` ${number}` : ""}: ${title}. Due ${dueText} (${zone.replace("America/", "").replace("_", " ")} time). Documents and how to respond are on the agency's public PlanetBids page.`;
    rows.push({
      external_id: id,
      title,
      agency: board.agency,
      location: board.location,
      description,
      category: mapCategory("", title, ""),
      due_date: due,
      estimated_value: "",
      source_url: `https://vendors.planetbids.com/portal/${board.cid}/bo/bo-detail/${b.bidId}`,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: number || null,
      notice_type: type.notice,
    });
  }
  return { rows, skipped, skippedRows };
}

export const planetbidsDeps = {
  run: (script: string, env: Record<string, string>) => promisify(execFile)("node", [script], { timeout: 180_000, maxBuffer: 1_000_000, env: { ...process.env, ...env } }),
};

export async function fetchPlanetbidsBoard(board: PlanetbidsBoard): Promise<FetchResult> {
  const dir = mkdtempSync(join(tmpdir(), "planetbids-"));
  const out = join(dir, "payload.json");
  try {
    const script = process.env.PLANETBIDS_FETCH_SCRIPT || join(process.cwd(), ".github/scripts/planetbids-bids-fetch.mjs");
    await planetbidsDeps.run(script, { PLANETBIDS_CID: String(board.cid), PLANETBIDS_OUT: out });
    return mapPlanetbids(board, JSON.parse(readFileSync(out, "utf8")));
  } catch (error) {
    if (error instanceof SourceUnreachableError) throw error;
    throw new SourceUnreachableError(board.source, [(error as Error).message]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const PLANETBIDS_SOURCES: { name: string; fetchFn: () => Promise<FetchResult> }[] = PLANETBIDS_BOARDS.map((b) => ({
  name: b.source,
  fetchFn: () => fetchPlanetbidsBoard(b),
}));
