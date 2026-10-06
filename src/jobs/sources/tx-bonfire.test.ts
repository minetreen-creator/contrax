/**
 * Texas Bonfire tenants (`tx_txdot_bonfire`, `tx_uttyler_bonfire`) and the
 * parameterised Bonfire reader (`bonfire-public.ts`). Zero network, no database:
 * the fixtures are the verbatim open-opportunities JSON captured 2026-10-06 from
 * txdot.bonfirehub.com (37 open projects) and uttyler.bonfirehub.com (2 open
 * projects) — see fixtures/tx-txdot-bonfire/README.md and
 * fixtures/tx-uttyler-bonfire/README.md. `now` is injected everywhere.
 *
 * It also pins THE TIME-ZONE RULE (bonfire-public.ts's header): Bonfire's
 * `DateClose` is a ZONE-LESS string whose stored value is UTC, so a Texas close
 * date is read as UTC and never shifted into America/Chicago. The live proof is
 * the tenant's own rendered list (TxDOT row 249305: stored "2026-10-06 17:00:00",
 * portal prints "Oct 6th 2026, 12:00 PM CDT"); the assertions below are what CI
 * can hold on to without touching the network.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import {
  bonfireAgencyName,
  bonfireCloseMs,
  isNonCompetitiveBonfireNotice,
  parseBonfire,
  type BonfirePayload,
} from "./bonfire-public";
import {
  TX_TXDOT_BONFIRE_CONFIG,
  TX_TXDOT_BONFIRE_COPY,
  fetchTxTxdotBonfireBids,
  parseTxTxdotBonfire,
} from "./tx-txdot-bonfire";
import {
  TX_UTTYLER_BONFIRE_CONFIG,
  TX_UTTYLER_BONFIRE_COPY,
  fetchTxUttylerBonfireBids,
  parseTxUttylerBonfire,
} from "./tx-uttyler-bonfire";
import { UT_BONFIRE_CONFIG, parseUtBonfire } from "./ut-bonfire";

const TXDOT: BonfirePayload = JSON.parse(
  gunzipSync(
    readFileSync(new URL("./fixtures/tx-txdot-bonfire/open-opportunities-2026-10-06.json.gz", import.meta.url)),
  ).toString("utf8"),
).payload;
const UTTYLER: BonfirePayload = JSON.parse(
  gunzipSync(
    readFileSync(new URL("./fixtures/tx-uttyler-bonfire/open-opportunities-2026-10-06.json.gz", import.meta.url)),
  ).toString("utf8"),
).payload;
/** The fixtures' own capture instant (2026-10-06 ~05:58Z), before every close date in them. */
const CAPTURED = Date.parse("2026-10-06T05:58:00Z");
/** Utah's own committed fixture, used only to prove the per-tenant keying (see below). */
const UTAH: BonfirePayload = JSON.parse(
  gunzipSync(readFileSync(new URL("./fixtures/ut-bonfire/open-opportunities-2026-10-05.json.gz", import.meta.url))).toString(
    "utf8",
  ),
).payload;

describe("tx_txdot_bonfire — parse (captured response)", () => {
  test("37 listed open projects; all 37 accepted; nothing silently dropped", () => {
    const { rows, skipped, skippedRows } = parseTxTxdotBonfire(TXDOT, CAPTURED);
    expect(Object.keys(TXDOT.projects).length).toBe(37);
    expect(skipped).toEqual({});
    expect(skippedRows).toEqual([]);
    expect(rows.length).toBe(37);
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(37);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^txdotbonfire-\d+$/);
      expect(r.location).toBe("Texas");
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.agency.length).toBeGreaterThan(0);
      expect(Date.parse(r.due_date!)).toBeGreaterThan(CAPTURED);
      expect(r.source_url).toMatch(/^https:\/\/txdot\.bonfirehub\.com\/opportunities\/\d+$/);
      // Ruling f: a Bonfire list exposes none of these, so they stay NULL —
      // nothing is inferred from any Texas program.
      expect(r.set_aside).toBeNull();
      expect(r.naics_code).toBeNull();
      expect(r.psc).toBeNull();
      expect(r.notice_type).toBeNull();
    }
  });

  test("a row reads exactly as the portal lists it (title / ref / department / close)", () => {
    const r = parseTxTxdotBonfire(TXDOT, CAPTURED).rows.find((x) => x.external_id === "txdotbonfire-249305")!;
    expect(r.title).toBe("SAN MARCOS NEW MAINTENANCE FACILITY AUSTIN DHQ");
    expect(r.solicitation_number).toBe("14-470424513");
    // The portal's own Department column renders "SSD_CM" verbatim; the code is
    // never expanded (the source publishes no mapping) and never replaced by a guess.
    expect(r.agency).toBe("SSD_CM");
    expect(r.due_date).toBe("2026-10-06T17:00:00.000Z");
    expect(r.source_url).toBe("https://txdot.bonfirehub.com/opportunities/249305");
    expect(r.description).toBe(
      "Texas public procurement opportunity 14-470424513 posted by SSD_CM on the TxDOT Procurement Portal (Bonfire). " +
        "Documents and responses through the Bonfire portal (free vendor account; see source link).",
    );
  });

  test("every department label is kept verbatim — no expansion of TxDOT's internal codes", () => {
    const agencies = new Set(parseTxTxdotBonfire(TXDOT, CAPTURED).rows.map((r) => r.agency));
    expect([...agencies].sort()).toEqual([
      "PEPS",
      "PRO_Equip_Gen",
      "PRO_IT",
      "PRO_North_East",
      "PRO_Services",
      "PRO_South_West",
      "PRO_Strategic",
      "SSD_CM",
    ]);
  });

  test("the state/local write path pins Texas for every row (curated, never text-derived)", () => {
    for (const r of parseTxTxdotBonfire(TXDOT, CAPTURED).rows) {
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: "tx_txdot_bonfire",
      });
      expect(cols.source_jurisdiction).toBe("TX");
      expect(cols.normalized_state).toBe("TX");
      expect(cols.raw_location).toBe("Texas");
      expect(cols.location_conflict).toBe(false);
    }
  });
});

