import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { coopDue, mapSourcewell, readBuyBoard, readChoiceCurrent, readChoiceUpcoming, readOmnia, readSourcewellDueTime, readSourcewellList } from "./coop";
import { COOPS, coopTrades } from "~/lib/coop-contracts";

// Owner 2026-11-10: "yes build it". Pages captured as ContraxBot on 2026-11-10 (robots.txt allows both).
const fixture = (f: string) => readFileSync(new URL(`./fixtures/coop/${f}-2026-11-10.html`, import.meta.url), "utf8");

test("Sourcewell: reads the open solicitations and their due dates; the construction list is empty today", () => {
  const rows = readSourcewellList(fixture("sourcewell-list"));
  expect(rows.map((r) => r.id)).toEqual(["11254", "11343", "11367", "11366", "11248"]);
  expect(rows[0]).toEqual({ id: "11254", title: "Firearms and Ammunition with Related Supplies and Services", date: "December 22, 2026", construction: false });
  expect(rows.some((r) => r.construction)).toBe(false);
});

test("Sourcewell: the solicitation page gives the time (3:30 PM CT on Dec 22 = 21:30 UTC)", () => {
  const t = readSourcewellDueTime(fixture("sourcewell-11254"));
  expect(t).toEqual({ time: "03:30 PM", zone: "CT" });
  const [row] = mapSourcewell(readSourcewellList(fixture("sourcewell-list")).slice(0, 1), { "11254": t });
  expect(row.dueAt).toBe("2026-12-22T21:30:00.000Z");
  expect(row.url).toBe("https://www.sourcewell-mn.gov/solicitations/11254");
  // Without a time the whole due day counts (11:59 PM Central).
  expect(mapSourcewell(readSourcewellList(fixture("sourcewell-list")).slice(0, 1), {})[0].dueAt).toBe("2026-12-23T05:59:00.000Z");
});

test("BuyBoard: reads every current invitation with its Central due time, PDF link and trades, plus the upcoming names", () => {
  const rows = readBuyBoard(fixture("buyboard"));
  const current = rows.filter((r) => r.number);
  expect(current.map((r) => r.number)).toEqual(["829-27", "830-27", "832-27", "833-27", "834-27", "835-27", "836-27", "837-27", "838-27", "839-27", "840-27"]);
  const electrical = current.find((r) => r.number === "832-27")!;
  expect(electrical.title).toBe("Trade Services (Electrical)");
  expect(electrical.dueAt).toBe("2026-11-12T22:00:00.000Z"); // 4:00 p.m. CST
  expect(electrical.trades).toEqual(["electrical"]);
  expect(electrical.url).toMatch(/^https:\/\/assets-us-01\.kc-usercontent\.com:443\/.+Proposal%20No\.%20832-27\.pdf$/);
  expect(current.find((r) => r.number === "833-27")!.trades).toEqual(["hvac"]);
  expect(current.find((r) => r.number === "835-27")!.trades).toEqual(["hvac"]);
  expect(current.find((r) => r.number === "834-27")!.trades).toEqual(["construction"]);
  expect(current.find((r) => r.number === "839-27")!.trades).toEqual(["construction"]);
  expect(current.find((r) => r.number === "836-27")!.trades).toEqual([]);
  const upcoming = rows.filter((r) => !r.number);
  expect(upcoming.map((r) => r.title)).toEqual([
    "Pavement Assessment Service for Roads and Highways",
    "Facility Maintenance and Operation Services",
    "Rental Services of Construction Equipment, Vehicles, and Other",
  ]);
  expect(upcoming.every((r) => r.dueAt === null)).toBe(true);
});

test("a changed page is an error, not an empty list", () => {
  expect(() => readSourcewellList("<html>nothing here</html>")).toThrow();
  expect(() => readBuyBoard("<html>nothing here</html>")).toThrow();
});

