/**
 * Integration tests — STATE GRANT SEARCH + COVERAGE against the REAL database
 * (part 2, re-cut for the corrected model; owner R1 2026-09-19).
 *
 * WHAT THIS FILE PROVES (the things only a real database can show):
 *   - the registry gate: a synthetic state's stored rows are NEVER served by the
 *     default search, because no unvalidated state is ever queried;
 *   - status filters, normalized-column filters, pagination and totals agree with
 *     the rows the store actually holds;
 *   - multi-source identity survives to the API: the same external id from two
 *     sources is two rows, both served and distinguishable by source;
 *   - a record the source stopped publishing (stale sweep) and a record with
 *     ambiguous/estimated dates are both `unverified`, and a `status=open`
 *     filter can never return them;
 *   - read-time expiry: an `open` row whose published deadline has passed is
 *     served, filtered and counted as `closed`;
 *   - coverage reads the DERIVED registry (VA = `limited`) and ignores the
 *     synthetic states entirely.
 *
 * SAFETY: this file writes ONLY synthetic state codes (ZZ, ZY) under `itest-`
 * source keys and NEVER syncs or inserts Virginia. The live VA corpus is
 * snapshotted before the suite and asserted byte-identical afterwards, and every
 * synthetic row is removed in afterAll.
 *
 * RUN ONE AT A TIME: this suite shares the configured database with anyone else
 * running it — CI and a local `bun test` on the same DATABASE_URL must not
 * overlap. Two concurrent runs each clean up the other's `itest-` rows in
 * beforeEach/afterEach, so both see wrong counts (a real CI red on 2026-09-20
 * whose only cause was a local run racing the CI run). Serialize them.
 *
 * NETWORK: none. The connectors here read an in-process fixture string; only the
 * database is touched (and the whole file is skipped without DATABASE_URL).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sql as dbFactory } from "~/db";
import {
  classifyStateGrant,
  type SourceGrantRecord,
  type StateGrantConnector,
} from "~/lib/state-grants/connector";
import { parseVirginiaGrantsPage } from "~/lib/state-grants/connectors/virginia";
import { VIRGINIA_SOURCE_URL } from "~/lib/state-grants/connectors/virginia";
import { runStateGrantSync } from "~/lib/state-grants/sync.server";
import { buildStateGrantCoverage } from "~/lib/state-grants/coverage.server";
import {
  runStateGrantSearch,
  type StateGrantSearchDeps,
} from "~/lib/state-grants/search.server";
import {
  latestSuccessfulStateSync,
  queryStateGrants,
  stateGrantEffectiveStatusCounts,
} from "~/lib/state-grants/store.server";
import { migrationStatements } from "../../../db/migrations/sql-statements";

const HAS_DB = !!process.env.DATABASE_URL;
const PROVISION = process.env.STATE_GRANTS_TEST_PROVISION_SCHEMA === "1";

const HEALTHY_STATE = "ZZ";
const SIBLING_STATE = "ZY";
const SOURCE_A = "itest-zz-a";
const SOURCE_B = "itest-zz-b";
const SOURCE_SIBLING = "itest-zy-a";

const MIGRATION_FILES = [
  "../../../db/migrations/043_state_grants.sql",
  "../../../db/migrations/044_state_grants_sources.sql",
];

const STATE_TABLES = [
  "state_grant_opportunities",
  "state_grant_sync_runs",
  "state_grant_registry",
  "state_grant_sources",
];

async function tablesPresent(): Promise<boolean> {
  if (!HAS_DB) return false;
  const db = dbFactory();
  const rows = (await db`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY(${STATE_TABLES})
  `) as { n: number }[];
  return Number(rows[0]?.n ?? 0) === STATE_TABLES.length;
}

async function provisionSchema(): Promise<void> {
  const db = dbFactory();
  for (const file of MIGRATION_FILES) {
    const sqlText = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const statement of migrationStatements(sqlText)) {
      await db`${db.unsafe(statement)}`;
    }
  }
}

let HAS_TABLES = await tablesPresent();
if (HAS_DB && !HAS_TABLES && PROVISION) {
  await provisionSchema();
  HAS_TABLES = await tablesPresent();
}
const DB_READY = HAS_DB && HAS_TABLES;
if (HAS_DB && !HAS_TABLES) {
  console.warn(
    "[state-grants search integration] SKIPPED: the state grants tables are absent.\n" +
      "  Apply the migrations (owner-approved) or run with STATE_GRANTS_TEST_PROVISION_SCHEMA=1.",
  );
}

/** The clock every classification in this file is evaluated against. */
const FIXTURE_NOW = new Date("2026-09-19T12:00:00Z");

