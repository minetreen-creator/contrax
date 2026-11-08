/**
 * PlanetBids public "Bid Opportunities" boards (owner 2026-11-08: "add the big Ohio buyers";
 * "Yes, use a real browser"). PlanetBids refuses direct data requests from programs
 * ("DIRECT_ACCESS"), so `.github/scripts/planetbids-bids-fetch.mjs` loads the agency's public
 * portal page in a real browser (as ContraxBot, never signed in) and records the "Bidding" stage
 * bids the page itself lists. This module validates that payload and maps it to bids.
 *
 *   `oh_toledo_planetbids`: City of Toledo (company id 22576).
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
