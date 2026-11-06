import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";
import { mapCategory } from "~/lib/trade-classification";
import { fetchTnKnoxCountyBids, KNOX_SOLICITATIONS_URL, knoxDeadline, knoxDeps, parseKnoxSolicitations } from "./tn-knox-county";
import { parseTbrBidList, tbrDeadline, tbrZone, TBR_BID_LIST_URL } from "./tn-tbr";
import { TN_BEACON_AGENCIES } from "./tn-beacon";
import { parseBeaconList } from "./tx-houston-beacon";
import { parseCountyCivicEngage } from "./county-civicengage-boards";

// Owner 2026-11-06: "I want ALL construction bids in TN". Captures from 2026-11-06.
const fx = (p: string) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url), "utf8");
const now = Date.parse("2026-11-06T23:00:00Z");

describe("Knox County, TN solicitations", () => {
  const html = fx("tn-knox-county/solicitations-2026-11-06.html");

  test("every listed solicitation, due 11:59 PM Eastern on its date, linked to its PDF", () => {
    const { rows, skipped } = parseKnoxSolicitations(html, now);
    expect(skipped).toEqual({});
    expect(rows).toHaveLength(9);
    const school = rows.find((r) => r.solicitation_number === "3772")!;
    expect(school.title).toBe("New K-8 School/Knox County Schools");
    expect(school.external_id).toBe("knoxcounty-3772");
    expect(school.due_date).toBe("2026-12-04T04:59:00.000Z");
    expect(school.category).toBe("Construction");
    expect(school.description).toContain("Mandatory Pre-Bid Meeting");
    expect(school.source_url).toStartWith("https://www.knoxcounty.org/purchasing/pdfs/showfile.php?id=6914");
    expect(school.source_url).not.toContain(" ");
    expect(rows.find((r) => r.solicitation_number === "3777")!.category).toBe("Construction");
    // Buyer names and phones are not stored.
    expect(JSON.stringify(rows)).not.toMatch(/215-57|Fawver|mailto/);
  });

  test("dates pass and the page must still be the solicitations table", () => {
    expect(parseKnoxSolicitations(html, Date.parse("2026-11-30T12:00:00Z")).skipped.closed).toBe(2);
    expect(knoxDeadline("07-01-26")).toBe("2026-07-02T03:59:00.000Z"); // EDT
    expect(knoxDeadline("02-30-26")).toBeNull();
    expect(() => parseKnoxSolicitations("<html>moved</html>", now)).toThrow();
  });

  test("reader fails loudly on HTTP errors", async () => {
    const saved = { ...knoxDeps };
    try {
      knoxDeps.fetch = async (url) => { expect(url).toBe(KNOX_SOLICITATIONS_URL); return new Response(html, { status: 200 }); };
      expect((await fetchTnKnoxCountyBids(now)).rows).toHaveLength(9);
      knoxDeps.fetch = async () => new Response("no", { status: 500 });
      await expect(fetchTnKnoxCountyBids(now)).rejects.toThrow();
    } finally { Object.assign(knoxDeps, saved); }
  });
});

