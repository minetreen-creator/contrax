/**
 * PER-CLIENT CSV EXPORT — the pure half, pinned (Agency tier phase 3).
 *
 * No database, no network, no `mock.module`: `buildWorkspaceExportCsv` /
 * `workspaceExportFilename` are pure, and the SQL half is exercised separately by
 * src/lib/workspace-export-route.test.ts (in-memory store) and the read-only
 * production probe recorded in the PR.
 *
 * What is pinned here: the RFC-4180 rules the shipped pipeline export already uses
 * (reused through src/lib/csv-writer.ts, not re-written), the header row, that every
 * column maps to a stored field with an empty cell for a missing value, that a
 * client with no records still gets a header-only file, and that a user-typed
 * workspace name cannot break or inject into the download filename.
 */
import { describe, expect, test } from "bun:test";
import {
  BID_RECORD_TYPE,
  CONTACT_RECORD_TYPE,
  WORKSPACE_EXPORT_COLUMNS,
  buildWorkspaceExportCsv,
  workspaceExportFilename,
  type WorkspaceExportBundle,
} from "~/lib/workspace-export";
import { csvCell, csvDateStamp, csvDocument, csvFilenameSlug } from "~/lib/csv-writer";
import {
  PIPELINE_CSV_COLUMNS,
  pipelineRowValues,
  toPipelineCsv,
  type PipelineExportRow,
} from "~/lib/pipeline-export";

const NOW = new Date("2026-10-20T15:30:00.000Z");

const BID = {
  title: "Janitorial services, Building 4",
  agency: "Dept. of Veterans Affairs",
  location: "Richmond, VA",
  due_date: "2026-11-02",
  pursuit_status: "preparing",
  next_action: "Call the contracting officer",
  follow_up_date: "2026-10-28",
  saved_at: "2026-10-19T09:00:00.000Z",
  source_url: "https://sam.gov/opp/abc123/view",
  contact_name: "Dana Reyes",
};

const CONTACT = {
  name: "Dana Reyes",
  organization: "Acme Federal Services",
  role: "Contracts Manager",
  email: "dana@acme.example",
  phone: "804-555-0142",
  notes: "Prefers a call before 10am.",
  created_at: "2026-09-30T12:00:00.000Z",
  last_activity_at: "2026-10-18T16:45:00.000Z",
};

function bundle(overrides: Partial<WorkspaceExportBundle> = {}): WorkspaceExportBundle {
  return {
    workspace: { id: 7, name: "Acme Janitorial" },
    bids: [BID],
    contacts: [CONTACT],
    ...overrides,
  };
}

/** The document split into its CRLF lines, trailing terminator dropped. */
function lines(csv: string): string[] {
  expect(csv.endsWith("\r\n")).toBe(true);
  return csv.slice(0, -2).split("\r\n");
}

/**
 * A minimal quote-aware CSV cell splitter (test-only): splits one line on commas
 * that are not inside double quotes, and un-doubles inner quotes. It is used to
 * COUNT cells independently of the writer under test, so the shape check is not
 * the writer grading itself.
 */
function parseLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

describe("workspace export — the document shape", () => {
  test("header row is the exact column list, CRLF-terminated, with NO byte-order mark", () => {
    const csv = buildWorkspaceExportCsv(bundle({ bids: [], contacts: [] }));
    expect(csv).toBe(`${WORKSPACE_EXPORT_COLUMNS.join(",")}\r\n`);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    // The shipped pipeline export never emitted a BOM either — the rule is shared.
    expect(toPipelineCsv([]).charCodeAt(0)).not.toBe(0xfeff);
  });

  test("the header row is the 17 named columns, in order", () => {
    expect(WORKSPACE_EXPORT_COLUMNS).toEqual([
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
    ]);
  });

  test("every row has exactly one cell per column (no drifting shapes)", () => {
    const doc = lines(buildWorkspaceExportCsv(bundle()));
    expect(doc).toHaveLength(3); // header + bid + contact
    for (const line of doc) {
      expect(parseLine(line)).toHaveLength(WORKSPACE_EXPORT_COLUMNS.length);
    }
  });

  test("a client with NO records is a header-only file — never an empty file, never a fabricated row", () => {
    const csv = buildWorkspaceExportCsv(bundle({ bids: [], contacts: [] }));
    expect(lines(csv)).toHaveLength(1);
    expect(csv.trim()).toBe(WORKSPACE_EXPORT_COLUMNS.join(","));
  });
});

