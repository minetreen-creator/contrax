import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  WINNERS_COLUMNS, WINNERS_PRICE_CENTS, WINNERS_PRODUCT, WINNERS_SESSION_RE,
  buyerEmail, cleanWinnersState, csvCell, paidWinnersState, winnerRowFromApi, winnersCsv, winnersDownloadHref, winnersSearchBody,
} from "./state-winners";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const paid = { mode: "payment", payment_status: "paid", amount_total: WINNERS_PRICE_CENTS, currency: "usd", metadata: { product: WINNERS_PRODUCT, winners_state: "NC" } };

describe("state winners list", () => {
  test("only the 50 states and DC can be bought", () => {
    expect(cleanWinnersState("nc")).toBe("NC");
    expect(cleanWinnersState(" DC ")).toBe("DC");
    expect(cleanWinnersState("PR")).toBeNull();
    expect(cleanWinnersState("North Carolina")).toBeNull();
    expect(cleanWinnersState(null)).toBeNull();
  });

  test("the federal search asks for new construction awards in one state since October 2024", () => {
    const f = (winnersSearchBody("NC", 2, "2026-11-19") as any).filters;
    expect(f.place_of_performance_locations).toEqual([{ country: "USA", state: "NC" }]);
    expect(f.time_period).toEqual([{ start_date: "2024-10-01", end_date: "2026-11-19", date_type: "new_awards_only" }]);
    expect(f.naics_codes).toEqual({ require: ["23"] });
    expect(f.award_amounts).toEqual([{ lower_bound: 100000 }]);
    expect((winnersSearchBody("NC", 2, "2026-11-19") as any).page).toBe(2);
  });

  test("a federal record becomes a row, marked when the winner is from another state", () => {
    const row = winnerRowFromApi({
      "Award ID": "36C77627C0017", "Recipient Name": "SEMPER TEK CMS JV LLC", "Recipient Location": { city_name: "LEXINGTON", state_code: "KY" },
      "Award Amount": 26705489.4, "Start Date": "2026-11-16", "Awarding Agency": "Department of Veterans Affairs", "Awarding Sub Agency": "Department of Veterans Affairs",
      "Primary Place of Performance": { city_name: "ASHEVILLE", state_code: "NC" }, Description: "CONSTRUCTION  TO PROVIDE\nUPGRADES", generated_internal_id: "CONT_AWD_36C77627C0017_3600_-NONE-_-NONE-",
    }, "NC");
    expect(row).toMatchObject({ company: "SEMPER TEK CMS JV LLC", companyState: "KY", outOfState: true, amount: 26705489, workCity: "ASHEVILLE", description: "CONSTRUCTION TO PROVIDE UPGRADES" });
    expect(row.record).toBe("https://www.usaspending.gov/award/CONT_AWD_36C77627C0017_3600_-NONE-_-NONE-");
    expect(winnerRowFromApi({ "Recipient Location": { state_code: "NC" } }, "NC").outOfState).toBe(false);
    expect(winnerRowFromApi({}, "NC")).toMatchObject({ company: "", amount: 0, record: "", outOfState: false });
  });

  test("the file has one header row, quotes every cell and cannot carry a spreadsheet formula", () => {
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("-5")).toBe(`"'-5"`);
    expect(csvCell(1200)).toBe('"1200"');
    const csv = winnersCsv([winnerRowFromApi({ "Recipient Name": "A, B & C", "Recipient Location": { state_code: "VA" }, "Award Amount": 250000 }, "NC")]);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines.length).toBe(2);
    expect(lines[0].split('","').length).toBe(WINNERS_COLUMNS.length);
    expect(lines[1]).toContain('"A, B & C"');
    expect(lines[1]).toContain('"Yes"');
    expect(lines[1]).toContain('"250000"');
  });

  test("only a paid session for this product, at this price, opens a file", () => {
    expect(paidWinnersState(paid)).toBe("NC");
    expect(paidWinnersState({ ...paid, payment_status: "unpaid" })).toBeNull();
    expect(paidWinnersState({ ...paid, amount_total: 900 })).toBeNull();
    expect(paidWinnersState({ ...paid, mode: "subscription" })).toBeNull();
    expect(paidWinnersState({ ...paid, metadata: { product: "pipeline_report", winners_state: "NC" } })).toBeNull();
    expect(paidWinnersState({ ...paid, metadata: { product: WINNERS_PRODUCT, winners_state: "ZZ" } })).toBeNull();
    expect(paidWinnersState(null)).toBeNull();
  });

  test("the download link carries the Stripe session and nothing else", () => {
    expect(WINNERS_SESSION_RE.test("cs_live_a1B2c3D4e5F6g7")).toBe(true);
    expect(WINNERS_SESSION_RE.test("../etc/passwd")).toBe(false);
    expect(winnersDownloadHref("cs_live_a1B2c3D4e5F6g7")).toBe("/api/state-winners/download?session=cs_live_a1B2c3D4e5F6g7");
    expect(buyerEmail("NC", "cs_live_a1B2c3D4e5F6g7").text).toContain("https://www.contrax.company/winners-list?session=cs_live_a1B2c3D4e5F6g7");
  });

  test("the payment hook runs before the plan flow and the download checks Stripe", () => {
    const stripe = read("./stripe.ts");
    expect(stripe.indexOf("handleWinnersEvent(event)")).toBeGreaterThan(0);
    expect(stripe.indexOf("handleWinnersEvent(event)")).toBeLessThan(stripe.indexOf("handleTierSubscriptionEvent(event)"));
    const server = read("./state-winners.server.ts");
    expect(server).toContain('mode: "payment"');
    expect(server).toContain("unit_amount: WINNERS_PRICE_CENTS");
    expect(server).toContain("stripe.checkout.sessions.retrieve(sessionId)");
    const download = read("../routes/api/state-winners/download.ts");
    expect(download).toContain("paidStateForSession(session)");
    expect(download).toContain("WINNERS_SESSION_RE.test(session)");
  });

  test("the offer is on the federal construction page and the supplier page points to it", () => {
    expect(read("../routes/federal-construction-by-state.tsx")).toContain("<WinnersListOffer");
    expect(read("../routes/index.tsx")).toContain('<WinnersListOffer source="/" place="home" />');
    expect(read("../routes/suppliers.tsx")).toContain("/federal-construction-by-state#list");
    expect(read("../components/SupplierRequestForm.tsx")).toContain("WINNERS_SUPPLIER_LINE");
  });

  test("no private address is written into the product", () => {
    for (const f of ["./state-winners.ts", "./state-winners.server.ts", "../components/WinnersListOffer.tsx", "../routes/winners-list.tsx"]) {
      expect(read(f)).not.toContain("minetreen");
    }
  });
});