describe("Tennessee Board of Regents construction bid list", () => {
  const html = fx("tn-tbr/construction-bid-list-2026-11-06.html");

  test("each project, in its own city's time zone", () => {
    const { rows, skipped } = parseTbrBidList(html, now);
    expect(skipped).toEqual({});
    expect(rows.map((r) => r.solicitation_number)).toEqual(["001-04-2022F", "015-03-2025", "032-02-2025"]);
    const shed = rows[1];
    expect(shed.title).toBe("CoSCC Utility Shed Relocation");
    expect(shed.location).toBe("Columbia, TN");
    expect(shed.agency).toBe("Tennessee Board of Regents (Columbia SCC)");
    expect(shed.due_date).toBe("2026-12-02T20:00:00.000Z"); // 2:00 PM Central
    expect(shed.category).toBe("Construction");
    expect(shed.notice_type).toBe("ITB");
    expect(shed.source_url).toBe(TBR_BID_LIST_URL);
    const hvac = rows[2];
    expect(hvac.location).toBe("Knoxville, TN");
    expect(hvac.due_date).toBe("2026-12-02T19:00:00.000Z"); // 2:00 PM Eastern
    expect(rows[0].location).toBe("Nashville, TN"); // the page's "Nashvillle" typo
    expect(JSON.stringify(rows)).not.toMatch(/Contact:|615-726|Paul Duke/);
  });

  test("zones and dates", () => {
    expect(tbrZone("Crossville", "Knoxville")).toBe("America/Chicago");
    expect(tbrZone("Kingsport", "Nashville")).toBe("America/New_York");
    expect(tbrZone("Somewhere", "Knoxville")).toBe("America/New_York");
    expect(tbrZone("Somewhere", "Nashville")).toBe("America/Chicago");
    expect(tbrDeadline("July 1, 2026 10:00 AM", "America/Chicago")).toBe("2026-07-01T15:00:00.000Z");
    expect(tbrDeadline("Smarch 1, 2026 10:00 AM", "America/Chicago")).toBeNull();
    expect(parseTbrBidList(html, Date.parse("2026-11-20T00:00:00Z")).skipped.closed).toBe(1);
    expect(() => parseTbrBidList("<html></html>", now)).toThrow();
  });
});

describe("Tennessee buyers on Beacon", () => {
  const list = (tag: string) => JSON.parse(fx(`tn-beacon/${tag}-2026-11-06.json`)).data.solicitations.data;

  test("each buyer's open list parses under its own name", () => {
    const counts: Record<string, number> = {};
    for (const a of TN_BEACON_AGENCIES) {
      const { rows } = parseBeaconList(list(a.agencyTag), a, now);
      counts[a.source] = rows.length;
      for (const r of rows) {
        expect(r.agency).toBe(a.agency);
        expect(r.location).toEndWith(", TN");
        expect(r.external_id).toStartWith(`${a.idPrefix}-`);
        expect(r.source_url).toStartWith(`https://www.beaconbid.com/solicitations/${a.agencyTag}/`);
        expect(r.description).toContain(`${a.agency}'s Beacon procurement portal`);
      }
    }
    expect(counts).toEqual({ tn_memphis_beacon: 4, tn_alcoa_beacon: 1, tn_bradley_schools_beacon: 1, tn_mount_pleasant_beacon: 0 });
  });
});

describe("Sevierville and Lawrenceburg CivicEngage boards", () => {
  test("open bids only; a policy document is not a bid", () => {
    const sev = parseCountyCivicEngage("tn_sevierville", fx("tn-civicengage/sevierville-2026-11-06.html"), now);
    expect(sev.rows.map((r) => r.agency)).toEqual(["City of Sevierville"]);
    const law = parseCountyCivicEngage("tn_lawrenceburg", fx("tn-civicengage/lawrenceburg-2026-11-06.html"), now);
    expect(law.rows.map((r) => r.title)).toEqual(["REQUEST FOR QUALIFICATIONS SPRINGER ROAD EXTENSION PHASE II LAWRENCEBURG, TENNESSEE"]);
    expect(law.skipped.not_a_bid_title).toBe(1);
  });
});

test("Tennessee construction titles that were filed as Other", () => {
  for (const t of ["New K-8 School/Knox County Schools", "Turn Lanes and Traffic Signal at Schaad Road and Johnson Road",
    "Summit Landfill Vegetation Clearing and Groundwater Monitoring Well Installation", "VW Media Center Fire Pump Replacement", "CoSCC Utility Shed Relocation"]) {
    expect(mapCategory("", t, "")).toBe("Construction");
  }
  expect(mapCategory("", "New Elementary School Furniture", "")).not.toBe("Construction");
  expect(mapCategory("", "Traffic Signal Parts", "")).not.toBe("Construction");
});

