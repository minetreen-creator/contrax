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

// Owner 2026-11-11: loading a longer history of contracts for the bid page's size estimate,
// without sending old contracts to the two paying customers as new leads.
import { readFileSync as readSrc } from "node:fs";
import { AWARD_FEED_LATE_DAYS, AWARD_SYNC_MAX_DAYS, awardSyncWindow, parseAwardSyncArgs } from "./award-leads";

describe("loading a slice of contract history", () => {
  const now = new Date("2026-11-11T15:00:00Z");

  test("the daily run is unchanged: the last 10 days", () => {
    expect(awardSyncWindow({}, now)).toEqual({ ok: true, start: "2026-11-01", end: "2026-11-11", history: false });
  });

  test("a slice is the days up to its end date", () => {
    expect(awardSyncWindow({ end: "2026-08-31", days: 10 }, now)).toEqual({ ok: true, start: "2026-08-21", end: "2026-08-31", history: true });
  });

  test("a slice that is too long, in the future or not a date is refused", () => {
    expect(awardSyncWindow({ days: AWARD_SYNC_MAX_DAYS + 1 }, now).ok).toBe(false);
    expect(awardSyncWindow({ days: 0 }, now).ok).toBe(false);
    expect(awardSyncWindow({ end: "2027-01-01" }, now).ok).toBe(false);
    expect(awardSyncWindow({ end: "last month" }, now).ok).toBe(false);
  });

  test("the job reads its flags, and no flags means the normal run", () => {
    expect(parseAwardSyncArgs([])).toEqual({ days: undefined, end: undefined, maxPages: undefined, dryRun: false });
    expect(parseAwardSyncArgs(["--end=2026-08-31", "--days=10", "--max-pages=150", "--dry-run"])).toEqual({ days: 10, end: "2026-08-31", maxPages: 150, dryRun: true });
    expect(parseAwardSyncArgs(["--days=abc"]).days).toBeUndefined();
  });

  test("an award dated after the slice is not kept, and a cut-off slice fails loudly", () => {
    const server = readSrc("src/lib/award-leads.server.ts", "utf8");
    expect(server).toContain("l.awarded_on >= startStr && l.awarded_on <= endStr");
    const job = readSrc("src/jobs/award-leads-sync.ts", "utf8");
    expect(job).toContain("if (r.truncated) {");
    expect(job.indexOf("if (r.truncated) {")).toBeLessThan(job.indexOf("process.exit(0);"));
  });

  test("the feed and CSV leave history out unless the buyer asks for a date range", () => {
    expect(AWARD_FEED_LATE_DAYS).toBe(45);
    const server = readSrc("src/lib/award-leads.server.ts", "utf8");
    expect(server).toContain("first_seen_at::date - awarded_on <= ${AWARD_FEED_LATE_DAYS}");
    expect(server.indexOf("? s`AND awarded_on >= ${q.since}`")).toBeLessThan(server.indexOf("first_seen_at::date - awarded_on"));
  });

  test("the workflow only passes well-formed inputs to the job", () => {
    const wf = readSrc(".github/workflows/sync-award-leads.yml", "utf8");
    expect(wf).toContain('if [[ "$SLICE_END" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]');
    expect(wf).not.toContain("--end=${{"); // inputs reach the shell as env vars, never pasted into the command
  });
});

// 2026-11-11: the Sep 18-28 slice saw exactly 10,000 records and exited as if complete.
test("a slice cut off by USAspending's 10,000-record limit is reported as incomplete", () => {
  const server = readSrc("src/lib/award-leads.server.ts", "utf8");
  expect(server).toContain("export const USASPENDING_MAX_RECORDS = 10_000;");
  expect(server).toContain("truncated = seen >= USASPENDING_MAX_RECORDS;");
  // A last page that is all small awards still counts as complete, whatever the count.
  expect(server.indexOf("truncated = false;")).toBeLessThan(server.indexOf("truncated = seen >= USASPENDING_MAX_RECORDS;"));
});

// 2026-11-11: two days at fiscal year end passed 10,000 records with 387 new awards among them.
test("a history slice asks USAspending for new awards only; the daily run is unchanged", () => {
  const server = readSrc("src/lib/award-leads.server.ts", "utf8");
  expect(server).toContain('w.history ? { start_date: startStr, end_date: endStr, date_type: "new_awards_only" } : { start_date: startStr, end_date: endStr }');
});

test("a slice can be run as a count that writes nothing", () => {
  const wf = readSrc(".github/workflows/sync-award-leads.yml", "utf8");
  expect(wf).toContain('if [[ "$SLICE_DRY_RUN" == "yes" ]]; then args="$args --dry-run"; fi');
  const server = readSrc("src/lib/award-leads.server.ts", "utf8");
  expect(server).toContain("if (!opts.dryRun && leads.length) inserted += await insertAwardLeads(leads);");
});

// 2026-11-11: a part-loaded period holds only its largest awards, so it stays out of the estimate.
test("history rows stay out of the bid page figures until the load is complete", async () => {
  const { AWARD_HISTORY_IN_ESTIMATES } = await import("./award-leads");
  expect(AWARD_HISTORY_IN_ESTIMATES).toBe(false);
  const area = readSrc("src/lib/area-awards.server.ts", "utf8");
  expect(area).toContain("AWARD_HISTORY_IN_ESTIMATES ? s`` : s`AND (awarded_on IS NULL OR first_seen_at::date - awarded_on <= ${AWARD_FEED_LATE_DAYS})`");
  // Every figure on the box uses it: the two aggregates and the two paid queries.
  expect(area.split("${settled}").length - 1).toBe(4);
});
