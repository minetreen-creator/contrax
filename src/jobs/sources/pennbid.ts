/**
 * PennBid Procurement Source (owner 09-13 coverage repair: Pennsylvania freight).
 *
 * PennBid is the Pennsylvania local-government solicitation portal, hosted on
 * Bonfire's public portal platform at pennbid.bonfirehub.com. The public
 * "Open Opportunities" tab loads from one JSON endpoint (no key, no auth):
 *
 *   GET https://pennbid.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData
 *
 * Response shape (verified live 2026-09-13): { success, payload: { projects:
 * { "<ProjectID>": { ProjectID, PrivateProjectID, ReferenceID, ProjectName,
 * DateClose, DepartmentID, ... } }, departments: { ... } } }.
 *
 * DATA HONESTY (owner rules — never manufacture, relabel, or loosen):
 *   - Every field is taken verbatim from the portal JSON; nothing is invented.
 *   - PennBid is a state/local portal for Pennsylvania agencies: `location` is
 *     set to the STATE-level place ("Pennsylvania") — true for every project
 *     (the portal itself is the Pennsylvania program), and `agency` carries the
 *     buyer's own ReferenceID (e.g. "Bucks County, PA") so the viewer sees the
 *     real issuer, not a fabricated hierarchy.
 *   - PennBid lists do NOT expose NAICS codes or federal set-aside codes, so
 *     those fields are left unset (NULL) — the row is NOT relabeled as a
 *     set-aside, and NAICS inference is left to the standard pipeline with
 *     naics_code_source='inferred' provenance.
 *   - `source_url` points at the public portal opportunity page (deduplicated
 *     by ProjectID via external_id = "pennbid-<ProjectID>").
 *   - Future-dated DateClose rows are the "open" set (the portal endpoint is
 *     already the OPEN list; the due-date guard is defensive against a project
 *     closing between fetch and insert).
 */

export interface PennBidProject {
  ProjectID: string;
  PrivateProjectID?: string;
  ReferenceID?: string;
  ProjectStatusID?: string;
  ProjectSubStatusID?: string;
  ProjectName?: string;
  DateClose?: string | null;
  DepartmentID?: string;
}

const ENDPOINT =
  "https://pennbid.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://pennbid.bonfirehub.com/portal/?tab=openOpportunities",
};

/** Parse "2026-09-14 15:30:00" (portal local time, no tz suffix) into an ISO
 *  date string usable by Postgres. Missing/unparseable → null (never guessed). */
function parseCloseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}.000Z`;
}

export async function fetchPennBidOpen(): Promise<
  Array<{
    external_id: string;
    title: string;
    agency: string;
    description: string;
    location: string;
    category: string;
    due_date: string | null;
    estimated_value: string;
    source_url: string;
  }>
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let resp: Response;
  try {
    resp = await fetch(ENDPOINT, { headers: HEADERS, signal: controller.signal });
  } catch (e) {
    console.error(`  pennbid: fetch failed:`, (e as Error).message);
    return [];
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    console.error(`  pennbid: HTTP ${resp.status}`);
    return [];
  }

  const data = await resp.json();
  const projects: Record<string, PennBidProject> =
    data?.payload?.projects ?? {};
  const rows: Array<{
    external_id: string;
    title: string;
    agency: string;
    description: string;
    location: string;
    category: string;
    due_date: string | null;
    estimated_value: string;
    source_url: string;
  }> = [];

  for (const proj of Object.values(projects)) {
    try {
      const projectId = String(proj.ProjectID ?? "").trim();
      if (!projectId) continue;
      const title = String(proj.ProjectName ?? "").trim();
      if (!title) continue;
      // Data honesty: never emit a row whose agency cannot be attributed — the
      // buyer's ReferenceID is the only agency reference this portal carries.
      // A project without one is SKIPPED (never a fabricated or empty agency).
      const agency = String(proj.ReferenceID ?? "").trim();
      if (!agency) continue;

      const due = parseCloseDate(proj.DateClose);
      // Defensive: the endpoint is the OPEN list; never insert a row that is
      // already closed (between fetch and insert).
      if (due && Date.parse(due) < Date.now()) continue;

      // One-line honest description — we do NOT invent scope detail the portal
      // JSON does not carry. The full solicitation lives at the source URL.
      const description = `Open PennBid solicitation issued by ${agency || "a Pennsylvania agency"}. Full details and documents are on the PennBid portal (see source link).`;

      const full = `${title} ${description}`.toLowerCase();
      let category = "Other";
      if (/(haul|freight|truck|transport|deliver)/.test(full)) category = "Transportation";
      else if (/(janitor|custodial|cleaning)/.test(full)) category = "Janitorial";
      else if (/(construct|renovat|demolit|pav|road|bridge)/.test(full)) category = "Construction";
      else if (/(supply|materiel|material|equipment)/.test(full)) category = "Supplies & Equipment";

      rows.push({
        external_id: `pennbid-${projectId}`,
        title,
        agency,
        description,
        // The portal is the Pennsylvania local-government program — state-level
        // place is true for every project, never a guess.
        location: "Pennsylvania",
        category,
        due_date: due,
        estimated_value: "Not specified",
        source_url: `https://pennbid.bonfirehub.com/portal/?tab=openOpportunities&projectID=${projectId}`,
      });
    } catch (e) {
      console.error(`  pennbid: error parsing project:`, (e as Error).message);
    }
  }

  console.log(`  pennbid: got ${rows.length} open projects from Pennsylvania portal`);
  return rows;
}