test("every new Tennessee source is scheduled, classified, placed in TN; local ones get an agency page", () => {
  const names = ["tn_knox_county", "tn_tbr", "tn_sevierville", "tn_lawrenceburg", ...TN_BEACON_AGENCIES.map((a) => a.source)];
  for (const s of names) {
    expect(TAIL_SOURCES.some((t) => t.name === s)).toBe(true);
    expect(SOURCE_CLASSES[s]).toBeDefined();
    expect(SOURCE_HOME_JURISDICTIONS[s]).toBe("TN");
    expect(LOCAL_AGENCIES.some((a) => a.source === s)).toBe(s !== "tn_tbr"); // TBR is statewide, not a local page
  }
  expect(SOURCE_CLASSES.tn_tbr?.class).toBe("state");
});

// Batch 2 (owner 2026-11-06: "Batch 2").
describe("EPB Chattanooga and City of Kingsport", () => {
  test("EPB: every card, timed or date-only, with no contacts stored", async () => {
    const { parseEpbBids, epbDue } = await import("./tn-epb-kingsport");
    const { rows, skipped } = parseEpbBids(fx("tn-epb/bids-2026-11-06.html"), now);
    expect(skipped).toEqual({});
    expect(rows).toHaveLength(7);
    const trim = rows.find((r) => r.solicitation_number === "RFP-16201")!;
    expect(trim.title).toBe("46KV Sub Transmission Line Trimming");
    expect(trim.due_date).toBe("2026-11-30T19:00:00.000Z"); // 2:00 PM EST
    expect(trim.description).toContain("Pre-bid: 11/10/2026");
    const hvac = rows.find((r) => r.solicitation_number === "RFP-16171")!;
    expect(hvac.due_date).toBe("2027-02-04T04:59:00.000Z"); // date only -> 11:59 PM Eastern
    expect(hvac.description).toContain("no time stated");
    expect(JSON.stringify(rows)).not.toMatch(/mailto|@epb\.net|Laura Williams/);
    expect(epbDue("13/1/2026")).toBeNull();
    expect(parseEpbBids(fx("tn-epb/bids-2026-11-06.html"), Date.parse("2026-12-01T00:00:00Z")).rows.map((r) => r.solicitation_number)).toEqual(["RFP-16171"]);
  });

  test("Kingsport: active cards with their solicitation PDF, Eastern closing time", async () => {
    const { parseKingsportBids, kingsportDue } = await import("./tn-epb-kingsport");
    const { rows, skipped } = parseKingsportBids(fx("tn-kingsport/public-bids-2026-11-06.html"), now);
    expect(skipped).toEqual({});
    expect(rows.map((r) => r.title)).toEqual(["Phase 2 Renovations For Bays Mountain Nature Center", "Mitchell Road Bridge Over Kendrick Creek Replacement"]);
    expect(rows[1].due_date).toBe("2026-12-03T21:00:00.000Z");
    expect(rows[1].category).toBe("Construction");
    expect(rows[1].notice_type).toBe("ITB");
    expect(rows[0].source_url).toStartWith("https://www.kingsporttn.gov/wp-content/uploads/");
    expect(JSON.stringify(rows)).not.toMatch(/vickihousewright|4232299475|clinton@/);
    expect(kingsportDue("Thu, July 2, 2026 • 10:30 am")).toBe("2026-07-02T14:30:00.000Z");
    expect(() => parseKingsportBids("<html></html>", now)).toThrow();
  });

  test("Portland's board reads its bridge bid; Red Bank's board is empty today", () => {
    expect(parseCountyCivicEngage("tn_portland", fx("tn-civicengage/portland-2026-11-06.html"), now).rows.map((r) => r.title)).toEqual(["Lindsey Kyla Ct Bridge Replacement Bid Advertisement"]);
    expect(parseCountyCivicEngage("tn_red_bank", fx("tn-civicengage/redbank-2026-11-06.html"), now).rows).toHaveLength(0);
  });

  test("scheduled, local, in TN, with agency pages", () => {
    for (const s of ["tn_epb", "tn_kingsport", "tn_portland", "tn_red_bank"]) {
      expect(TAIL_SOURCES.some((t) => t.name === s)).toBe(true);
      expect(SOURCE_CLASSES[s]?.class).toBe("local");
      expect(SOURCE_HOME_JURISDICTIONS[s]).toBe("TN");
      expect(LOCAL_AGENCIES.some((a) => a.source === s)).toBe(true);
    }
  });
});