describe("tx_uttyler_bonfire — parse (captured response)", () => {
  test("2 listed open projects, both accepted; the tenant carries UT Tyler AND UT Health rows", () => {
    const { rows, skipped } = parseTxUttylerBonfire(UTTYLER, CAPTURED);
    expect(skipped).toEqual({});
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.external_id).sort()).toEqual(["uttylerbonfire-256294", "uttylerbonfire-256296"]);
    const byId = new Map(rows.map((r) => [r.external_id, r]));
    expect(byId.get("uttylerbonfire-256294")!.title).toBe("UT Tyler - Architect/Engineer Professional Services");
    expect(byId.get("uttylerbonfire-256294")!.solicitation_number).toBe("RFQ No. 750-26/27-001");
    expect(byId.get("uttylerbonfire-256296")!.title).toBe(
      "UT Health Science Center at Tyler - Architect/Engineer Professional Services",
    );
    expect(byId.get("uttylerbonfire-256296")!.solicitation_number).toBe("RFQ No. UTHSCT2027-001");
    for (const r of rows) {
      expect(r.location).toBe("Texas");
      expect(r.agency).toBe("Procurement"); // the portal's own Department column, verbatim
      expect(r.due_date).toBe("2026-10-28T20:00:00.000Z");
      expect(r.source_url).toBe(`https://uttyler.bonfirehub.com/opportunities/${r.external_id.split("-")[1]}`);
      expect(r.set_aside).toBeNull();
      expect(r.naics_code).toBeNull();
      expect(r.psc).toBeNull();
      expect(r.notice_type).toBeNull();
    }
  });

  test("the write path pins Texas for the university tenant too", () => {
    for (const r of parseTxUttylerBonfire(UTTYLER, CAPTURED).rows) {
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: "tx_uttyler_bonfire",
      });
      expect(cols.source_jurisdiction).toBe("TX");
      expect(cols.normalized_state).toBe("TX");
    }
  });
});

describe("Bonfire time zone — DateClose is UTC on every tenant (pinned rule)", () => {
  test("a Texas close date is the stored UTC instant, never shifted into America/Chicago", () => {
    // TxDOT 249305 stores "2026-10-06 17:00:00" and the tenant's own list renders it
    // "Oct 6th 2026, 12:00 PM CDT" (= 17:00Z − 5 h). Reading it as local Central
    // would produce 22:00Z — this pin fails if anyone "fixes" it that way.
    expect(bonfireCloseMs("2026-10-06 17:00:00")).toBe(Date.parse("2026-10-06T17:00:00Z"));
    expect(bonfireCloseMs("2026-10-06 17:00:00")).not.toBe(Date.parse("2026-10-06T22:00:00Z"));
    expect(parseTxTxdotBonfire(TXDOT, CAPTURED).rows.find((r) => r.external_id === "txdotbonfire-249305")!.due_date).toBe(
      "2026-10-06T17:00:00.000Z",
    );
    // UT Tyler's own pairing: stored "2026-10-28 20:00:00" → rendered "3:00 PM CDT".
    expect(bonfireCloseMs("2026-10-28 20:00:00")).toBe(Date.parse("2026-10-28T20:00:00Z"));
  });

  test("the rule is the reader's, not a tenant's: a zone-less value that is not the DB format is never guessed", () => {
    expect(bonfireCloseMs("2026-10-06T17:00:00Z")).toBeNaN(); // ISO-with-Z is not the format Bonfire stores
    expect(bonfireCloseMs("2026-10-06 17:00")).toBeNaN(); // no seconds ⇒ unreadable, not "close enough"
    expect(bonfireCloseMs("")).toBeNaN();
    expect(bonfireCloseMs(null)).toBeNaN();
    const base = TXDOT.projects["249305"];
    const skips = parseTxTxdotBonfire(
      { projects: { a: { ...base, DateClose: "2026-10-06 17:00" } }, departments: TXDOT.departments },
      CAPTURED,
    );
    expect(skips.rows).toEqual([]);
    expect(skips.skipped).toEqual({ bad_date: 1 });
  });
});

