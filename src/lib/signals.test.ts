import { describe, expect, test } from "bun:test";
import { agendaSignal, amountIn, legistarEventsUrl, legistarItemsUrl } from "./signals";
import { outreachEmail, teamsRecompetesPath } from "./outreach";

// Owner 2026-11-14: the pivot toward sales teams. Agenda items that show buying before a bid is posted.
describe("buying signals in meeting agendas", () => {
  test("renewals, awards, planned solicitations and budget items are told apart", () => {
    expect(agendaSignal("Resolution to renew the janitorial services contract with ABC Cleaning for one year in the amount of $184,000")).toEqual({ kind: "renewal", amount: 184000 });
    expect(agendaSignal("Authorize the City Manager to execute a contract with XYZ Paving for street resurfacing, $1.2 million")).toEqual({ kind: "award", amount: 1200000 });
    expect(agendaSignal("Authorization to issue a Request for Proposals for IT managed services")).toEqual({ kind: "solicitation", amount: null });
    expect(agendaSignal("Ordinance to appropriate $750,000 for the Capital Improvement Program for fleet replacement")).toEqual({ kind: "budget", amount: 750000 });
  });
  test("routine business is not a signal", () => {
    expect(agendaSignal("Approval of the minutes of the October 13 meeting")).toBeNull();
    expect(agendaSignal("Rezoning request for 123 Main Street")).toBeNull();
    expect(agendaSignal("Employment agreement for the City Attorney")).toBeNull();
    expect(agendaSignal("Budget amendment of $4,000 for office supplies")).toBeNull();
    expect(agendaSignal("")).toBeNull();
    expect(agendaSignal(null)).toBeNull();
  });
  test("the largest dollar amount in the text is read, with units", () => {
    expect(amountIn("$45,000 the first year and $1.5 million over five years")).toBe(1500000);
    expect(amountIn("not to exceed $750K")).toBe(750000);
    expect(amountIn("no money here")).toBeNull();
  });
  test("the Legistar addresses are built for the public Web API", () => {
    expect(legistarEventsUrl("alexandria", "2026-11-01", "2026-12-01")).toBe(
      "https://webapi.legistar.com/v1/alexandria/events?$filter=EventDate%20ge%20datetime'2026-11-01'%20and%20EventDate%20lt%20datetime'2026-12-01'&$orderby=EventDate&$top=60",
    );
    expect(legistarItemsUrl("alexandria", 4821)).toBe("https://webapi.legistar.com/v1/alexandria/events/4821/eventitems");
  });
});

describe("teams outreach email", () => {
  const m = outreachEmail({
    kind: "teams",
    business: "Example Systems LLC",
    bidId: 0,
    bidTitle: "212 federal IT services contracts in Virginia end in the next 12 months",
    buyer: "trade=it-services&state=VA",
    due: "2026-12-14",
    tradeLabel: "IT services",
    place: "Virginia",
    postalAddress: "100 Main St, Richmond VA 23219",
    unsubscribeUrl: "https://www.contrax.company/api/outreach/unsubscribe?t=abc",
    contactId: 9,
  });
  test("leads with the real count, links the free view and the teams page, and names no price", () => {
    expect(m.subject).toBe("212 federal IT services contracts in Virginia end in the next 12 months");
    expect(m.text).toContain("https://www.contrax.company/recompetes?trade=it-services&state=VA&utm_source=email&utm_medium=outreach&utm_campaign=bid_outreach_teams&oc=9");
    expect(m.text).toContain("https://www.contrax.company/teams?utm_source=email");
    expect(m.text).not.toContain("$");
    expect(m.text).toContain("100 Main St, Richmond VA 23219");
    expect(m.text).toContain("https://www.contrax.company/api/outreach/unsubscribe?t=abc");
  });
  test("a malformed query falls back to the plain page", () => {
    expect(teamsRecompetesPath("trade=it-services&state=VA")).toBe("/recompetes?trade=it-services&state=VA");
    expect(teamsRecompetesPath("x=1")).toBe("/recompetes");
    expect(teamsRecompetesPath(null)).toBe("/recompetes");
  });
});

// Owner 2026-11-14 ("do that"): a weekday batch to companies with a government sales team.
import { readFileSync } from "node:fs";

describe("teams outreach schedule", () => {
  const job = readFileSync("src/jobs/teams-outreach.ts", "utf8");
  const wf = readFileSync(".github/workflows/teams-outreach.yml", "utf8");
  test("a scheduled run takes the day's market and queues drafts; a hand run still needs apply", () => {
    expect(wf).toContain('- cron: "47 10 * * 1-5"');
    expect(wf).toContain("(github.event_name == 'schedule' || inputs.apply) && 'true' || 'false'");
    expect(wf).toContain("SENDS NOTHING");
    expect(job).toContain("teamsMarketFor(Date.now() / 86_400_000)");
  });
  test("the rotation covers ten markets and every one is a real state and trade", () => {
    const list = job.slice(job.indexOf("TEAMS_ROTATION"), job.indexOf("];", job.indexOf("TEAMS_ROTATION")));
    const pairs = [...list.matchAll(/\["([A-Z]{2})", "([a-z-]+)"\]/g)].map((m) => [m[1], m[2]]);
    expect(pairs.length).toBe(10);
    for (const [, trade] of pairs) expect(["it-services", "construction"]).toContain(trade);
    expect(new Set(pairs.map((p) => p.join(":"))).size).toBe(10);
  });
});

// Owner 2026-11-14: "cut small contractors to 0 a day since they never answer or buy".
import { DAILY_CONTRACTOR_FIRST_EMAILS, DAILY_FIRST_EMAILS } from "./outreach";

describe("daily contractor outreach is off", () => {
  test("the scheduled run queues no contractor first emails; a hand-run focus batch keeps its ceiling", () => {
    expect(DAILY_CONTRACTOR_FIRST_EMAILS).toBe(0);
    expect(DAILY_FIRST_EMAILS).toBe(30);
    const prepare = readFileSync("src/jobs/outreach-prepare.ts", "utf8");
    expect(prepare).toContain("if (DAILY_CONTRACTOR_FIRST_EMAILS <= 0) {");
    // The focus branch returns before the daily loop, so it is untouched.
    expect(prepare.indexOf("if (FOCUS_STATE && FOCUS_TRADE) {")).toBeLessThan(prepare.indexOf("if (DAILY_CONTRACTOR_FIRST_EMAILS <= 0) {"));
    expect(prepare).toContain("queueForBid(key, b, constructionOutreachTrade(b.title), seenHosts, DAILY_FIRST_EMAILS - queued)");
  });
});
