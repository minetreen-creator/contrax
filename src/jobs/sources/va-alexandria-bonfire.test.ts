/**
 * The City of Alexandria's own Bonfire procurement portal
 * (`va_alexandria_bonfire`) — the deterministic half of the pair, read by the
 * SHARED reader `bonfire-public.ts`.
 *
 * DETERMINISTIC, ZERO NETWORK, NO DATABASE, NO `mock.module`. Every byte read here
 * is a VERBATIM capture of
 * `https://alexandriava.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData`
 * taken 2026-10-08 01:43:58Z (two fetches, both byte-identical) — see
 * `fixtures/va-alexandria-bonfire/README.md` for provenance, byte sizes, the
 * as-fetched/committed sha256 pair and the (empty) PII-redaction record. The parse
 * is a pure function and the `closed` guard takes an INJECTED reference instant, so
 * no assertion depends on the wall clock.
 *
 * What this file pins on those real bytes: the captured listed/accepted count (3/3)
 * with zero skips · the row-by-row identity the portal itself states · the tenant's
 * department labels kept VERBATIM as `agency` (this portal publishes them, unlike
 * the Fairfax tenant) · the per-tenant id prefix and the absolute per-project URL ·
 * the literals `agency` fallback / `location` (never text-derived) · NULL for every
 * field a Bonfire public list does not publish · the reader's gates · THE
 * TIME-ZONE RULE on the wire · the honest copy (3 quoted rows, no coverage claim,
 * and the DOT-paratransit row stated as the source states it) · and the
 * registration nothing else in CI covers.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isStateLocalSource, NON_STATE_LOCAL_SOURCES, sourceBadgeLabel } from "~/lib/cert-matching";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import { bonfireAgencyName, bonfireCloseMs, type BonfirePayload } from "./bonfire-public";
import {
  fetchVaAlexandriaBonfireBids,
  parseVaAlexandriaBonfire,
  VA_ALEXANDRIA_AGENCY,
  VA_ALEXANDRIA_BONFIRE_COPY,
  VA_ALEXANDRIA_CAPTURED_OPEN_ROWS_2026_10_08,
  VA_ALEXANDRIA_ID_PREFIX,
  VA_ALEXANDRIA_LOCATION,
  VA_ALEXANDRIA_BONFIRE_SOURCE,
} from "./va-alexandria-bonfire";
import { VA_FAIRFAX_BONFIRE_CONFIG } from "./va-fairfax-bonfire";

const DIR = new URL("./fixtures/va-alexandria-bonfire/", import.meta.url);
const rawBody = (name: string) => readFileSync(new URL(name, DIR), "utf8");
const body1 = rawBody("open-opportunities-2026-10-08-fetch1.json");
const body2 = rawBody("open-opportunities-2026-10-08-fetch2.json");
const ALEXANDRIA: BonfirePayload = JSON.parse(body1).payload;
/** The capture instant — before EVERY close date in the fixture (earliest is 15 Oct). */
const REF_NOW = Date.parse("2026-10-08T01:43:58Z");
const B = VA_ALEXANDRIA_ID_PREFIX;

/** The portal's own 3 open rows, verbatim from the saved bytes. */
const EXPECTED = [
  {
    id: "231851",
    ref: "2009",
    title: "Computer-Aided Dispatch / Automatic Vehicle Location (CAD/AVL) System Replacement",
    dept: "46 - Transit Services (DASH)",
    utc: "2026-10-15T20:00:00.000Z",
    cat: "Other",
  },
  {
    id: "250710",
    ref: "2036",
    title: "Durant Roof Replacement",
    dept: "34 - General Services",
    utc: "2026-10-21T18:00:00.000Z",
    cat: "Other",
  },
  {
    id: "251367",
    ref: "2037",
    title: "Transportation Services for the DOT Paratransit Program and City Programs",
    dept: "41 - Transportation and Environmental Services (TES/DPI)",
    utc: "2026-10-15T20:00:00.000Z",
    cat: "Transportation",
  },
];

