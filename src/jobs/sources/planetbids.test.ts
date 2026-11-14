import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mapPlanetbids, planetbidsDue, PLANETBIDS_BOARDS, PLANETBIDS_SOURCES, type PlanetbidsPayload } from "./planetbids";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { expandTrade, isStrongTradeMatch } from "~/lib/trade-registry";

// Captured 2026-11-08 by .github/scripts/planetbids-bids-fetch.mjs from Toledo's public portal page.
const payload = JSON.parse(readFileSync(new URL("./fixtures/planetbids/toledo-bidding-2026-11-08.json", import.meta.url), "utf8")) as PlanetbidsPayload;
const toledo = PLANETBIDS_BOARDS[0];
const AT = Date.parse(payload.capturedAt) + 60_000;

test("Toledo's due times are Eastern", () => {
  expect(planetbidsDue("2026-11-10 13:30:00.000", "America/New_York")).toBe("2026-11-10T18:30:00.000Z");
  expect(planetbidsDue("garbage", "America/New_York")).toBeNull();
  expect(planetbidsDue("2026-11-10 13:30:00.000", "Europe/Paris")).toBeNull();
});

test("maps the captured Toledo bids to City of Toledo rows with public detail links", () => {
  const r = mapPlanetbids(toledo, payload, AT);
  expect(payload.bids.length).toBe(14);
  expect(r.rows.length).toBe(14);
  const roof = r.rows.find((x) => x.title === "Roof Repairs and Replacement")!;
  expect(roof.agency).toBe("City of Toledo");
  expect(roof.location).toBe("Toledo, OH");
  expect(roof.solicitation_number).toBe("10009030");
  expect(roof.notice_type).toBe("ITB");
  expect(roof.due_date).toBe("2026-11-17T18:30:00.000Z");
  expect(roof.source_url).toBe(`https://vendors.planetbids.com/portal/22576/bo/bo-detail/${roof.external_id.split("-").pop()}`);
  expect(r.rows.filter((x) => x.notice_type === "RFP").length).toBe(2);
});

test("skips invitation-only bids, RFIs, other stages and closed bids", () => {
  const base = payload.bids[0];
  const p: PlanetbidsPayload = { ...payload, bids: [
    { ...base, bidId: 1, byInvitation: true },
    { ...base, bidId: 2, bidTypeId: 2 },
    { ...base, bidId: 3, stageId: 4, stageStr: "Closed" },
    { ...base, bidId: 4, bidDueDate: "2026-11-01 13:30:00.000" },
  ] };
  const r = mapPlanetbids(toledo, p, AT);
  expect(r.rows).toEqual([]);
  expect(r.skipped).toEqual({ by_invitation: 1, not_a_solicitation: 1, not_bidding: 1, closed: 1 });
});

test("refuses a stale payload or one for another agency", () => {
  expect(() => mapPlanetbids(toledo, payload, AT + 2 * 3600_000)).toThrow();
  expect(() => mapPlanetbids(toledo, { ...payload, cid: 1 }, AT)).toThrow();
});

test("every PlanetBids board is registered with its state", () => {
  expect(PLANETBIDS_SOURCES.map((s) => s.name)).toEqual([
    "oh_toledo_planetbids", "ca_san_diego_planetbids", "ca_san_diego_airport_planetbids", "ca_port_of_san_diego_planetbids",
    "ca_valley_water_planetbids", "ca_sacrt_planetbids", "oh_metroparks_toledo_planetbids",
    "ca_bakersfield_planetbids", "ca_culver_city_planetbids", "ca_eastvale_planetbids", "ca_ontario_planetbids", "ca_vallejo_planetbids", "ca_vernon_planetbids", "ca_fillmore_planetbids", "ca_beaumont_planetbids", "ca_buena_park_planetbids", "ca_south_coast_water_planetbids", "ca_otay_water_planetbids", "ca_cvwd_planetbids", "ca_san_bernardino_planetbids", "ca_lacc_planetbids", "ca_duarte_planetbids", "ca_compton_planetbids", "ca_beverly_hills_planetbids", "ca_lacoe_planetbids", "ca_signal_hill_planetbids", "ca_la_habra_planetbids", "ca_santa_ana_planetbids", "ca_fountain_valley_planetbids", "ca_huntington_beach_planetbids", "ca_riverside_planetbids", "ca_ocfa_planetbids", "ca_sb_county_housing_planetbids", "ca_corona_planetbids", "ca_rctc_planetbids", "ca_peralta_cc_planetbids", "ca_long_beach_usd_planetbids", "ca_contra_costa_cc_planetbids", "ca_san_diego_usd_planetbids", "ca_moreno_valley_usd_planetbids", "ca_rialto_usd_planetbids", "tx_capmetro_planetbids", "or_port_of_portland_planetbids", "ca_central_san_planetbids", "ca_fresno_planetbids", "ca_smud_planetbids",
  ]);
  expect(new Set(PLANETBIDS_BOARDS.map((b) => b.cid)).size).toBe(PLANETBIDS_BOARDS.length);
  expect(new Set(PLANETBIDS_BOARDS.map((b) => b.idPrefix)).size).toBe(PLANETBIDS_BOARDS.length);
  for (const b of PLANETBIDS_BOARDS) expect(SOURCE_CLASSES[b.source]?.scopeState).toBe(b.location.slice(-2));
  expect(SOURCE_CLASSES.oh_toledo_planetbids?.scopeState).toBe("OH");
});

test("trauma / biohazard cleaning now counts as janitorial work", () => {
  const exp = expandTrade("janitorial");
  expect(isStrongTradeMatch("Trauma Cleaning IDIQ", null, null, null, exp)).toBe(true);
  expect(isStrongTradeMatch("Biohazard Cleaning Services", null, null, null, exp)).toBe(true);
});

// Owner 2026-11-14 ("fix it now"): PlanetBids drops a request now and then (Rialto, Corona, RCTC
// failed whole syncs but loaded fine minutes later), so the reader retries before giving up.
describe("PlanetBids reader retries a dropped load", () => {
  const script = readFileSync(new URL("../../../.github/scripts/planetbids-bids-fetch.mjs", import.meta.url), "utf8");
  test("up to 3 fresh page loads, a pause apart, inside the overall time limit", () => {
    expect(script).toContain("const MAX_ATTEMPTS = 3;");
    expect(script).toContain("const RETRY_PAUSE_MS = [0, 8_000, 20_000];");
    expect(script).toMatch(/for \(let attempt = 1; attempt <= MAX_ATTEMPTS; attempt\+\+\)/);
    expect(script).toContain("Date.now() - started + pause > 95_000");
  });
  test("a truncated list is never retried or saved", () => {
    expect(script).toContain("refusing a truncated list`), { final: true })");
    expect(script).toContain("if (error.final) break;");
  });
  test("still our own name, never a pretend browser", () => {
    expect(script).toContain("ContraxBot/1.0");
  });
});
