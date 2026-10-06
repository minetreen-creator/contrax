import { describe, expect, test } from "bun:test";
import { AWARD_LEAD_MIN_AMOUNT, LEAD_CSV_COLUMNS, leadsToCsv, parseLeadQuery, toAwardLead, usaspendingUrl } from "./award-leads";

// Shape of a current spending_by_award contract row (display-name keys; NAICS and
// Recipient Location as objects).
const row = {
  "Award ID": "W91247-26-C-0042",
  "Recipient Name": "ACME BUILDERS LLC",
  "Recipient UEI": "ABCDEF123456",
  "Recipient Location": { city_name: "Richmond", state_code: "va" },
  "Award Amount": 1250000.4,
  "Base Obligation Date": "2026-10-01",
  "Start Date": "2026-10-03",
  "Awarding Agency": "Department of Defense",
  "Awarding Sub Agency": "Department of the Army",
  Description: "BARRACKS HVAC REPLACEMENT",
  "Place of Performance State Code": "NC",
  NAICS: { code: "238220", description: "Plumbing, Heating, and Air-Conditioning Contractors" },
  generated_internal_id: "CONT_AWD_W91247-26-C-0042_9700_-NONE-_-NONE-",
};

describe("award leads (owner 2026-10-06, idea #6)", () => {
  test("a USAspending row becomes a lead", () => {
    expect(toAwardLead(row)).toEqual({
      award_key: "CONT_AWD_W91247-26-C-0042_9700_-NONE-_-NONE-",
      award_id: "W91247-26-C-0042",
      recipient_name: "ACME BUILDERS LLC",
      recipient_uei: "ABCDEF123456",
      recipient_city: "Richmond",
      recipient_state: "VA",
      amount: 1250000,
      awarded_on: "2026-10-01",
      agency: "Department of Defense",
      sub_agency: "Department of the Army",
      description: "BARRACKS HVAC REPLACEMENT",
      pop_state: "NC",
      naics_code: "238220",
      naics_description: "Plumbing, Heating, and Air-Conditioning Contractors",
    });
  });

  test("older plain-value NAICS and a missing base date still parse", () => {
    const r = toAwardLead({ ...row, NAICS: "561720", "Base Obligation Date": null, "Recipient Location": null });
    expect(r?.naics_code).toBe("561720");
    expect(r?.naics_description).toBeNull();
    expect(r?.awarded_on).toBe("2026-10-03");
    expect(r?.recipient_city).toBeNull();
  });

  test("rows that can't be sold are dropped", () => {
    expect(toAwardLead({ ...row, generated_internal_id: null })).toBeNull();
    expect(toAwardLead({ ...row, "Recipient Name": "  " })).toBeNull();
    expect(toAwardLead({ ...row, "Award Amount": AWARD_LEAD_MIN_AMOUNT - 1 })).toBeNull();
    expect(toAwardLead({ ...row, "Award Amount": "n/a" })).toBeNull();
  });

  test("query validation", () => {
    const q = (s: string) => parseLeadQuery(new URLSearchParams(s));
    expect(q("state=va,nc&naics=23&since=2026-09-01&min_amount=100000&limit=1000&after=5")).toEqual({
      ok: true,
      query: { states: ["VA", "NC"], naics: ["23"], since: "2026-09-01", minAmount: 100000, limit: 1000, after: 5 },
    });
    for (const bad of ["state=Virginia", "naics=2x", "since=later", "min_amount=-1", "limit=1001", "after=-2"]) expect(q(bad).ok).toBe(false);
  });

  test("CSV: header, quoting, and formula-injection guard", () => {
    const lead = toAwardLead({ ...row, "Recipient Name": "=HYPERLINK(\"x\")", Description: "Line, with comma" })!;
    const lines = leadsToCsv([lead]).trim().split("\r\n");
    expect(lines[0]).toBe(LEAD_CSV_COLUMNS.join(","));
    expect(lines[1].startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
    expect(lines[1]).toContain('"Line, with comma"');
    expect(lines[1]).toContain(usaspendingUrl(lead.award_key));
  });
});

describe("award leads plan access", async () => {
  const { tierHasAwardLeads, isDataFeedTier, validatePlanStates, DATA_FEED_PLANS } = await import("./data-feed-billing.server");
  test("Leads and Pro get award leads; Starter doesn't; owner-granted keys do", () => {
    expect(tierHasAwardLeads("leads")).toBe(true);
    expect(tierHasAwardLeads("pro")).toBe(true);
    expect(tierHasAwardLeads(null)).toBe(true);
    expect(tierHasAwardLeads("starter")).toBe(false);
  });
  test("Leads is a $249 checkout tier with no state list", () => {
    expect(isDataFeedTier("leads")).toBe(true);
    expect(DATA_FEED_PLANS.leads.cents).toBe(24900);
    expect(validatePlanStates("leads", "VA")).toEqual({ ok: true, states: [] });
  });
});