describe("Bonfire reader — the gates are the tenant's too (never loosened)", () => {
  const base = TXDOT.projects["249305"];
  const one = (over: Partial<typeof base>, now = CAPTURED) =>
    parseTxTxdotBonfire({ projects: { a: { ...base, ...over } }, departments: TXDOT.departments }, now);

  test("a non-open status, a passed close date and a non-competition notice are all skipped", () => {
    expect(one({ ProjectStatusID: "3" }).skipped).toEqual({ not_open: 1 });
    expect(one({}, Date.parse("2026-10-07T00:00:00Z")).skipped).toEqual({ closed: 1 });
    expect(one({ ProjectName: "Contract 256230 Amendment 4 request to increase funding" }).skipped).toEqual({
      not_competitive: 1,
    });
    expect(
      one({ ProjectName: "Notice of Intent to Award Without Engaging in a Standard Procurement Process - X" }).skipped,
    ).toEqual({ not_competitive: 1 });
    expect(one({ ProjectName: "" }).skipped).toEqual({ missing_fields: 1 });
    expect(isNonCompetitiveBonfireNotice("HVAC & Mechanical Maintenance Services")).toBe(false);
  });

  test("a row whose department names nothing falls back to the tenant's buyer name", () => {
    expect(bonfireAgencyName(null, "Texas Department of Transportation")).toBe("Texas Department of Transportation");
    const r = parseTxTxdotBonfire(
      { projects: { a: { ...base, DepartmentID: "999999" } }, departments: TXDOT.departments },
      CAPTURED,
    ).rows[0]!;
    expect(r.agency).toBe("Texas Department of Transportation");
  });
});

describe("Bonfire reader — one reader, per-tenant identity (no cross-tenant collision)", () => {
  test("the two TX tenants cannot share an external_id, and neither can the utbonfire- prefix", () => {
    const prefixes = [UT_BONFIRE_CONFIG.idPrefix, TX_TXDOT_BONFIRE_CONFIG.idPrefix, TX_UTTYLER_BONFIRE_CONFIG.idPrefix];
    expect(new Set(prefixes).size).toBe(3);
    const txdotIds = Object.keys(TXDOT.projects);
    const uttylerIds = Object.keys(UTTYLER.projects);
    const utahIds = Object.keys(UTAH.projects);
    // Bonfire ProjectIDs come from ONE numeric space shared by every tenant: the
    // captured ranges INTERLEAVE (txdot's 245612–256550 straddles utah's), even
    // though no id happens to be shared in today's three captures. That is why the
    // prefix is per-tenant — and the forced clash below is the guard.
    const num = (ids: string[]) => ids.map(Number);
    const txN = num(txdotIds);
    const utN = num(utahIds);
    expect(Math.min(...txN)).toBeLessThan(Math.max(...utN));
    expect(Math.max(...txN)).toBeGreaterThan(Math.min(...utN));
    expect(txdotIds.filter((id) => utahIds.includes(id))).toEqual([]); // measured today, not guaranteed
    expect(uttylerIds.filter((id) => txdotIds.includes(id))).toEqual([]);
    // The guard itself: the SAME ProjectID pushed through Utah's config and TxDOT's
    // config stays two rows with two ids, two sources and two hosts.
    const clashId = String(Math.max(...txN));
    const clash: BonfirePayload = {
      projects: { [clashId]: { ...TXDOT.projects[clashId]!, ProjectID: clashId } },
      departments: TXDOT.departments,
    };
    const asUtah = parseBonfire(UT_BONFIRE_CONFIG, clash, CAPTURED).rows;
    const asTxdot = parseBonfire(TX_TXDOT_BONFIRE_CONFIG, clash, CAPTURED).rows;
    expect(asUtah[0]!.external_id).toBe(`utbonfire-${clashId}`);
    expect(asTxdot[0]!.external_id).toBe(`txdotbonfire-${clashId}`);
    expect(asUtah[0]!.external_id).not.toBe(asTxdot[0]!.external_id);
    expect(asUtah[0]!.source_url).toContain("utah.bonfirehub.com");
    expect(asTxdot[0]!.source_url).toContain("txdot.bonfirehub.com");
    // Every accepted row on both tenants really carries its tenant's prefix.
    expect(parseTxTxdotBonfire(TXDOT, CAPTURED).rows.every((r) => r.external_id.startsWith("txdotbonfire-"))).toBe(
      true,
    );
    expect(parseTxUttylerBonfire(UTTYLER, CAPTURED).rows.every((r) => r.external_id.startsWith("uttylerbonfire-"))).toBe(
      true,
    );
  });

  test("the config is what differs: the same payload through two configs differs only by tenant", () => {
    const asTxdot = parseBonfire(TX_TXDOT_BONFIRE_CONFIG, UTTYLER, CAPTURED).rows;
    const asUttyler = parseBonfire(TX_UTTYLER_BONFIRE_CONFIG, UTTYLER, CAPTURED).rows;
    expect(asTxdot.length).toBe(asUttyler.length);
    for (let i = 0; i < asTxdot.length; i++) {
      expect(asTxdot[i]!.external_id).toBe(asUttyler[i]!.external_id.replace("uttylerbonfire-", "txdotbonfire-"));
      expect(asTxdot[i]!.source_url).toContain("txdot.bonfirehub.com");
      expect(asUttyler[i]!.source_url).toContain("uttyler.bonfirehub.com");
      // Same state, so location is identical either way.
      expect(asTxdot[i]!.location).toBe("Texas");
      expect(asUttyler[i]!.location).toBe("Texas");
    }
    // And Utah's config still reads Utah's payload as Utah — the refactor's default.
    const utah = parseBonfire(UT_BONFIRE_CONFIG, UTTYLER, CAPTURED).rows;
    expect(utah[0]!.external_id).toBe("utbonfire-256294");
    expect(utah[0]!.location).toBe("Utah");
    expect(utah[0]!.source_url).toContain("utah.bonfirehub.com");
  });
});

