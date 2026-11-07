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

// UT capital projects (owner 2026-11-06: "3" = read UT's due dates out of its PDFs).
describe("University of Tennessee capital projects", async () => {
  const ut = await import("./tn-ut-capital");
  const { readdirSync } = await import("node:fs");
  const dir = new URL("./fixtures/tn-ut-capital/", import.meta.url);
  const files = readdirSync(dir);
  const entries = () => ut.UT_CAMPUSES.flatMap((c) =>
    ut.parseUtCampusPage(c, readFileSync(new URL(`${c.slug}.html`, dir), "utf8")).map((listing) => {
      const f = files.find((x) => x === `${c.slug}--${listing.pdf.split("/").pop()!.replace(/\.pdf$/i, "")}.txt`);
      return { listing, pdfText: f ? readFileSync(new URL(f, dir), "utf8") : null };
    }));

  test("today only UTC Generator Installation is open; its deadline comes from the PDF", () => {
    const { rows, skipped } = ut.collectUtBids(entries(), now);
    expect(rows).toHaveLength(1);
    const gen = rows[0];
    expect(gen.title).toBe("UTC Generator Installation");
    expect(gen.agency).toBe("University of Tennessee at Chattanooga");
    expect(gen.location).toBe("Chattanooga, TN");
    expect(gen.due_date).toBe("2026-12-03T19:00:00.000Z"); // "Until 2:00 p.m., local time On December 3, 2026" (EST)
    expect(gen.solicitation_number).toBe("999/005-103-2025");
    expect(gen.source_url).toBe("https://tennessee.edu/wp-content/uploads/2026/11/UTC-Generator-Installation-Invitation-to-Bid-FINAL.pdf");
    expect(JSON.stringify(rows)).not.toMatch(/zoom|Password|aeedinc|423-752/i);
    expect(skipped).toEqual({ closed: 8, no_deadline: 4, pdf_unreadable: 1 });
  });

  test("earlier in the year: Central campuses, the page's moved-opening note, contractor packages", () => {
    const { rows } = ut.collectUtBids(entries(), Date.parse("2026-01-01T00:00:00Z"));
    const by = (t: string) => rows.find((r) => r.title.startsWith(t))!;
    expect(by("Fletcher Hall").due_date).toBe("2026-02-27T19:00:00.000Z"); // note: moved to Feb 27 2:00 pm ET
    expect(by("Fletcher Hall").description).toContain("opening moved");
    expect(by("UTM Storm Damage").due_date).toBe("2026-10-21T15:00:00.000Z"); // 10:00 a.m. Central (Martin)
    expect(by("4-H Centers").location).toBe("Crossville, TN"); // Central even though UTIA is in Knoxville
    expect(by("4-H Centers").due_date).toBe("2026-08-04T19:00:00.000Z");
    expect(by("UTHSC Gross Anatomy Lab Renovation (24/25) (SP 2").location).toBe("Memphis, TN"); // not the CM's office city
    expect(by("ARP – Broiler").due_date).toBe("2026-05-14T18:00:00.000Z"); // "2:00 pm EST" in May = Eastern local
  });

  test("deadline wording variants and the empty-list text", () => {
    expect(ut.utPdfDeadline("Complete bids are to be emailed no later than 2:00 P.M., EST, Tuesday February 24, 2026", "America/Chicago")?.iso).toBe("2026-02-24T19:00:00.000Z");
    expect(ut.utPdfDeadline("Until: 2:00PM Local Time On: Tuesday, March 10, 2026", "America/Chicago")?.iso).toBe("2026-03-10T19:00:00.000Z");
    expect(ut.utPdfDeadline("no dates here", "America/Chicago")).toBeNull();
    expect(ut.parseUtCampusPage(ut.UT_CAMPUSES[1], readFileSync(new URL("utk-bids.html", dir), "utf8"))).toEqual([]);
    expect(() => ut.parseUtCampusPage(ut.UT_CAMPUSES[0], "<html></html>")).toThrow();
  });

  test("the reader fetches each campus page and only same-site PDFs", async () => {
    const saved = { ...ut.utDeps };
    const asked: string[] = [];
    try {
      ut.utDeps.pause = async () => {};
      ut.utDeps.fetch = async (url: string) => {
        asked.push(url);
        const slug = /construction-opportunities\/([a-z-]+)\/$/.exec(url)?.[1];
        if (slug) return new Response(readFileSync(new URL(`${slug}.html`, dir), "utf8"), { status: 200 });
        return new Response(new Uint8Array([1]), { status: 200 });
      };
      ut.utDeps.pdfText = async () => "Until 2:00 p.m., local time On December 3, 2026";
      const r = await ut.fetchTnUtCapitalBids(now);
      expect(asked.filter((u) => u.endsWith("-bids/"))).toHaveLength(8);
      expect(asked.every((u) => u.startsWith("https://tennessee.edu/"))).toBe(true);
      expect(r.rows.length).toBeGreaterThan(0);
    } finally { Object.assign(ut.utDeps, saved); }
  });

  test("scheduled and placed in TN as a statewide source", () => {
    expect(TAIL_SOURCES.some((t) => t.name === "tn_ut_capital")).toBe(true);
    expect(SOURCE_CLASSES.tn_ut_capital?.class).toBe("state");
    expect(SOURCE_HOME_JURISDICTIONS.tn_ut_capital).toBe("TN");
  });
});