interface FixtureRow {
  slug: string;
  title: string;
  opened?: string;
  opens?: string;
  closes?: string;
  closed?: string;
  when?: string;
  eligible?: string;
  geography?: string;
  focus?: string;
  award?: string;
  total?: string;
  match?: string;
  desc?: string;
}

/** A synthetic state's page, in the shape the Virginia connector parses. */
function fixturePage(rows: FixtureRow[]): string {
  const blocks = rows
    .map((r) => {
      const lines: string[] = [];
      if (r.desc) lines.push(`<li>${r.desc}</li>`);
      if (r.eligible) lines.push(`<li><strong>Who is eligible:</strong> ${r.eligible}</li>`);
      if (r.geography) lines.push(`<li><strong>Eligible geography:</strong> ${r.geography}</li>`);
      if (r.focus) lines.push(`<li><strong>Marketing focus:</strong> ${r.focus}</li>`);
      if (r.opened || r.opens || r.closes || r.closed) {
        lines.push(
          `<li><strong>${r.opened ? "Opened:" : "Opens:"}</strong> ${r.opened ?? r.opens} ` +
            `<strong>${r.closed ? "Closed:" : "Closes:"}</strong> ${r.closed ?? r.closes}</li>`,
        );
      }
      if (r.when) lines.push(`<li><strong>When:</strong> ${r.when}</li>`);
      if (r.award) lines.push(`<li><strong>Max Award:</strong> ${r.award}</li>`);
      if (r.total) lines.push(`<li><strong>Total funding:</strong> ${r.total}</li>`);
      if (r.match) lines.push(`<li><strong>Match:</strong> ${r.match}</li>`);
      return (
        `<p class="wp-block-paragraph"><a href="https://vatc.org/grants/${r.slug}/">` +
        `<strong>${r.title}</strong></a></p>\n<ul class="wp-block-list">${lines.join("\n")}</ul>`
      );
    })
    .join("\n<hr class='wp-block-separator'/>\n");
  return `<html><body><article><div class="entry-content">${blocks}</div></article></body></html>`;
}

/**
 * A connector that serves a fixed page. Its `id` is the SOURCE key, which is
 * what makes two synthetic sources in one state two distinct publishers.
 */
function syntheticConnector(
  stateCode: string,
  page: () => string,
  sourceKey = SOURCE_A,
): StateGrantConnector<string> {
  return {
    id: sourceKey,
    stateCode,
    stateName: `Test ${stateCode}`,
    sourceName: `Test ${stateCode} source ${sourceKey}`,
    agency: `Test ${stateCode} agency ${sourceKey}`,
    sourceUrl: VIRGINIA_SOURCE_URL,
    officialHost: "www.vatc.org",
    sourceValidationTest: "itest",
    async fetch() {
      return page();
    },
    parse(raw: string) {
      // The REAL Virginia parser: this exercises the production parsing path.
      return parseVirginiaGrantsPage(raw).map((r) => ({ ...r, stateCode, sourceKey }));
    },
    classify(record: SourceGrantRecord, now: Date | number = new Date()) {
      return classifyStateGrant(record, now);
    },
  };
}

/** Search deps whose only deviation from production is the validated set. */
function searchDeps(validated: readonly string[]): StateGrantSearchDeps {
  return {
    queryStateGrants,
    latestSuccessfulStateSync,
    validatedStateCodes: () => validated,
  };
}