describe("Texas Bonfire tenants — registration (tail sources, TX home jurisdiction, state badge)", () => {
  test("both tenants are tail sources with their own fetchFn, and no label is duplicated", () => {
    expect(TAIL_SOURCES.map((s) => s.name)).toContain("tx_txdot_bonfire");
    expect(TAIL_SOURCES.map((s) => s.name)).toContain("tx_uttyler_bonfire");
    expect(TAIL_SOURCES.find((s) => s.name === "tx_txdot_bonfire")!.fetchFn).toBe(fetchTxTxdotBonfireBids);
    expect(TAIL_SOURCES.find((s) => s.name === "tx_uttyler_bonfire")!.fetchFn).toBe(fetchTxUttylerBonfireBids);
    expect(new Set(TAIL_SOURCES.map((s) => s.name)).size).toBe(TAIL_SOURCES.length);
  });

  test("class `state`, scope TX, state-portal scope, non-federal badge (R5/R8 + ruling b)", () => {
    for (const label of ["tx_txdot_bonfire", "tx_uttyler_bonfire"]) {
      expect(SOURCE_CLASSES[label]).toEqual({
        class: "state",
        scopeState: "TX",
        searchScope: "state-portal",
        recordType: "opportunity",
      });
      expect(isStateLocalSource([label])).toBe(true);
      expect(sourceBadgeLabel(label)).toBe("State (TX)");
      expect(SOURCE_HOME_JURISDICTIONS[label]).toBe("TX");
    }
  });

  test("TxDOT and the UT Tyler tenant never claim to be a Texas state agency beyond their class", () => {
    // The badge is the class' (STATE/TX), never the buyer string; the university
    // tenant is STATE because it is a Texas public body's own portal (R5/R8), not
    // because a buyer string said "university".
    expect(sourceBadgeLabel("tx_uttyler_bonfire")).toBe(sourceBadgeLabel("tx_txdot_bonfire"));
    expect(TX_TXDOT_BONFIRE_COPY.badge).toBe("State (TX)");
    expect(TX_UTTYLER_BONFIRE_COPY.badge).toBe("State (TX)");
  });

  test("the honest copy is exported, and it does not claim coverage", () => {
    for (const copy of [TX_TXDOT_BONFIRE_COPY, TX_UTTYLER_BONFIRE_COPY]) {
      expect(copy.publisherLine.length).toBeGreaterThan(0);
      expect(copy.openSetDefinition).toContain("close date that has not passed");
      expect(copy.timeZoneNote).toContain("UTC");
      expect(copy.noClaimsLine).toContain("does not warrant");
      expect(copy.noClaimsLine).toContain("official source");
    }
    expect(TX_TXDOT_BONFIRE_COPY.publisherLine).toContain("Texas Department of Transportation");
    expect(TX_UTTYLER_BONFIRE_COPY.buyerMixNote).toContain("UT Health Science Center at Tyler");
  });
});
