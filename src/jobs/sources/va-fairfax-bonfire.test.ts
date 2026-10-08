/**
 * Fairfax County's own Bonfire procurement portal (`va_fairfax_bonfire`) — the
 * deterministic half of the pair, read by the SHARED reader `bonfire-public.ts`.
 *
 * DETERMINISTIC, ZERO NETWORK, NO DATABASE, NO `mock.module`. Every byte read here
 * is a VERBATIM capture of
 * `https://fairfaxcounty.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData`
 * taken 2026-10-08 01:43:58Z (two fetches, both byte-identical) — see
 * `fixtures/va-fairfax-bonfire/README.md` for provenance, byte sizes, the
 * as-fetched/committed sha256 pair and the (empty) PII-redaction record. The parse
 * is a pure function and the `closed` guard takes an INJECTED reference instant, so
 * no assertion depends on the wall clock.
 *
 * What this file pins on those real bytes: the captured listed/accepted count (7/7)
 * with zero skips · the row-by-row identity the portal itself states (project id ·
 * reference · title · close instant) · the per-tenant id prefix and the absolute
 * per-project URL on the tenant's own host · the literals `agency` / `location`
 * (never text-derived) · THIS tenant's own quirk (its department list is empty, so
 * every row falls back to the County) · NULL for every field a Bonfire public list
 * does not publish · the reader's gates (status, past close, non-competition,
 * missing fields, unreadable date) · THE TIME-ZONE RULE on the wire · the additive
 * `locationName` field changing no other tenant · the honest copy (7 quoted rows,
 * no courier/delivery claim) · and the registration nothing else in CI covers.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isStateLocalSource, NON_STATE_LOCAL_SOURCES, sourceBadgeLabel } from "~/lib/cert-matching";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import {
  bonfireAgencyName,
  bonfireCloseMs,
  parseBonfire,
  type BonfireConfig,
  type BonfirePayload,
} from "./bonfire-public";
import { TX_TXDOT_BONFIRE_CONFIG } from "./tx-txdot-bonfire";
import { UT_BONFIRE_CONFIG } from "./ut-bonfire";
import {
  fetchVaFairfaxBonfireBids,
  parseVaFairfaxBonfire,
  VA_FAIRFAX_AGENCY,
  VA_FAIRFAX_BONFIRE_COPY,
  VA_FAIRFAX_CAPTURED_OPEN_ROWS_2026_10_08,
  VA_FAIRFAX_ID_PREFIX,
  VA_FAIRFAX_LOCATION,
  VA_FAIRFAX_BONFIRE_SOURCE,
} from "./va-fairfax-bonfire";

const DIR = new URL("./fixtures/va-fairfax-bonfire/", import.meta.url);
const rawBody = (name: string) => readFileSync(new URL(name, DIR), "utf8");
const body1 = rawBody("open-opportunities-2026-10-08-fetch1.json");
const body2 = rawBody("open-opportunities-2026-10-08-fetch2.json");
const FAIRFAX: BonfirePayload = JSON.parse(body1).payload;
/** The capture instant — before EVERY close date in the fixture (earliest is 15:00Z). */
const REF_NOW = Date.parse("2026-10-08T01:43:58Z");
const B = VA_FAIRFAX_ID_PREFIX;

/** The portal's own 7 open rows, verbatim from the saved bytes. */
const EXPECTED = [
  { id: "252833", ref: "RFP 2000004251 - DRAFT", title: "Psychological Evaluation & Testing Services", utc: "2026-10-08T18:00:00.000Z", cat: "Other" },
  { id: "253098", ref: "RFP 2000004251", title: "Psychological Evaluation & Testing Services", utc: "2026-10-16T18:00:00.000Z", cat: "Other" },
  { id: "254550", ref: "IFB 2000004412", title: "Chemicals & Sand for Ice and Snow Removal", utc: "2026-10-08T15:00:00.000Z", cat: "Other" },
  { id: "255790", ref: "RFP 2000004461", title: "Electrical and Emergency Power Systems Installation and/or Replacement", utc: "2026-10-16T15:00:00.000Z", cat: "Plumbing & Electrical" },
  { id: "256205", ref: "IFB 2000004476", title: "Automatic Gates", utc: "2026-10-28T15:00:00.000Z", cat: "Other" },
  { id: "256548", ref: "IFB 2000004473", title: "Snow and Ice Removal Services - Zones 3 and 4", utc: "2026-10-15T15:00:00.000Z", cat: "Other" },
  { id: "257005", ref: "CSAFY2027 - Quarter 2", title: "CSA Open Application Period FY2027- Quarter 2", utc: "2027-01-01T04:30:00.000Z", cat: "Other" },
];