test("trades: service work gets a trade; equipment and supplies do not", () => {
  expect(coopTrades("Heavy and Compact Construction Equipment with Related Attachments and Services")).toEqual([]);
  expect(coopTrades("Rental Services of Construction Equipment, Vehicles, and Other")).toEqual([]);
  expect(coopTrades("State of Colorado- Indefinite Delivery Indefinite Quantity Construction")).toEqual(["construction"]);
  expect(coopTrades("Swimming Pool Renovation and Repair with Related Equipment, Supplies, and Services")).toEqual(["construction"]);
  expect(coopTrades("Material Processing and Recycling Equipment with Related Products and Services")).toEqual([]);
  expect(coopTrades("Cured in Place Pipe (CIPP) for Pipeline Rehabilitation (Thermo Cured Products)")).toEqual(["construction"]);
});

test("due dates: month names, a.m./p.m., and bad input", () => {
  expect(coopDue("January 28, 2027", "4:00 p.m.")).toBe("2027-01-28T22:00:00.000Z");
  expect(coopDue("Smarch 1, 2027", "4:00 p.m.")).toBeNull();
  expect(coopDue("January 28, 2027", "16:00")).toBeNull();
});

test("the co-ops Contrax reads are the ones whose pages allow it", () => {
  expect(COOPS.filter((c) => c.inContrax).map((c) => c.key)).toEqual(["sourcewell", "buyboard", "choice", "omnia"]);
});

// Owner 2026-11-13: "pull open vendor solicitations from TIPS, OMNIA, 1GPA, and Choice Partners". TIPS's
// bid site (tips.ionwave.net) disallows all robots, so it is not read; 1GPA's list is an OpenGov embed.
const fixture13 = (f: string) => readFileSync(new URL(`./fixtures/coop/${f}-2026-11-13.html`, import.meta.url), "utf8");

test("Choice Partners: the current RFP with its Central due time (2:00 PM CT on Dec 2 = 20:00 UTC)", () => {
  expect(readChoiceCurrent(fixture13("choice-current"))).toEqual([
    { key: "choice:27/005LT", coop: "choice", number: "27/005LT", title: "Waste Disposal and Recycling Services", dueAt: "2026-12-02T20:00:00.000Z", url: "https://www.choicepartners.org/current-rfps", trades: coopTrades("Waste Disposal and Recycling Services"), construction: false },
  ]);
  expect(() => readChoiceCurrent("<html>changed</html>")).toThrow();
});

test("Choice Partners: upcoming categories are announced with their expected month; stale estimates are dropped; JOC counts as construction", () => {
  const rows = readChoiceUpcoming(fixture13("choice-upcoming"), new Date("2026-11-13T12:00:00Z"));
  const titles = rows.map((r) => r.title);
  expect(titles).not.toContain("Waterproofing/Masonry (expected to open Jan 2026)");
  expect(titles).not.toContain("M&O Parts and Equipment (expected to open Jul 2026)");
  expect(titles).toContain("Custodial Supplies and Services (expected to open Nov 2026)");
  expect(titles).toContain("Roofing (JOC-IDIQ) (expected to open Nov 2027)");
  expect(rows.every((r) => r.dueAt === null && r.coop === "choice")).toBe(true);
  const roofing = rows.find((r) => r.title.startsWith("Roofing"))!;
  expect(roofing.construction).toBe(true);
  expect(roofing.trades).toContain("construction");
  expect(rows.find((r) => r.title.startsWith("Custodial"))!.trades).toEqual(coopTrades("Custodial Supplies and Services"));
  // The two Construction-JOC rounds are separate entries.
  expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
});

test("OMNIA: only the current solicitations, not the ones in evaluation", () => {
  expect(readOmnia(fixture13("omnia")).map((r) => [r.number, r.title, r.dueAt])).toEqual([["269-2027-042", "Equipment Rentals, Related Products and Services", null]]);
  expect(() => readOmnia("<html></html>")).toThrow();
});

test("abbreviated month names read the same as full ones", () => {
  expect(coopDue("Dec 02, 2026", "02:00 pm")).toBe(coopDue("December 2, 2026", "2:00 PM"));
  expect(coopDue("Decem 2, 2026", null)).toBeNull();
});