/** The REAL production gate: only states the registry validates (VA today). */
const PRODUCTION_DEPS: StateGrantSearchDeps = {
  queryStateGrants,
  latestSuccessfulStateSync,
  validatedStateCodes: () => ["VA"],
};

async function resetSynthetic(): Promise<void> {
  if (!DB_READY) return;
  const db = dbFactory();
  await db`DELETE FROM state_grant_opportunities WHERE state_code IN (${HEALTHY_STATE}, ${SIBLING_STATE})`;
  await db`DELETE FROM state_grant_sync_runs WHERE state_code IN (${HEALTHY_STATE}, ${SIBLING_STATE})`;
  await db`DELETE FROM state_grant_sources WHERE source_key LIKE 'itest-%'`;
}

async function snapshotVaRows(): Promise<string[]> {
  const db = dbFactory();
  const rows = (await db`
    SELECT id::text AS id, status, updated_at::text AS updated_at, COALESCE(last_seen_at::text, '-') AS last_seen
    FROM state_grant_opportunities WHERE state_code = 'VA'
    ORDER BY id
  `) as { id: string; status: string; updated_at: string; last_seen: string }[];
  return rows.map((r) => `${r.id}|${r.status}|${r.updated_at}|${r.last_seen}`).sort();
}

const vaBaseline: string[] = DB_READY ? await snapshotVaRows() : [];

afterAll(async () => {
  await resetSynthetic();
});

/** A search result body, or a failed expectation naming the real status. */
function bodyOf(outcome: Awaited<ReturnType<typeof runStateGrantSearch>>) {
  if (outcome.status !== 200) {
    throw new Error(`expected 200, got ${outcome.status}: ${JSON.stringify(outcome.body)}`);
  }
  return outcome.body;
}