describe("va_alexandria_bonfire — the captured portal response parses to the rows it listed", () => {
  test("3 listed, 3 accepted, zero skips — nothing dropped and nothing invented", () => {
    expect(Object.keys(ALEXANDRIA.projects).length).toBe(VA_ALEXANDRIA_CAPTURED_OPEN_ROWS_2026_10_08);
    expect(Object.keys(ALEXANDRIA.projects).length).toBe(3);
    const { rows, skipped, skippedRows } = parseVaAlexandriaBonfire(ALEXANDRIA, REF_NOW);
    expect(skipped).toEqual({});
    expect(skippedRows).toEqual([]);
    expect(rows.length).toBe(3);
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(3);
    for (const p of Object.values(ALEXANDRIA.projects)) expect(String(p.ProjectStatusID)).toBe("2");
  });

  test("every row matches the portal row-for-row (id · reference · title · department · close)", () => {
    const { rows } = parseVaAlexandriaBonfire(ALEXANDRIA, REF_NOW);
    const byId = new Map(rows.map((r) => [r.external_id, r]));
    expect([...byId.keys()].sort()).toEqual(EXPECTED.map((e) => `${B}-${e.id}`).sort());
    for (const e of EXPECTED) {
      const row = byId.get(`${B}-${e.id}`)!;
      expect(row).toBeDefined();
      expect(row.title).toBe(e.title);
      expect(row.solicitation_number).toBe(e.ref);
      expect(row.agency).toBe(e.dept);
      expect(row.due_date).toBe(e.utc);
      expect(row.category).toBe(e.cat);
      expect(Date.parse(row.due_date!)).toBeGreaterThan(REF_NOW);
    }
  });

  test("the department labels are the portal's own, kept verbatim — never expanded or shortened", () => {
    const agencies = [...new Set(parseVaAlexandriaBonfire(ALEXANDRIA, REF_NOW).rows.map((r) => r.agency))].sort();
    expect(agencies).toEqual([
      "34 - General Services",
      "41 - Transportation and Environmental Services (TES/DPI)",
      "46 - Transit Services (DASH)",
    ]);
    // The tenant DOES publish departments here — the opposite of the Fairfax tenant,
    // and both facts are read, not assumed.
    expect(Object.keys(ALEXANDRIA.departments ?? {}).length).toBe(3);
  });

  test("THE TRADE ROW the probe found is the portal's own text (quoted, no embellishment)", () => {
    const r = parseVaAlexandriaBonfire(ALEXANDRIA, REF_NOW).rows.find((x) => x.external_id === `${B}-251367`)!;
    expect(r.title).toBe("Transportation Services for the DOT Paratransit Program and City Programs");
    expect(r.solicitation_number).toBe("2037");
    expect(r.due_date).toBe("2026-10-15T20:00:00.000Z");
    expect(r.agency).toBe("41 - Transportation and Environmental Services (TES/DPI)");
    expect(r.category).toBe("Transportation");
    expect(r.description).toBe(
      "Virginia public procurement opportunity 2037 posted by 41 - Transportation and Environmental " +
        "Services (TES/DPI) on the City of Alexandria Procurement Portal (Bonfire). Documents and " +
        "responses through the Bonfire portal (free vendor account; see source link).",
    );
  });

  test("the stability pair (fetch 1 vs fetch 2) is byte-identical AND gives an identical fingerprint", () => {
    expect(body2).toBe(body1);
    const fp = (raw: string) =>
      JSON.stringify(
        parseVaAlexandriaBonfire(JSON.parse(raw).payload as BonfirePayload, REF_NOW).rows.map((r) => [
          r.external_id,
          r.title,
          r.due_date,
          r.category,
        ]),
      );
    expect(fp(body1)).toBe(fp(body2));
  });

  test("the literals: the City's place, the config's fallback buyer, NULL for everything unpublished", () => {
    for (const row of parseVaAlexandriaBonfire(ALEXANDRIA, REF_NOW).rows) {
      expect(row.location).toBe(VA_ALEXANDRIA_LOCATION);
      expect(row.location).toBe("City of Alexandria, VA");
      expect(row.estimated_value).toBe("Not specified");
      expect(row.set_aside).toBeNull();
      expect(row.naics_code).toBeNull();
      expect(row.psc).toBeNull();
      expect(row.notice_type).toBeNull();
    }
    // The fallback exists for a posting whose department names none; it is the
    // publisher's own name, verbatim from the portal's page title.
    expect(VA_ALEXANDRIA_AGENCY).toBe("City of Alexandria, VA");
    expect(bonfireAgencyName(null, VA_ALEXANDRIA_AGENCY)).toBe("City of Alexandria, VA");
  });

  test("ids are prefixed per tenant and every link is the absolute per-project page", () => {
    for (const row of parseVaAlexandriaBonfire(ALEXANDRIA, REF_NOW).rows) {
      expect(row.external_id.startsWith(`${VA_ALEXANDRIA_ID_PREFIX}-`)).toBe(true);
      expect(row.external_id).toMatch(/^alexandriabonfire-\d+$/);
      expect(row.source_url).toBe(
        `https://alexandriava.bonfirehub.com/opportunities/${row.external_id.slice(B.length + 1)}`,
      );
    }
  });

  test("no external_id can collide with the Fairfax tenant (per-tenant prefixes over one id space)", () => {
    expect(VA_ALEXANDRIA_ID_PREFIX).not.toBe(VA_FAIRFAX_BONFIRE_CONFIG.idPrefix);
    expect(`${VA_ALEXANDRIA_ID_PREFIX}-1`).not.toBe(`${VA_FAIRFAX_BONFIRE_CONFIG.idPrefix}-1`);
  });
});