describe("va_fairfax_bonfire — the captured portal response parses to the rows it listed", () => {
  test("7 listed, 7 accepted, zero skips — nothing dropped and nothing invented", () => {
    expect(Object.keys(FAIRFAX.projects).length).toBe(VA_FAIRFAX_CAPTURED_OPEN_ROWS_2026_10_08);
    expect(Object.keys(FAIRFAX.projects).length).toBe(7);
    const { rows, skipped, skippedRows } = parseVaFairfaxBonfire(FAIRFAX, REF_NOW);
    expect(skipped).toEqual({});
    expect(skippedRows).toEqual([]);
    expect(rows.length).toBe(7);
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(7);
    // The tenant's own section really is the open-only list (status "2" on every row).
    for (const p of Object.values(FAIRFAX.projects)) expect(String(p.ProjectStatusID)).toBe("2");
  });

  test("every row matches the portal row-for-row (id · reference · title · close · category)", () => {
    const { rows } = parseVaFairfaxBonfire(FAIRFAX, REF_NOW);
    const byId = new Map(rows.map((r) => [r.external_id, r]));
    expect([...byId.keys()].sort()).toEqual(EXPECTED.map((e) => `${B}-${e.id}`).sort());
    for (const e of EXPECTED) {
      const row = byId.get(`${B}-${e.id}`)!;
      expect(row).toBeDefined();
      expect(row.title).toBe(e.title);
      expect(row.solicitation_number).toBe(e.ref);
      expect(row.due_date).toBe(e.utc);
      expect(row.category).toBe(e.cat);
      expect(Date.parse(row.due_date!)).toBeGreaterThan(REF_NOW);
    }
  });

  test("the stability pair (fetch 1 vs fetch 2) is byte-identical AND gives an identical fingerprint", () => {
    // This tenant's body carries nothing per-request (no session id, no viewstate),
    // so the two captures are byte-identical — a stronger fact than a matching
    // fingerprint, and it is asserted here rather than assumed.
    expect(body2).toBe(body1);
    const fp = (raw: string) =>
      JSON.stringify(
        parseVaFairfaxBonfire(JSON.parse(raw).payload as BonfirePayload, REF_NOW).rows.map((r) => [
          r.external_id,
          r.title,
          r.due_date,
          r.category,
        ]),
      );
    expect(fp(body1)).toBe(fp(body2));
  });

  test("agency / location are the portal's own literals, never text-derived", () => {
    for (const row of parseVaFairfaxBonfire(FAIRFAX, REF_NOW).rows) {
      // THIS tenant publishes no department names (departments: []), so every row
      // falls back to the config's own buyer name — no department code is expanded.
      expect(row.agency).toBe(VA_FAIRFAX_AGENCY);
      expect(row.agency).toBe("Fairfax County");
      expect(row.location).toBe(VA_FAIRFAX_LOCATION);
      expect(row.location).toBe("Fairfax County, VA");
      expect(row.estimated_value).toBe("Not specified");
      // Nothing a Bonfire public list does not publish is invented (ruling f).
      expect(row.set_aside).toBeNull();
      expect(row.naics_code).toBeNull();
      expect(row.psc).toBeNull();
      expect(row.notice_type).toBeNull();
    }
    expect(Object.keys(FAIRFAX.departments ?? {}).length).toBe(0);
  });

  test("ids are prefixed per tenant and every link is the absolute per-project page", () => {
    for (const row of parseVaFairfaxBonfire(FAIRFAX, REF_NOW).rows) {
      expect(row.external_id.startsWith(`${VA_FAIRFAX_ID_PREFIX}-`)).toBe(true);
      expect(row.external_id).toMatch(/^fairfaxbonfire-\d+$/);
      expect(row.source_url).toBe(
        `https://fairfaxcounty.bonfirehub.com/opportunities/${row.external_id.slice(B.length + 1)}`,
      );
      expect(row.source_url!.startsWith("https://fairfaxcounty.bonfirehub.com/opportunities/")).toBe(true);
    }
  });

  test("one row reads exactly as the portal states it (the full description is pinned)", () => {
    const r = parseVaFairfaxBonfire(FAIRFAX, REF_NOW).rows.find((x) => x.external_id === `${B}-256205`)!;
    expect(r.title).toBe("Automatic Gates");
    expect(r.solicitation_number).toBe("IFB 2000004476");
    expect(r.description).toBe(
      "Virginia public procurement opportunity IFB 2000004476 posted by Fairfax County on the " +
        "Fairfax County Procurement Portal (Bonfire). Documents and responses through the Bonfire " +
        "portal (free vendor account; see source link).",
    );
  });
});