describe.skipIf(!DB_READY)("state grants search + coverage (real DB)", () => {
  // alpha closed (past-tense) · beta upcoming · gamma rolling · delta unverified
  // (no dates at all) · epsilon open · zeta unverified (estimate only)
  const rows: FixtureRow[] = [
    {
      slug: "alpha",
      title: "Alpha Grant",
      opened: "January 5, 2026",
      closed: "March 19, 2026",
      eligible: "Small businesses in ZZ",
      geography: "ZZ statewide",
      focus: "Tourism",
      award: "$12,000",
      total: "$120,000 available",
      match: "1:1 cash match",
    },
    {
      slug: "beta",
      title: "Beta Grant",
      opens: "December 1, 2026",
      closes: "December 31, 2026",
      eligible: "Nonprofit organizations",
      geography: "ZZ",
      focus: "Arts",
      award: "$5,000 - $25,000",
    },
    {
      slug: "gamma",
      title: "Gamma Program",
      when: "Year-round; no time limitations",
      focus: "Tourism",
    },
    {
      slug: "delta",
      title: "Delta Initiative",
      desc: "Details to be announced by the agency",
    },
    {
      slug: "epsilon",
      title: "Epsilon Grant",
      opened: "January 2, 2026",
      closes: "December 31, 2026",
      eligible: "Small businesses",
      award: "$30,000",
      match: "Cash match required",
    },
    {
      slug: "zeta",
      title: "Zeta Grant",
      closes: "Est. March 1, 2027",
      eligible: "Localities",
    },
  ];
  const pageV1 = () => fixturePage(rows);
  const connectorA = (page: () => string) => syntheticConnector(HEALTHY_STATE, page, SOURCE_A);

  test("the registry gate: an unvalidated state's stored rows are never served", async () => {
    await resetSynthetic();
    const sync = await runStateGrantSync(HEALTHY_STATE, {
      connector: connectorA(pageV1),
      now: FIXTURE_NOW,
    });
    expect(sync.status).toBe("ok");
    expect(sync.fetchedCount).toBe(6);
    // The rows really are in the store...
    expect((await queryStateGrants({ stateCode: HEALTHY_STATE })).totalCount).toBe(6);

    // ...and the PRODUCTION gate still serves none of them: ZZ is unavailable, so
    // the default search narrows to the validated set (VA) and says so. Note that
    // the proof is NOT an empty answer: production really does hold VA's own corpus
    // (synced 2026-09-19), and a validated state's rows ARE served. The proof is
    // that the narrowed scope is exactly the validated set, so no unvalidated
    // state's stored row can appear — and the ZZ rows above are in the store while
    // none of them is in this answer.
    const unscoped = bodyOf(await runStateGrantSearch({}, FIXTURE_NOW, PRODUCTION_DEPS));
    expect(unscoped.statesIncluded.join(",")).toBe("VA");
    expect(unscoped.totalCount).toBe(vaBaseline.length);
    expect(unscoped.records.every((r) => r.stateCode === "VA")).toBe(true);
    expect(unscoped.records.some((r) => r.stateCode === HEALTHY_STATE)).toBe(false);

    // A caller that NAMES a real but unvalidated state (NC) gets the same empty,
    // explained answer: the state is never reported as included — it appears in
    // the uncovered notice only — and no row is invented for it.
    const asked = bodyOf(
      await runStateGrantSearch({ stateCodes: ["NC"] }, FIXTURE_NOW, PRODUCTION_DEPS),
    );
    expect(asked.totalCount).toBe(0);
    expect(asked.records.length).toBe(0);
    expect(asked.statesIncluded.length).toBe(0);
    // The echoed scope is the narrowed one, so the uncovered state cannot be read
    // back out of the applied filters either.
    expect(asked.filters.stateCodes).toEqual([]);
    expect(asked.uncoveredStates).toEqual(["NC"]);
    expect(asked.uncoveredNotice).toContain("North Carolina (NC)");
    expect(asked.uncoveredNotice).toContain("no records are invented");
    expect(asked.asOf).toBeNull();

    // With the gate told ZZ is validated (what the synthetic fixture stands in
    // for), the same rows are served — so the emptiness above was the gate, not
    // a missing corpus.
    const served = bodyOf(
      await runStateGrantSearch({}, FIXTURE_NOW, searchDeps([HEALTHY_STATE])),
    );
    expect(served.totalCount).toBe(6);
    expect(served.statesMatched.join(",")).toBe(HEALTHY_STATE);
    expect(served.asOf).not.toBeNull();
    const alpha = served.records.find((r) => r.externalId === "alpha");
    expect(alpha?.sourceKey).toBe(SOURCE_A);
    expect(alpha?.sourceName).toBe(`Test ${HEALTHY_STATE} source ${SOURCE_A}`);
    expect(alpha?.sourceLabel).toBe(`Test ${HEALTHY_STATE} agency ${SOURCE_A} — vatc.org`);
    expect(alpha?.sourceUrl).toBe(VIRGINIA_SOURCE_URL);
    expect(alpha?.categories.join(",")).toBe("Tourism");
    expect(alpha?.eligibleApplicants).toContain("Small businesses");
    expect(alpha?.eligibleGeography).toBe("ZZ statewide");
    expect(alpha?.matchingRequirement).toContain("cash match");
    expect(alpha?.totalFunding).toContain("120,000");
    // zeta publishes no funding/matching/geography value: "Not specified".
    const zeta = served.records.find((r) => r.externalId === "zeta");
    expect(zeta?.totalFunding).toBe("Not specified");
    expect(zeta?.matchingRequirement).toBe("Not specified");
    expect(zeta?.eligibleGeography).toBe("Not specified");
    expect(zeta?.categories.length).toBe(0);
  });

  test("every status filter returns exactly the rows that hold it, in the serving order", async () => {
    const outcome = bodyOf(
      await runStateGrantSearch({}, FIXTURE_NOW, searchDeps([HEALTHY_STATE])),
    );
    expect(outcome.records.map((r) => r.status)).toEqual([
      "open",
      "upcoming",
      "rolling",
      "closed",
      "unverified",
      "unverified",
    ]);
    expect(outcome.countLabel).toBe("6 stored records");

    const expected: Record<string, string[]> = {
      open: ["epsilon"],
      upcoming: ["beta"],
      rolling: ["gamma"],
      closed: ["alpha"],
      unverified: ["delta", "zeta"],
    };
    for (const [status, ids] of Object.entries(expected)) {
      const filtered = bodyOf(
        await runStateGrantSearch(
          { status: status as never },
          FIXTURE_NOW,
          searchDeps([HEALTHY_STATE]),
        ),
      );
      expect(filtered.totalCount).toBe(ids.length);
      expect(filtered.records.map((r) => r.externalId).sort()).toEqual([...ids].sort());
      for (const record of filtered.records) expect(record.status).toBe(status as never);
      // The count always equals the rows the store reports for that filter.
      const stored = await queryStateGrants({
        stateCode: HEALTHY_STATE,
        status: status as never,
        now: FIXTURE_NOW,
      });
      expect(filtered.totalCount).toBe(stored.totalCount);
      expect(stored.totalCount).toBe(filtered.returned);
    }
  });

  test("the normalized-column filters work, and never match a value the agency did not publish", async () => {
    const search = async (filters: Record<string, unknown>) =>
      bodyOf(
        await runStateGrantSearch(
          { ...filters },
          FIXTURE_NOW,
          searchDeps([HEALTHY_STATE]),
        ),
      );
    const ids = (body: ReturnType<typeof bodyOf>) => body.records.map((r) => r.externalId).sort();

    expect(ids(await search({ eligibleApplicants: "small business" }))).toEqual(["alpha", "epsilon"]);
    expect(ids(await search({ eligibleGeography: "statewide" }))).toEqual(["alpha"]);
    expect(ids(await search({ categories: ["tourism"] }))).toEqual(["alpha", "gamma"]);
    expect(ids(await search({ categories: ["Arts", "Tourism"] }))).toEqual(["alpha", "beta", "gamma"]);
    expect(ids(await search({ awardRange: "5,000" }))).toEqual(["beta"]);
    expect(ids(await search({ totalFunding: "120,000" }))).toEqual(["alpha"]);
    expect(ids(await search({ matchingRequirement: "cash match" }))).toEqual(["alpha", "epsilon"]);
    // Award bounds are compared against the amounts the agency published: a
    // single amount is the ceiling, so `awardMinAmount` uses the ceiling.
    expect(ids(await search({ awardMinAmount: 20000 }))).toEqual(["beta", "epsilon"]);
    // ...and a row with NO published minimum can never satisfy an upper bound.
    expect(ids(await search({ awardMaxAmount: 10000 }))).toEqual(["beta"]);
    // A value nobody published matches nothing — the gap is never filled.
    expect(ids(await search({ eligibleGeography: "Nowhere" }))).toEqual([]);
    expect(ids(await search({ matchingRequirement: "in-kind" }))).toEqual([]);
    expect((await search({ eligibleGeography: "Nowhere" })).totalCount).toBe(0);
  });

  test("pagination: totals are the store's, and pages never overlap", async () => {
    const pageOne = bodyOf(
      await runStateGrantSearch(
        { limit: 2, offset: 0 },
        FIXTURE_NOW,
        searchDeps([HEALTHY_STATE]),
      ),
    );
    const pageTwo = bodyOf(
      await runStateGrantSearch(
        { limit: 2, offset: 2 },
        FIXTURE_NOW,
        searchDeps([HEALTHY_STATE]),
      ),
    );
    expect(pageOne.totalCount).toBe(6);
    expect(pageTwo.totalCount).toBe(6);
    expect(pageOne.returned).toBe(2);
    expect(pageTwo.returned).toBe(2);
    expect(pageOne.hasMore).toBe(true);
    expect(pageOne.records.map((r) => r.id)).not.toEqual(pageTwo.records.map((r) => r.id));
    const lastPage = bodyOf(
      await runStateGrantSearch(
        { limit: 2, offset: 6 },
        FIXTURE_NOW,
        searchDeps([HEALTHY_STATE]),
      ),
    );
    expect(lastPage.returned).toBe(0);
    expect(lastPage.totalCount).toBe(6);
    expect(lastPage.hasMore).toBe(false);
  });

  test("the same external id from two sources is TWO rows, both served and distinguishable", async () => {
    const second = await runStateGrantSync(HEALTHY_STATE, {
      connector: syntheticConnector(HEALTHY_STATE, pageV1, SOURCE_B),
      now: FIXTURE_NOW,
    });
    expect(second.status).toBe("ok");
    const body = bodyOf(
      await runStateGrantSearch({}, FIXTURE_NOW, searchDeps([HEALTHY_STATE])),
    );
    expect(body.totalCount).toBe(12);
    const alphas = body.records.filter((r) => r.externalId === "alpha");
    expect(alphas.length).toBe(2);
    expect(new Set(alphas.map((r) => r.sourceKey))).toEqual(new Set([SOURCE_A, SOURCE_B]));
    expect(new Set(alphas.map((r) => r.sourceLabel))).toEqual(
      new Set([
        `Test ${HEALTHY_STATE} agency ${SOURCE_A} — vatc.org`,
        `Test ${HEALTHY_STATE} agency ${SOURCE_B} — vatc.org`,
      ]),
    );
    // A source filter narrows to one publisher, and only that publisher's rows.
    const onlyA = bodyOf(
      await runStateGrantSearch(
        { sourceKeys: [SOURCE_A] },
        FIXTURE_NOW,
        searchDeps([HEALTHY_STATE]),
      ),
    );
    expect(onlyA.totalCount).toBe(6);
    for (const record of onlyA.records) expect(record.sourceKey).toBe(SOURCE_A);
    await resetSynthetic();
    await runStateGrantSync(HEALTHY_STATE, { connector: connectorA(pageV1), now: FIXTURE_NOW });
  });

  test("a record the source stopped publishing reads unverified through the API", async () => {
    // gamma (rolling) and delta (no dates) disappear from the source's next page.
    const pageV3 = () => fixturePage([rows[0], rows[1], rows[4], rows[5]]);
    const sync = await runStateGrantSync(HEALTHY_STATE, {
      connector: connectorA(pageV3),
      now: FIXTURE_NOW,
    });
    expect(sync.status).toBe("ok");
    expect(sync.staledCount).toBeGreaterThan(0);
    const search = async (status: string) =>
      bodyOf(
        await runStateGrantSearch(
          { status: status as never },
          FIXTURE_NOW,
          searchDeps([HEALTHY_STATE]),
        ),
      );
    expect((await search("rolling")).totalCount).toBe(0);
    const unverified = await search("unverified");
    expect(unverified.records.map((r) => r.externalId).sort()).toEqual(["delta", "gamma", "zeta"]);
    for (const record of unverified.records) {
      expect(record.closeDate).toBeNull();
    }
  });

  test("ambiguous and estimated dates are unverified, and can never appear as open", async () => {
    const search = async (filters: Record<string, unknown>) =>
      bodyOf(
        await runStateGrantSearch(
          { ...filters },
          FIXTURE_NOW,
          searchDeps([HEALTHY_STATE]),
        ),
      );
    const zeta = (await search({ term: "Zeta" })).records[0];
    expect(zeta.status).toBe("unverified");
    expect(zeta.closeDate).toBeNull();
    expect(zeta.estimatedCloseDate).toBe("2027-03-01");
    expect(zeta.deadline.value).toContain("source estimate — not a posted closing date");

    const delta = (await search({ term: "Delta" })).records[0];
    expect(delta.status).toBe("unverified");
    expect(delta.closeDate).toBeNull();
    expect(delta.deadline.value).toContain("No confirmable dates");

    // Neither can be reached by an `open` filter, and neither can be reached by a
    // *date-driven* closed filter either: their dates are not deadlines at all.
    const open = await search({ status: "open" });
    expect(open.records.map((r) => r.externalId)).not.toContain("zeta");
    expect(open.records.map((r) => r.externalId)).not.toContain("delta");
    const closed = await search({ status: "closed" });
    expect(closed.records.map((r) => r.externalId).sort()).toEqual(["alpha"]);
  });

  test("read-time expiry: an open row past its deadline is served, filtered and counted closed", async () => {
    // Epsilon is open at the sync time (closes 2026-12-31); a read after that day
    // must expire it without any write at all.
    const later = new Date("2027-06-01T12:00:00Z");
    const before = bodyOf(
      await runStateGrantSearch({}, FIXTURE_NOW, searchDeps([HEALTHY_STATE])),
    );
    const after = bodyOf(
      await runStateGrantSearch({}, later, searchDeps([HEALTHY_STATE])),
    );
    expect(before.records.find((r) => r.externalId === "epsilon")?.status).toBe("open");
    const expired = after.records.find((r) => r.externalId === "epsilon");
    expect(expired?.status).toBe("closed");
    expect(expired?.closeDate).toBe("2026-12-31");
    expect(expired?.deadline.label).toBe("Closed");

    const openAfter = bodyOf(
      await runStateGrantSearch(
        { status: "open" },
        later,
        searchDeps([HEALTHY_STATE]),
      ),
    );
    expect(openAfter.totalCount).toBe(0);
    const closedAfter = bodyOf(
      await runStateGrantSearch(
        { status: "closed" },
        later,
        searchDeps([HEALTHY_STATE]),
      ),
    );
    expect(closedAfter.records.map((r) => r.externalId).sort()).toEqual(["alpha", "epsilon"]);
    // The store's own counts agree with the search, on the same clock.
    const counts = await stateGrantEffectiveStatusCounts(HEALTHY_STATE, later);
    expect(counts.open).toBe(0);
    expect(counts.closed).toBe(2);
    expect(counts.total).toBe(6);
  });

  test("coverage reads the derived registry: VA is limited, and synthetic states are invisible", async () => {
    const outcome = await buildStateGrantCoverage(FIXTURE_NOW);
    if (outcome.status !== 200) throw new Error(`expected 200, got ${outcome.status}`);
    const payload = outcome.body;
    expect(payload.states.length).toBe(51);
    expect(payload.counts.validated).toBe(34);
    expect(payload.counts.limited).toBe(34);
    expect(payload.counts.connected).toBe(0);
    expect(payload.counts.unavailable).toBe(17);
    expect(payload.validated.map((v) => v.stateCode)).toEqual(["AL", "AZ", "AR", "CA", "CO", "DE", "DC", "FL", "HI", "IL", "IN", "IA", "KS", "KY", "ME", "MD", "MN", "MT", "NE", "NV", "NH", "NM", "ND", "OK", "PA", "RI", "SC", "TN", "TX", "UT", "VT", "VA", "WA", "WV"]);
    const virginia = payload.validated.find((v) => v.stateCode === "VA")!;
    expect(virginia.tier).toBe("limited");
    expect(virginia.note).toContain("not statewide coverage");
    expect(virginia.sourceUrl).toBe(VIRGINIA_SOURCE_URL);
    // The synthetic ZZ corpus is NOT counted anywhere: coverage only reads states
    // the registry validates, and VA's own corpus is untouched by this suite.
    expect(virginia.recordCount).toBe(vaBaseline.length);
    expect(virginia.statusCounts.total).toBe(vaBaseline.length);
    expect(JSON.stringify(payload)).not.toContain("forecast");
    expect(payload.headline).toContain("34 of 51 states have a validated source");
  });

  test("isolation: the suite never wrote a Virginia row, and every state table is intact", async () => {
    const db = dbFactory();
    const rows = (await db`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${STATE_TABLES})
    `) as { n: number }[];
    expect(Number(rows[0].n)).toBe(STATE_TABLES.length);
    expect(await snapshotVaRows()).toEqual(vaBaseline);
    expect((await queryStateGrants({ stateCode: "VA" })).totalCount).toBe(vaBaseline.length);
    // The DEFAULT search (the production gate) still serves only validated states.
    const production = bodyOf(await runStateGrantSearch({ status: "open" }, FIXTURE_NOW, PRODUCTION_DEPS));
    for (const record of production.records) expect(record.stateCode).toBe("VA");
  });
});