describe("workspace export — every cell is a real stored field", () => {
  test("a saved bid exports its deadline, pursuit status, next action and follow-up", () => {
    const row = lines(buildWorkspaceExportCsv(bundle({ contacts: [] })))[1]!;
    // The title's own comma makes its cell quoted (RFC 4180); every other cell is
    // the stored value verbatim, with the six contact-only cells left empty.
    expect(row).toBe(
      [
        "Saved bid",
        '"Janitorial services, Building 4"',
        "Dept. of Veterans Affairs",
        `"Richmond, VA"`, // the location's own comma quotes it too
        "2026-11-02",
        "preparing",
        "Call the contracting officer",
        "2026-10-28",
        "2026-10-19T09:00:00.000Z",
        "https://sam.gov/opp/abc123/view",
        "Dana Reyes",
        "",
        "",
        "",
        "",
        "",
        "",
      ].join(","),
    );
  });

  test("a MISSING value is the empty cell — never \"unknown\", never \"null\"", () => {
    const csv = buildWorkspaceExportCsv(
      bundle({
        contacts: [],
        bids: [
          {
            ...BID,
            agency: null,
            location: null,
            due_date: null,
            pursuit_status: null,
            next_action: null,
            follow_up_date: null,
            saved_at: null,
            source_url: null,
            contact_name: null,
          },
        ],
      }),
    );
    const row = lines(csv)[1]!;
    // 17 columns: the record type, the quoted title, then 15 empty cells.
    expect(row).toBe(`Saved bid,"Janitorial services, Building 4"${",".repeat(15)}`);
    expect(row).not.toContain("null");
    expect(row).not.toContain("unknown");
  });

  test("a CRM contact exports name, company, role, email, phone, last activity and notes", () => {
    const cells = parseLine(lines(buildWorkspaceExportCsv(bundle({ bids: [] })))[1]!);
    expect(cells).toEqual([
      CONTACT_RECORD_TYPE,
      "", // no bid fields on a contact row
      "",
      "",
      "",
      "",
      "",
      "",
      "2026-09-30T12:00:00.000Z",
      "",
      "Dana Reyes",
      "Acme Federal Services",
      "Contracts Manager",
      "dana@acme.example",
      "804-555-0142",
      "2026-10-18T16:45:00.000Z",
      "Prefers a call before 10am.",
    ]);
  });

  test("bids come first, then contacts, and both carry the right record type", () => {
    const doc = lines(buildWorkspaceExportCsv(bundle({ bids: [BID, BID] })));
    expect(doc).toHaveLength(4);
    expect(doc[1]!.startsWith(`${BID_RECORD_TYPE},`)).toBe(true);
    expect(doc[2]!.startsWith(`${BID_RECORD_TYPE},`)).toBe(true);
    expect(doc[3]!.startsWith(`${CONTACT_RECORD_TYPE},`)).toBe(true);
  });
});

describe("workspace export — RFC-4180 quoting, shared with the pipeline export", () => {
  test("commas, quotes and newlines are quoted and inner quotes doubled", () => {
    expect(csvCell('Acme, Inc.')).toBe('"Acme, Inc."');
    expect(csvCell('He said "go"')).toBe('"He said ""go"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(0)).toBe("0"); // a real zero is data, not a missing value
  });

  test("a title with a comma AND a quote survives a full round trip", () => {
    const csv = buildWorkspaceExportCsv(
      bundle({ contacts: [], bids: [{ ...BID, title: 'HVAC "phase 2", Building 4' }] }),
    );
    expect(csv).toContain('"HVAC ""phase 2"", Building 4"');
  });

  test("the shared writer is the SAME rules the pipeline export ships (no second writer)", () => {
    const row: PipelineExportRow = {
      bid_id: 12,
      title: 'Janitorial "night", 4th floor',
      agency: "GSA",
      set_aside: null,
      category: null,
      location: "VA",
      estimated_value: null,
      due_date: "2026-11-02",
      status: "saved",
      saved_at: null,
      source_url: null,
    };
    // BYTE-LEVEL pin of the shipped pipeline export, exactly as PR #455 part B wrote
    // it: header row, one row, every line CRLF-terminated, inner quotes doubled ONCE.
    const expected =
      "Bid ID,Title,Agency,Set-aside,Category,Location,Estimated value,Due date,Status,Saved at,Source URL\r\n" +
      '12,"Janitorial ""night"", 4th floor",GSA,,,VA,,2026-11-02,saved,,\r\n';
    expect(toPipelineCsv([row])).toBe(expected);
    // Rebuilding the same document through the shared writer reproduces it byte for
    // byte — proof the pipeline exporter now delegates to csv-writer.ts.
    expect(csvDocument(PIPELINE_CSV_COLUMNS, [pipelineRowValues(row)])).toBe(expected);
  });
});

describe("workspace export — the download filename", () => {
  test("is <workspace-name>-pipeline-YYYY-MM-DD.csv", () => {
    expect(workspaceExportFilename("Acme Janitorial", NOW)).toBe("acme-janitorial-pipeline-2026-10-20.csv");
  });

  test("a name with quotes / CR-LF / slashes / dots cannot break or inject a header", () => {
    const name = 'Acme"\r\nSet-Cookie: evil=1/../../etc/passwd.csv';
    const filename = workspaceExportFilename(name, NOW);
    expect(filename).toBe("acme-set-cookie-evil-1-etc-passwd-csv-pipeline-2026-10-20.csv");
    expect(filename).not.toMatch(/["\r\n/\\]/);
  });

  test("accents are folded, not dropped, and runs collapse", () => {
    expect(workspaceExportFilename("Café  &  Fils  LLC", NOW)).toBe("cafe-fils-llc-pipeline-2026-10-20.csv");
  });

  test("an unusable name falls back to a fixed slug rather than an empty segment", () => {
    for (const name of ["", "   ", "!!!", null, undefined, 42]) {
      expect(workspaceExportFilename(name, NOW)).toBe("client-pipeline-2026-10-20.csv");
    }
  });

  test("a very long name is capped so the whole filename stays short", () => {
    const slug = csvFilenameSlug("x".repeat(400), "client");
    expect(slug).toHaveLength(60);
    const filename = workspaceExportFilename("x".repeat(400), NOW);
    expect(filename.length).toBeLessThanOrEqual(60 + "-pipeline-2026-10-20.csv".length);
  });

  test("the date stamp is UTC and an unusable clock says so instead of NaN", () => {
    expect(csvDateStamp(new Date("2026-12-31T23:59:59.000Z"))).toBe("2026-12-31");
    expect(csvDateStamp(new Date("2027-01-01T00:00:00.000Z"))).toBe("2027-01-01");
    expect(workspaceExportFilename("Acme", new Date("nonsense"))).toBe("acme-pipeline-undated.csv");
  });
});