describe("va_fairfax_bonfire — the reader's gates are this tenant's too (never loosened)", () => {
  const base = FAIRFAX.projects["256205"]!;
  const one = (over: Partial<typeof base>, now = REF_NOW) =>
    parseVaFairfaxBonfire({ projects: { a: { ...base, ...over } }, departments: FAIRFAX.departments }, now);

  test("a non-open status, a passed close date, a non-competition notice and a nameless row are skipped", () => {
    expect(one({ ProjectStatusID: "3" }).skipped).toEqual({ not_open: 1 });
    expect(one({ ProjectStatusID: null }).skipped).toEqual({ not_open: 1 });
    expect(one({}, Date.parse("2026-10-29T00:00:00Z")).skipped).toEqual({ closed: 1 });
    expect(one({ ProjectName: "Contract 256230 Amendment 4 request to increase funding" }).skipped).toEqual({
      not_competitive: 1,
    });
    expect(
      one({ ProjectName: "Notice of Intent to Award Without Engaging in a Standard Procurement Process - X" }).skipped,
    ).toEqual({ not_competitive: 1 });
    expect(one({ ProjectName: "   " }).skipped).toEqual({ missing_fields: 1 });
  });

  test("an unreadable close date is `bad_date`, never a guessed instant", () => {
    for (const bad of ["2026-10-06 17:00", "2026-10-06T17:00:00Z", "", null]) {
      expect(one({ DateClose: bad } as Partial<typeof base>).skipped).toEqual({ bad_date: 1 });
      expect(one({ DateClose: bad } as Partial<typeof base>).rows).toEqual([]);
    }
  });

  test("a row whose department names nothing falls back to the County (this tenant has none)", () => {
    expect(bonfireAgencyName(null, "Fairfax County")).toBe("Fairfax County");
    expect(bonfireAgencyName("  ", "Fairfax County")).toBe("Fairfax County");
    expect(one({ DepartmentID: "2014" }).rows[0]!.agency).toBe("Fairfax County");
  });
});