describe("va_alexandria_bonfire — the reader's gates are this tenant's too (never loosened)", () => {
  const base = ALEXANDRIA.projects["250710"]!;
  const one = (over: Partial<typeof base>, now = REF_NOW) =>
    parseVaAlexandriaBonfire({ projects: { a: { ...base, ...over } }, departments: ALEXANDRIA.departments }, now);

  test("a non-open status, a passed close date, a non-competition notice and a nameless row are skipped", () => {
    expect(one({ ProjectStatusID: "3" }).skipped).toEqual({ not_open: 1 });
    expect(one({}, Date.parse("2026-10-22T00:00:00Z")).skipped).toEqual({ closed: 1 });
    expect(one({ ProjectName: "Contract 250710 Amendment 2 request to extend the term" }).skipped).toEqual({
      not_competitive: 1,
    });
    expect(one({ ProjectName: "Notice of Intent to Award Without Engaging in a Standard Procurement Process" }).skipped).toEqual(
      { not_competitive: 1 },
    );
    expect(one({ ProjectName: "" }).skipped).toEqual({ missing_fields: 1 });
  });

  test("an unreadable close date is `bad_date`, never a guessed instant", () => {
    expect(one({ DateClose: "2026-10-21" }).skipped).toEqual({ bad_date: 1 });
    expect(one({ DateClose: "2026-10-21T18:00:00Z" }).skipped).toEqual({ bad_date: 1 });
    expect(one({ DateClose: null }).skipped).toEqual({ bad_date: 1 });
  });

  test("a department id the tenant does not name falls back to the City, not to a code", () => {
    expect(one({ DepartmentID: "999999" }).rows[0]!.agency).toBe(VA_ALEXANDRIA_AGENCY);
  });
});

