/**
 * PER-CLIENT CSV EXPORT — the pure half (Agency tier phase 3, owner decision
 * 2026-10-20: "client-ready per-client exports (CSV, reusing existing RFC-4180
 * export)"; business plan rev 370 "PHASES 2–3 QUEUED" → this is phase 3).
 *
 * WHAT IT ANSWERS. Phase 1 gave an Agency account up to ten client workspaces;
 * phase 2 showed a cross-client dashboard. Both leave a consultant holding their
 * data inside Contrax. This module turns ONE client's stored rows — its saved bids
 * (deadline + pursuit state) and its CRM contacts (relationship state) — into the
 * single file a consultant can hand to that client.
 *
 * ONE FILE, TWO RECORD KINDS. A client export is one CSV with a leading
 * "Record type" column ("Saved bid" / "CRM contact") rather than two downloads:
 * a consultant handing over a client's file should not have to explain which of
 * two attachments is which. The discriminator is a truthful label, not a made-up
 * value — every other cell is a stored field.
 *
 * EVERY COLUMN MAPS TO A REAL STORED FIELD — nothing is invented:
 *   Saved bid row   saved_matches ⋈ bids (⋈ the linked crm_contacts row)
 *     Bid title      bids.title
 *     Agency         bids.agency
 *     Location       bids.location
 *     Due date       bids.due_date                (YYYY-MM-DD)
 *     Pursuit status saved_matches.pursuit_status (migration 052)
 *     Next action    saved_matches.next_action
 *     Follow-up date saved_matches.follow_up_date
 *     Saved / added  saved_matches.created_at
 *     Source URL     bids.source_url
 *     Contact *      the linked contact (saved_matches.crm_contact_id), blank
 *                    when the bid has none
 *   CRM contact row  crm_contacts (migration 059) + its newest crm_activities row
 *     Contact name / company / role / email / phone   crm_contacts.*
 *     Notes          crm_contacts.notes
 *     Saved / added  crm_contacts.created_at
 *     Last activity  MAX(crm_activities.created_at) for that contact
 * Deliberately NOT exported because nothing stores it: there is no contact
 * "stage"/"status" column (crm_contacts has `archived_at` only, and archived
 * contacts are excluded), so no stage column is invented to fill the gap. A bid's
 * pursuit status and next action ARE stored, on saved_matches, and they are here.
 *
 * CLIENT-SAFE BY CONSTRUCTION — NO IMPORTS BUT THE WRITER, exactly like
 * src/lib/workspaces.ts and src/lib/agency-overview.ts. The database statements
 * live in src/lib/workspace-export.server.ts and the endpoint in
 * src/routes/api/workspace-export.ts.
 *
 * THIS MODULE DECIDES NOTHING ABOUT ENTITLEMENT, CAPS OR SCOPING. It renders what
 * the owner-scoped store already returned; the 10-workspace ceiling, the Agency
 * ladder and the `user_id + workspace_id` double pin stay in phase 1's modules.
 */
import { csvDocument, csvFilenameSlug, csvDateStamp } from "~/lib/csv-writer";

/** The client being exported (its own row, already owner-pinned by the store). */
export interface WorkspaceExportWorkspace {
  id: number;
  name: string;
}

/** One saved bid filed under the client. */
export interface WorkspaceExportBid {
  title: string;
  agency: string | null;
  location: string | null;
  /** `YYYY-MM-DD` from the DATE column, or null when the bid has no due date. */
  due_date: string | null;
  pursuit_status: string | null;
  next_action: string | null;
  follow_up_date: string | null;
  /** `saved_matches.created_at`, ISO-8601 (UTC). */
  saved_at: string | null;
  source_url: string | null;
  /** Name of the CRM contact this bid is linked to, or null. */
  contact_name: string | null;
}

/** One live (non-archived) CRM contact filed under the client. */
export interface WorkspaceExportContact {
  name: string;
  organization: string;
  role: string;
  email: string;
  phone: string;
  notes: string;
  /** `crm_contacts.created_at`, ISO-8601 (UTC). */
  created_at: string | null;
  /** Newest `crm_activities.created_at` for this contact, ISO-8601 (UTC), or null. */
  last_activity_at: string | null;
}

/** Everything ONE client's export contains. */
export interface WorkspaceExportBundle {
  workspace: WorkspaceExportWorkspace;
  bids: readonly WorkspaceExportBid[];
  contacts: readonly WorkspaceExportContact[];
}

/** The two record kinds, as the CSV labels them verbatim. */
export const BID_RECORD_TYPE = "Saved bid";
export const CONTACT_RECORD_TYPE = "CRM contact";

/** The header row, in the exact order `workspaceExportRow()` writes cells. */
export const WORKSPACE_EXPORT_COLUMNS: readonly string[] = [
  "Record type",
  "Bid title",
  "Agency",
  "Location",
  "Due date",
  "Pursuit status",
  "Next action",
  "Follow-up date",
  "Saved / added",
  "Source URL",
  "Contact name",
  "Contact company",
  "Contact role",
  "Contact email",
  "Contact phone",
  "Last activity",
  "Notes",
];

/** A saved bid as its cells, in WORKSPACE_EXPORT_COLUMNS order. */
export function bidExportCells(bid: WorkspaceExportBid): string[] {
  return [
    BID_RECORD_TYPE,
    bid.title,
    bid.agency ?? "",
    bid.location ?? "",
    bid.due_date ?? "",
    bid.pursuit_status ?? "",
    bid.next_action ?? "",
    bid.follow_up_date ?? "",
    bid.saved_at ?? "",
    bid.source_url ?? "",
    bid.contact_name ?? "",
    "",
    "",
    "",
    "",
    "",
    "",
  ];
}

/** A CRM contact as its cells, in WORKSPACE_EXPORT_COLUMNS order. */
export function contactExportCells(contact: WorkspaceExportContact): string[] {
  return [
    CONTACT_RECORD_TYPE,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    contact.created_at ?? "",
    "",
    contact.name,
    contact.organization,
    contact.role,
    contact.email,
    contact.phone,
    contact.last_activity_at ?? "",
    contact.notes,
  ];
}

/**
 * The complete CSV document for one client: header + every saved bid, then every
 * CRM contact, CRLF-terminated (RFC 4180) through the shipped writer. A client
 * with data but no bids (or no contacts) still exports the rows it does have; a
 * client with NOTHING exports a header-only file, which says "this client has no
 * records yet" without inventing a row. Errors never reach here — the route
 * answers 500 instead of handing over an empty file that would read as "no data".
 */
export function buildWorkspaceExportCsv(bundle: WorkspaceExportBundle): string {
  const rows: string[][] = [
    ...bundle.bids.map((bid) => bidExportCells(bid)),
    ...bundle.contacts.map((contact) => contactExportCells(contact)),
  ];
  return csvDocument(WORKSPACE_EXPORT_COLUMNS, rows);
}

/** The slug used for a client's filename (see `csvFilenameSlug` for the rules). */
export const WORKSPACE_FILENAME_FALLBACK = "client";

/**
 * `<workspace-name>-pipeline-YYYY-MM-DD.csv` — the client's own name, sanitised
 * (a workspace name is user-typed and lands in a header, so quotes/CR/LF/diacritics
 * are folded by the shared slug helper), date-stamped in UTC.
 */
export function workspaceExportFilename(name: unknown, now: Date = new Date()): string {
  const slug = csvFilenameSlug(name, WORKSPACE_FILENAME_FALLBACK);
  return `${slug}-pipeline-${csvDateStamp(now)}.csv`;
}