describe("va_fairfax_bonfire — THE TIME-ZONE RULE holds on the wire (pinned)", () => {
  test("DateClose is the stored UTC instant, never shifted into the tenant's display zone", () => {
    // The tenant's own page sets `var timezone = "America/Toronto"` for DISPLAY only.
    // Reading the stored value as Toronto-local (UTC−4 in October) would give 19:00Z.
    expect(bonfireCloseMs("2026-10-08 15:00:00")).toBe(Date.parse("2026-10-08T15:00:00Z"));
    expect(bonfireCloseMs("2026-10-08 15:00:00")).not.toBe(Date.parse("2026-10-08T19:00:00Z"));
    // Every emitted due_date is exactly the raw DateClose read as UTC.
    const byId = new Map(parseVaFairfaxBonfire(FAIRFAX, REF_NOW).rows.map((r) => [r.external_id, r]));
    let checked = 0;
    for (const p of Object.values(FAIRFAX.projects)) {
      const row = byId.get(`${B}-${p.ProjectID}`);
      if (!row) continue;
      expect(String(p.DateClose)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(row.due_date).toBe(new Date(bonfireCloseMs(p.DateClose)).toISOString());
      checked++;
    }
    expect(checked).toBe(7);
  });
});

describe("Bonfire reader — the additive `locationName` field changes no other tenant", () => {
  test("a config without it keeps stating its state name as the location", () => {
    const bare: BonfireConfig = {
      source: "va_bare_probe",
      host: "https://example.bonfirehub.com",
      idPrefix: "bareprobe",
      stateName: "Virginia",
      buyerName: "X",
      portalName: "the X portal",
      agencyName: (dept) => bonfireAgencyName(dept, "X"),
    };
    expect(parseBonfire(bare, FAIRFAX, REF_NOW).rows.map((r) => r.location)).toEqual(Array(7).fill("Virginia"));
  });

  test("every pre-existing tenant omits it, so its rows are unchanged", () => {
    for (const cfg of [UT_BONFIRE_CONFIG, TX_TXDOT_BONFIRE_CONFIG]) {
      expect(cfg.locationName).toBeUndefined();
    }
  });
});

describe("va_fairfax_bonfire — copy (count quoted from the capture, no trade/coverage claim)", () => {
  test("the publisher line names the County and the badge is the place", () => {
    expect(VA_FAIRFAX_BONFIRE_COPY.publisherLine).toContain("Fairfax County");
    expect(VA_FAIRFAX_BONFIRE_COPY.badge).toBe("Fairfax County");
    expect(sourceBadgeLabel(VA_FAIRFAX_BONFIRE_SOURCE)).toBe(VA_FAIRFAX_BONFIRE_COPY.badge);
  });

  test("the honest copy defines the open set and disclaims coverage", () => {
    expect(VA_FAIRFAX_BONFIRE_COPY.openSetDefinition).toContain("close date that has not passed");
    expect(VA_FAIRFAX_BONFIRE_COPY.noClaimsLine).toContain("does not warrant");
    expect(VA_FAIRFAX_BONFIRE_COPY.noClaimsLine).toContain("official source");
    expect(VA_FAIRFAX_BONFIRE_COPY.timeZoneNote).toContain("UTC");
    // The tenant publishes no department names — the copy says so instead of guessing.
    expect(VA_FAIRFAX_BONFIRE_COPY.buyerMixNote).toContain("NO department names");
    expect(VA_FAIRFAX_BONFIRE_COPY.captureNote).toContain("no claim about which trades");
  });

  test("the capture note quotes the live count, and the capture really has no courier/delivery row", () => {
    expect(VA_FAIRFAX_BONFIRE_COPY.captureNote).toContain("7 solicitations");
    const rows = parseVaFairfaxBonfire(FAIRFAX, REF_NOW).rows;
    expect(rows.length).toBe(VA_FAIRFAX_CAPTURED_OPEN_ROWS_2026_10_08);
    // The probe's honest finding (0 delivery/courier rows on this portal) is held by
    // the fixture itself: no title the portal listed names this trade.
    for (const r of rows) {
      expect(r.title).not.toMatch(/courier|freight|trucking|messenger|\bLTL\b|parcel|hauling|delivery/i);
    }
    expect(rows.map((r) => r.category)).not.toContain("Transportation");
    expect(rows.map((r) => r.category)).not.toContain("Janitorial");
  });
});

describe("va_fairfax_bonfire — registration (tail source · class map · VA home · LOCAL badge)", () => {
  test("the runner carries it as a tail source with this connector's fetch, and no label repeats", () => {
    const entry = TAIL_SOURCES.find((s) => s.name === VA_FAIRFAX_BONFIRE_SOURCE);
    expect(entry).toBeDefined();
    expect(entry!.fetchFn).toBe(fetchVaFairfaxBonfireBids);
    expect(new Set(TAIL_SOURCES.map((s) => s.name)).size).toBe(TAIL_SOURCES.length);
  });

  test("the class map marks it LOCAL with the Fairfax County badge and a VA scope", () => {
    expect(SOURCE_CLASSES[VA_FAIRFAX_BONFIRE_SOURCE]).toEqual({
      class: "local",
      city: "Fairfax County",
      scopeState: "VA",
      searchScope: "city-open-data",
      recordType: "opportunity",
    });
  });

  test("the home jurisdiction is VA by construction (not text-derived)", () => {
    expect(SOURCE_HOME_JURISDICTIONS[VA_FAIRFAX_BONFIRE_SOURCE]).toBe("VA");
    const cols = deriveInsertLocationColumns({
      location: "Fairfax County, VA",
      agency: "Fairfax County",
      title: "Snow and Ice Removal Services - Zones 3 and 4",
      description: "Bids are due October 15, 2026.",
      sourceName: VA_FAIRFAX_BONFIRE_SOURCE,
    });
    expect(cols.source_jurisdiction).toBe("VA");
    expect(cols.location_conflict).toBe(false);
  });

  test("a new local source needs no cert-matching change and is NOT relabelled Federal", () => {
    expect(NON_STATE_LOCAL_SOURCES.has(VA_FAIRFAX_BONFIRE_SOURCE)).toBe(false);
    expect(isStateLocalSource([VA_FAIRFAX_BONFIRE_SOURCE])).toBe(true);
    expect(sourceBadgeLabel(VA_FAIRFAX_BONFIRE_SOURCE)).toBe("Fairfax County");
  });
});