describe("va_alexandria_bonfire — THE TIME-ZONE RULE holds on the wire (pinned)", () => {
  test("DateClose is the stored UTC instant, never shifted into America/New_York", () => {
    // The tenant's own page sets `var timezone = "America/New_York"` for DISPLAY only.
    // Reading the stored value as Eastern-local (UTC−4 in October) would give 00:00Z
    // on the 16th — a whole day's shift on the deadline.
    expect(bonfireCloseMs("2026-10-15 20:00:00")).toBe(Date.parse("2026-10-15T20:00:00Z"));
    expect(bonfireCloseMs("2026-10-15 20:00:00")).not.toBe(Date.parse("2026-10-16T00:00:00Z"));
    const byId = new Map(parseVaAlexandriaBonfire(ALEXANDRIA, REF_NOW).rows.map((r) => [r.external_id, r]));
    let checked = 0;
    for (const p of Object.values(ALEXANDRIA.projects)) {
      const row = byId.get(`${B}-${p.ProjectID}`);
      if (!row) continue;
      expect(String(p.DateClose)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(row.due_date).toBe(new Date(bonfireCloseMs(p.DateClose)).toISOString());
      checked++;
    }
    expect(checked).toBe(3);
  });
});

describe("va_alexandria_bonfire — copy (count quoted from the capture, no coverage claim)", () => {
  test("the publisher line names the City and the badge is the place", () => {
    expect(VA_ALEXANDRIA_BONFIRE_COPY.publisherLine).toContain("City of Alexandria");
    expect(VA_ALEXANDRIA_BONFIRE_COPY.badge).toBe("Alexandria");
    expect(sourceBadgeLabel(VA_ALEXANDRIA_BONFIRE_SOURCE)).toBe(VA_ALEXANDRIA_BONFIRE_COPY.badge);
  });

  test("the honest copy defines the open set and disclaims coverage", () => {
    expect(VA_ALEXANDRIA_BONFIRE_COPY.openSetDefinition).toContain("close date that has not passed");
    expect(VA_ALEXANDRIA_BONFIRE_COPY.noClaimsLine).toContain("does not warrant");
    expect(VA_ALEXANDRIA_BONFIRE_COPY.noClaimsLine).toContain("official source");
    expect(VA_ALEXANDRIA_BONFIRE_COPY.timeZoneNote).toContain("UTC");
    expect(VA_ALEXANDRIA_BONFIRE_COPY.captureNote).toContain("no claim about which trades");
  });

  test("the capture note quotes the live count row by row, including the transportation solicitation", () => {
    expect(VA_ALEXANDRIA_BONFIRE_COPY.captureNote).toContain("3 solicitations");
    expect(VA_ALEXANDRIA_BONFIRE_COPY.captureNote).toContain(
      "Transportation Services for the DOT Paratransit Program and City Programs",
    );
    const rows = parseVaAlexandriaBonfire(ALEXANDRIA, REF_NOW).rows;
    expect(rows.length).toBe(VA_ALEXANDRIA_CAPTURED_OPEN_ROWS_2026_10_08);
    // The copy lists exactly the titles the capture carried — nothing summarised away.
    for (const r of rows) expect(VA_ALEXANDRIA_BONFIRE_COPY.captureNote).toContain(r.title);
  });
});

describe("va_alexandria_bonfire — registration (tail source · class map · VA home · LOCAL badge)", () => {
  test("the runner carries it as a tail source with this connector's fetch, and no label repeats", () => {
    const entry = TAIL_SOURCES.find((s) => s.name === VA_ALEXANDRIA_BONFIRE_SOURCE);
    expect(entry).toBeDefined();
    expect(entry!.fetchFn).toBe(fetchVaAlexandriaBonfireBids);
    expect(new Set(TAIL_SOURCES.map((s) => s.name)).size).toBe(TAIL_SOURCES.length);
  });

  test("the class map marks it LOCAL with the Alexandria badge and a VA scope", () => {
    expect(SOURCE_CLASSES[VA_ALEXANDRIA_BONFIRE_SOURCE]).toEqual({
      class: "local",
      city: "Alexandria",
      scopeState: "VA",
      searchScope: "city-open-data",
      recordType: "opportunity",
    });
  });

  test("the home jurisdiction is VA by construction (not text-derived)", () => {
    expect(SOURCE_HOME_JURISDICTIONS[VA_ALEXANDRIA_BONFIRE_SOURCE]).toBe("VA");
    const cols = deriveInsertLocationColumns({
      location: "City of Alexandria, VA",
      agency: "41 - Transportation and Environmental Services (TES/DPI)",
      title: "Transportation Services for the DOT Paratransit Program and City Programs",
      description: "Proposals are due October 15, 2026.",
      sourceName: VA_ALEXANDRIA_BONFIRE_SOURCE,
    });
    expect(cols.source_jurisdiction).toBe("VA");
    expect(cols.location_conflict).toBe(false);
  });

  test("a new local source needs no cert-matching change and is NOT relabelled Federal", () => {
    expect(NON_STATE_LOCAL_SOURCES.has(VA_ALEXANDRIA_BONFIRE_SOURCE)).toBe(false);
    expect(isStateLocalSource([VA_ALEXANDRIA_BONFIRE_SOURCE])).toBe(true);
    expect(sourceBadgeLabel(VA_ALEXANDRIA_BONFIRE_SOURCE)).toBe("Alexandria");
  });
});
