/**
 * Contrax Grants — FRESH-DATABASE BOOTSTRAP test (owner R3 order, 2026-09-19).
 *
 * WHAT THIS PROVES, AND WHY IT EXISTS
 *   src/db/schema.sql is the canonical merged schema (`bun run src/db/setup.ts`
 *   applies it to a fresh database). Migrations 043 + 044 built the SAME four
 *   state-grant tables in production, but 044 was deliberately not mirrored into
 *   schema.sql in R1 — an acknowledged gap. A database built from schema.sql alone
 *   therefore still held the 043-era shape (state-keyed identity, no
 *   `state_grant_sources`, no normalized columns, `forecast` in the status CHECK),
 *   which cannot support the part 2 search + coverage surface at all.
 *
 *   This test closes that gap with proof, in three steps:
 *     1. it builds TWO throwaway databases inside the configured Postgres
 *        instance — one from src/db/schema.sql ALONE, one from migrations
 *        043 + 044 — and asserts the four state-grant tables are structurally
 *        IDENTICAL (columns + ordinal positions, indexes, constraints);
 *     2. it seeds the (migration-seeded) Virginia source through the REAL sync
 *        path on the schema.sql-only database, which is only possible if the
 *        044 identity (`ON CONFLICT (source_id, external_id)`, the FK, NOT NULL,
 *        the 5-value status CHECK, the normalized columns) is really there;
 *     3. it runs the part 2 surface — the search server (the five-status
 *        taxonomy, a normalized-column filter, pagination/totals), the registry
 *        gate's fail-closed answer for an uncovered state, and the coverage
 *        server (the ladder counts + the "not nationwide" language) — against
 *        that database.
 *   A green run means "a fresh database from schema.sql is enough to run part 2".
 *
 * HOW THE DATABASE IS PROVIDED (and why it is not the team's own data)
 *   The test never touches the configured database's tables. It only issues
 *   `CREATE DATABASE` / `DROP DATABASE` for two names that contain "bootstrap", and
 *   every table it reads is inside those. Both databases are dropped in `afterAll`,
 *   including after a failed run of the suite.
 *   The store reads `process.env.DATABASE_URL` lazily on every query, so pointing
 *   the PRODUCTION code at the throwaway database is a matter of setting that
 *   variable for the duration of one test body — `onBootstrapDatabase()` does
 *   exactly that, and always restores the previous value, so no other suite (and
 *   no later query) can ever see the temporary URL.
 *
 * NETWORK: the only host contacted is the configured Postgres instance. No
 * connector here fetches anything — the fixture pages are in-process strings (the
 * same discipline as the R1/R2 suites: the live Virginia source-validation test is
 * separate and opt-in).
 *
 * SKIPPING: without DATABASE_URL the whole file skips loudly, like every other
 * DB-backed suite in this repo.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { sql as dbFactory } from "~/db";
import {
  classifyStateGrant,
  type SourceGrantRecord,
  type StateGrantConnector,
} from "~/lib/state-grants/connector";
import {
  virginiaConnector,
  VIRGINIA_SOURCE_URL,
} from "~/lib/state-grants/connectors/virginia";
import { parseVirginiaGrantsPage } from "~/lib/state-grants/connectors/virginia";
import { validatedStates } from "~/lib/state-grants/registry";
import {
  runStateGrantSearch,
  type StateGrantSearchDeps,
} from "~/lib/state-grants/search.server";
import { buildStateGrantCoverage } from "~/lib/state-grants/coverage.server";
import { runStateGrantSync } from "~/lib/state-grants/sync.server";
import {
  latestSuccessfulStateSync,
  queryStateGrants,
  readStateRegistry,
  readStateSources,
  syncStateRegistry,
} from "~/lib/state-grants/store.server";
import { listStates } from "~/lib/state-grants/registry";
import {
  migrationStatements,
  schemaStatements,
} from "../../../db/migrations/sql-statements";

const HAS_DB = !!process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_URL ?? "";

/** The two throwaway databases. The prefix makes them obvious in a listing. */
const SCHEMA_DB = "contrax_r3_bootstrap_schema";
const MIGRATION_DB = "contrax_r3_bootstrap_migrations";

const SCHEMA_FILE = "../../../src/db/schema.sql";
const MIGRATION_FILES = [
  "../../../db/migrations/043_state_grants.sql",
  "../../../db/migrations/044_state_grants_sources.sql",
];

const STATE_TABLES = [
  "state_grant_opportunities",
  "state_grant_sources",
  "state_grant_sync_runs",
  "state_grant_registry",
];

type Db = ReturnType<typeof neon>;

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

/** The same connection string, pointed at another database on the same host. */
function urlForDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/** Executes statements in order, naming the failing one (never a bare fragment). */
async function applyStatements(db: Db, statements: string[], label: string): Promise<void> {
  for (const statement of statements) {
    try {
      await db`${db.unsafe(statement)}`;
    } catch (e) {
      throw new Error(
        `[state-grants bootstrap] ${label} failed on: ${statement.split("\n")[0].slice(0, 120)} :: ${
          (e as Error).message
        }`,
      );
    }
  }
}

let SCHEMA_URL: string | null = null;
let MIGRATION_URL: string | null = null;
let SCHEMA_STATEMENT_COUNT = 0;
let READY = false;

if (HAS_DB) {
  const admin = neon(ADMIN_URL);
  await admin`DROP DATABASE IF EXISTS ${admin.unsafe(SCHEMA_DB)} WITH (FORCE)`;
  await admin`DROP DATABASE IF EXISTS ${admin.unsafe(MIGRATION_DB)} WITH (FORCE)`;
  await admin`CREATE DATABASE ${admin.unsafe(SCHEMA_DB)}`;
  await admin`CREATE DATABASE ${admin.unsafe(MIGRATION_DB)}`;
  SCHEMA_URL = urlForDatabase(ADMIN_URL, SCHEMA_DB);
  MIGRATION_URL = urlForDatabase(ADMIN_URL, MIGRATION_DB);

  // 1. A database built from src/db/schema.sql ALONE — the file the owner's
  //    bootstrap path applies, and the thing under test here.
  const schemaSql = read(SCHEMA_FILE);
  const schemaList = schemaStatements(schemaSql);
  SCHEMA_STATEMENT_COUNT = schemaList.length;
  await applyStatements(neon(SCHEMA_URL), schemaList, "src/db/schema.sql");

  // 2. A database built by applying migrations 043 then 044 — the shape this
  //    test compares the mirror against (no dependence on what the configured
  //    database happens to contain).
  const migrationDb = neon(MIGRATION_URL);
  for (const file of MIGRATION_FILES) {
    await applyStatements(migrationDb, migrationStatements(read(file)), file);
  }

  READY = true;
  console.log(
    `[state-grants bootstrap] built ${SCHEMA_DB} from src/db/schema.sql alone ` +
      `(${SCHEMA_STATEMENT_COUNT} statements) and ${MIGRATION_DB} from 043 + 044`,
  );
} else {
  console.warn(
    "[state-grants bootstrap] SKIPPED: DATABASE_URL is not set, so no throwaway " +
      "database can be built. Run with DATABASE_URL set (see the R3 report).",
  );
}

/**
 * Runs `body` with the production code pointed at the schema.sql-only database,
 * and restores the previous DATABASE_URL no matter what happens.
 */
async function onBootstrapDatabase<T>(body: () => Promise<T>): Promise<T> {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = SCHEMA_URL as string;
  try {
    return await body();
  } finally {
    process.env.DATABASE_URL = previous;
  }
}

afterAll(async () => {
  if (!HAS_DB) return;
  process.env.DATABASE_URL = ADMIN_URL;
  const admin = neon(ADMIN_URL);
  for (const name of [SCHEMA_DB, MIGRATION_DB]) {
    try {
      await admin`DROP DATABASE IF EXISTS ${admin.unsafe(name)} WITH (FORCE)`;
    } catch (e) {
      console.warn(`[state-grants bootstrap] could not drop ${name}: ${(e as Error).message}`);
    }
  }
});

/** The structural fingerprint of the four state tables, for an exact diff. */
async function structureOf(db: Db) {
  const columns = (await db`
    SELECT table_name, ordinal_position, column_name, data_type, is_nullable,
           COALESCE(column_default, '-') AS column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY(${STATE_TABLES})
    ORDER BY table_name, ordinal_position
  `) as unknown[];
  const indexes = (await db`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = ANY(${STATE_TABLES})
    ORDER BY tablename, indexname
  `) as unknown[];
  const constraints = (await db`
    SELECT c.relname AS table_name, con.conname, con.contype,
           pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY(${STATE_TABLES})
    ORDER BY c.relname, con.conname
  `) as unknown[];
  return {
    tables_touched: STATE_TABLES.filter((t) => true).length,
    columns: JSON.parse(JSON.stringify(columns)),
    indexes: JSON.parse(JSON.stringify(indexes)),
    constraints: JSON.parse(JSON.stringify(constraints)),
  };
}

// ── Fixtures ────────────────────────────────────────────────────────────────
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

/** A Virginia-shaped page: the shape the REAL VTC parser reads. */
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

// alpha closed · beta upcoming · gamma rolling · delta unverified · epsilon open
const ROWS: FixtureRow[] = [
  {
    slug: "bootstrap-closed",
    title: "Bootstrap Closed Grant",
    opened: "January 5, 2026",
    closed: "March 19, 2026",
    eligible: "Small businesses in Virginia",
    geography: "Virginia statewide",
    focus: "Agriculture",
  },
  {
    slug: "bootstrap-upcoming",
    title: "Bootstrap Upcoming Grant",
    opens: "December 1, 2026",
    closes: "December 31, 2026",
    eligible: "Nonprofit organizations",
    geography: "Virginia",
    focus: "Arts",
    award: "$5,000 - $25,000",
  },
  {
    slug: "bootstrap-rolling",
    title: "Bootstrap Rolling Program",
    when: "Year-round; no time limitations",
    focus: "Tourism",
  },
  {
    slug: "bootstrap-unverified",
    title: "Bootstrap Unverified Initiative",
    desc: "Details to be announced by the agency",
  },
  {
    slug: "bootstrap-open",
    title: "Bootstrap Open Grant",
    opened: "January 2, 2026",
    closes: "December 31, 2026",
    eligible: "Small businesses",
    geography: "Virginia statewide",
    focus: "Tourism",
    award: "$30,000",
    total: "$90,000 available",
    match: "Cash match required",
  },
];

const FIXTURE_PAGE = fixturePage(ROWS);

/**
 * The REAL Virginia connector with its page replaced by an in-process fixture —
 * so the row is written through the production connector/parse/classify/write
 * path with zero network traffic, and resolves to the MIGRATION-SEEDED source
 * (`va-vtc-grants`), which is itself part of what this test is checking.
 */
const FIXTURE_CONNECTOR: StateGrantConnector<string> = {
  ...virginiaConnector,
  async fetch() {
    return FIXTURE_PAGE;
  },
};

const SECOND_SOURCE_ID = "bootstrap-va-secondary";
/** A second publisher in the same state that reuses one external id verbatim. */
const SECOND_SOURCE_CONNECTOR: StateGrantConnector<string> = {
  ...virginiaConnector,
  id: SECOND_SOURCE_ID,
  sourceName: "Virginia Tourism Corporation — Grants (bootstrap secondary)",
  async fetch() {
    return fixturePage([
      {
        slug: "bootstrap-open",
        title: "Bootstrap Open Grant (second publisher)",
        opened: "January 2, 2026",
        closes: "December 31, 2026",
      },
    ]);
  },
};

/** The PRODUCTION search deps — the real gate (VA is the only validated state). */
const PRODUCTION_DEPS: StateGrantSearchDeps = {
  queryStateGrants,
  latestSuccessfulStateSync,
  validatedStateCodes: validatedStates,
};

function bodyOf(outcome: Awaited<ReturnType<typeof runStateGrantSearch>>) {
  if (outcome.status !== 200) {
    throw new Error(`expected 200, got ${outcome.status}: ${JSON.stringify(outcome.body)}`);
  }
  return outcome.body;
}

describe.skipIf(!READY)("state grants — fresh database built from src/db/schema.sql alone", () => {
  test("schema.sql alone yields the same state-grant structures as migrations 043 + 044", async () => {
    const fromSchema = neon(SCHEMA_URL as string);
    const fromMigrations = neon(MIGRATION_URL as string);
    expect(SCHEMA_STATEMENT_COUNT).toBeGreaterThan(0);

    // The four tables exist, and their structure (columns in order, indexes,
    // constraints) is byte-identical to the migration-built database. This is the
    // assertion that would have caught the R1 gap.
    expect(await structureOf(fromSchema)).toEqual(await structureOf(fromMigrations));

    // Spelled out, so a regression reads as a sentence rather than as a diff:
    const columns = (await fromSchema`
      SELECT column_name, is_nullable, COALESCE(column_default, '-') AS column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'state_grant_opportunities'
      ORDER BY ordinal_position
    `) as { column_name: string; is_nullable: string; column_default: string }[];
    const names = columns.map((c) => c.column_name);
    for (const added of [
      "source_id",
      "last_seen_at",
      "eligible_applicants",
      "eligible_geography",
      "categories",
      "award_range",
      "award_min_amount",
      "award_max_amount",
      "total_funding",
      "matching_requirement",
    ]) {
      expect(names).toContain(added);
    }
    expect(columns.find((c) => c.column_name === "source_id")?.is_nullable).toBe("NO");
    expect(columns.find((c) => c.column_name === "categories")?.column_default).toBe("'{}'::text[]");
    // 044 appended its columns AFTER 043's, and the mirror must match that order.
    expect(names.slice(-10)).toEqual([
      "source_id",
      "last_seen_at",
      "eligible_applicants",
      "eligible_geography",
      "categories",
      "award_range",
      "award_min_amount",
      "award_max_amount",
      "total_funding",
      "matching_requirement",
    ]);

    const indexes = (await fromSchema`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'state_grant_opportunities'
      ORDER BY indexname
    `) as { indexname: string; indexdef: string }[];
    const indexNames = indexes.map((i) => i.indexname);
    expect(indexNames).toContain("state_grant_opportunities_source_external_key");
    expect(indexNames).toContain("idx_state_grant_opportunities_source_status");
    // The old state-keyed identity is gone — and with it the overwrite bug.
    expect(indexNames).not.toContain("state_grant_opportunities_state_external_key");
    expect(
      indexes.find((i) => i.indexname === "state_grant_opportunities_source_external_key")?.indexdef,
    ).toContain("(source_id, external_id)");

    const statusCheck = (await fromSchema`
      SELECT pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      WHERE c.relname = 'state_grant_opportunities' AND con.conname = 'state_grant_opportunities_status_check'
    `) as { definition: string }[];
    expect(statusCheck.length).toBe(1);
    for (const status of ["open", "upcoming", "rolling", "closed", "unverified"]) {
      expect(statusCheck[0].definition).toContain(status);
    }
    expect(statusCheck[0].definition).not.toContain("forecast");

    const registryCheck = (await fromSchema`
      SELECT pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      WHERE c.relname = 'state_grant_registry' AND con.conname = 'state_grant_registry_status_check'
    `) as { definition: string }[];
    for (const tier of ["unavailable", "limited", "curated", "connected"]) {
      expect(registryCheck[0].definition).toContain(tier);
    }

    // The VA source is seeded, with the migration's own values, and the corpus
    // starts empty (nothing is invented at bootstrap).
    const sources = (await fromSchema`
      SELECT source_key, state_code, name, agency, official_url, official_host
      FROM state_grant_sources
    `) as Record<string, string>[];
    expect(sources).toEqual([
      {
        source_key: "va-vtc-grants",
        state_code: "VA",
        name: "Virginia Tourism Corporation — Grants and Funding",
        agency: "Virginia Tourism Corporation",
        official_url: "https://www.vatc.org/grants/",
        official_host: "www.vatc.org",
      },
    ]);
    const opportunities = (await fromSchema`
      SELECT count(*)::int AS n FROM state_grant_opportunities
    `) as { n: number }[];
    expect(Number(opportunities[0].n)).toBe(0);
  });

  test("the seeded source and a real sync run work on a schema.sql-only database", async () => {
    await onBootstrapDatabase(async () => {
      const result = await runStateGrantSync("VA", {
        connector: FIXTURE_CONNECTOR,
        now: FIXTURE_NOW,
      });
      expect(result.status).toBe("ok");
      expect(result.sourceId).toBeTruthy();
      expect(result.fetchedCount).toBe(5);
      expect(result.insertedCount).toBe(5);
      expect(result.collisions).toEqual([]);
      expect(result.countsAgree).toBe(true);

      // The run resolved the MIGRATION-SEEDED source row, not a copy of it.
      const sources = await readStateSources("VA");
      expect(sources.length).toBe(1);
      expect(sources[0].sourceKey).toBe("va-vtc-grants");
      expect(sources[0].agency).toBe("Virginia Tourism Corporation");
      expect(sources[0].officialHost).toBe("www.vatc.org");
      expect(sources[0].officialUrl).toBe(VIRGINIA_SOURCE_URL);

      const stored = await queryStateGrants({ stateCode: "VA" });
      expect(stored.totalCount).toBe(5);
      const byId = new Map(stored.results.map((r) => [r.externalId, r]));
      expect(byId.get("bootstrap-closed")!.status).toBe("closed");
      expect(byId.get("bootstrap-upcoming")!.status).toBe("upcoming");
      expect(byId.get("bootstrap-rolling")!.status).toBe("rolling");
      expect(byId.get("bootstrap-unverified")!.status).toBe("unverified");
      expect(byId.get("bootstrap-open")!.status).toBe("open");
      for (const row of stored.results) {
        expect(row.sourceId).toBe(result.sourceId);
        expect(row.sourceKey).toBe("va-vtc-grants");
        expect(row.lastSeenAt).toBeTruthy();
      }
      // Normalized fields survived the write path.
      const open = byId.get("bootstrap-open")!;
      expect(open.eligibleApplicants).toBe("Small businesses");
      expect(open.eligibleGeography).toBe("Virginia statewide");
      expect(open.categories).toEqual(["Tourism"]);
      expect(open.awardRange).toBe("$30,000");
      expect(open.awardMaxAmount).toBe(30000);
      expect(open.totalFunding).toContain("90,000");
      expect(open.matchingRequirement).toBe("Cash match required");
      const unverified = byId.get("bootstrap-unverified")!;
      expect(unverified.closeDate).toBeNull();
      expect(unverified.eligibleApplicants).toBe("Not specified");
      expect(unverified.categories).toEqual([]);

      // The 044 identity: the SAME external id from a SECOND source is a SECOND
      // row — this upsert cannot run at all unless the (source_id, external_id)
      // unique index exists, and it must not collapse the two publishers.
      const second = await runStateGrantSync("VA", {
        connector: SECOND_SOURCE_CONNECTOR,
        now: FIXTURE_NOW,
      });
      expect(second.status).toBe("ok");
      expect(second.sourceId).not.toBe(result.sourceId);
      const both = await queryStateGrants({ stateCode: "VA" });
      expect(both.totalCount).toBe(6);
      const shared = both.results.filter((r) => r.externalId === "bootstrap-open");
      expect(shared.length).toBe(2);
      expect(new Set(shared.map((r) => r.sourceKey))).toEqual(
        new Set(["va-vtc-grants", SECOND_SOURCE_ID]),
      );

      // Put the corpus back to the one-publisher state, so every later test in
      // this file reads the same five rows it would have read without this proof
      // (nothing outside this throwaway database is touched).
      const db = dbFactory();
      await db`
        DELETE FROM state_grant_opportunities
        WHERE state_code = 'VA' AND source_id <> ${result.sourceId}::uuid
      `;
      await db`DELETE FROM state_grant_sources WHERE source_key = ${SECOND_SOURCE_ID}`;
      const restored = await queryStateGrants({ stateCode: "VA" });
      expect(restored.totalCount).toBe(5);
      expect(restored.results.every((r) => r.sourceKey === "va-vtc-grants")).toBe(true);
    });
  });

  test("the part 2 search works: the five-status taxonomy, a normalized filter, pagination", async () => {
    await onBootstrapDatabase(async () => {
      const body = bodyOf(await runStateGrantSearch({}, FIXTURE_NOW, PRODUCTION_DEPS));
      expect(body.ok).toBe(true);
      expect(body.totalCount).toBe(5);
      expect(body.countExact).toBe(true);
      // Every validated state (the landed batch set) is structurally included;
      // the rows in this throwaway DB are all VA fixtures, so only VA matches.
      expect(body.statesIncluded).toEqual(validatedStates());
      expect(body.statesMatched).toEqual(["VA"]);
      expect(body.uncoveredStates).toEqual([]);
      // The freshness stamp comes from the ok run rows the sync wrote.
      expect(body.asOf).not.toBeNull();
      expect(body.records.map((r) => r.status)).toEqual([
        "open",
        "upcoming",
        "rolling",
        "closed",
        "unverified",
      ]);

      // Every status of the owner's taxonomy is reachable by filter, and returns
      // exactly the rows that hold it.
      const expected: Record<string, string[]> = {
        open: ["bootstrap-open"],
        upcoming: ["bootstrap-upcoming"],
        rolling: ["bootstrap-rolling"],
        closed: ["bootstrap-closed"],
      };
      for (const [status, ids] of Object.entries(expected)) {
        const filtered = bodyOf(
          await runStateGrantSearch({ status: status as never }, FIXTURE_NOW, PRODUCTION_DEPS),
        );
        expect(filtered.totalCount).toBe(ids.length);
        expect(filtered.records.map((r) => r.externalId)).toEqual(ids);
      }
      const unverified = bodyOf(
        await runStateGrantSearch({ status: "unverified" }, FIXTURE_NOW, PRODUCTION_DEPS),
      );
      expect(unverified.totalCount).toBe(1);
      expect(unverified.records.map((r) => r.externalId)).toEqual(["bootstrap-unverified"]);
      // There is no `forecast` status to ask for any more.
      const refused = await runStateGrantSearch({ status: "forecast" }, FIXTURE_NOW, PRODUCTION_DEPS);
      expect(refused.status).toBe(400);

      // Normalized columns are REAL columns: filters run in SQL and never match a
      // value the agency did not publish.
      const search = async (filters: Record<string, unknown>) =>
        bodyOf(await runStateGrantSearch({ ...filters }, FIXTURE_NOW, PRODUCTION_DEPS));
      const ids = (body: ReturnType<typeof bodyOf>) =>
        body.records.map((r) => r.externalId).sort();
      expect(ids(await search({ categories: ["tourism"] }))).toEqual([
        "bootstrap-open",
        "bootstrap-rolling",
      ]);
      expect(ids(await search({ eligibleApplicants: "small business" }))).toEqual([
        "bootstrap-closed",
        "bootstrap-open",
      ]);
      expect(ids(await search({ eligibleGeography: "statewide" }))).toEqual([
        "bootstrap-closed",
        "bootstrap-open",
      ]);
      expect(ids(await search({ matchingRequirement: "cash match" }))).toEqual([
        "bootstrap-open",
      ]);
      expect(ids(await search({ totalFunding: "90,000" }))).toEqual(["bootstrap-open"]);
      expect(ids(await search({ awardRange: "5,000" }))).toEqual(["bootstrap-upcoming"]);
      expect(ids(await search({ awardMinAmount: 20000 }))).toEqual([
        "bootstrap-open",
        "bootstrap-upcoming",
      ]);
      expect(ids(await search({ awardMaxAmount: 10000 }))).toEqual(["bootstrap-upcoming"]);
      expect(ids(await search({ eligibleGeography: "Nowhere" }))).toEqual([]);

      // Pagination: totals are the store's, and pages never overlap.
      const pageOne = bodyOf(
        await runStateGrantSearch({ limit: 2, offset: 0 }, FIXTURE_NOW, PRODUCTION_DEPS),
      );
      const pageTwo = bodyOf(
        await runStateGrantSearch({ limit: 2, offset: 2 }, FIXTURE_NOW, PRODUCTION_DEPS),
      );
      expect(pageOne.totalCount).toBe(5);
      expect(pageTwo.totalCount).toBe(5);
      expect(pageOne.returned).toBe(2);
      expect(pageTwo.returned).toBe(2);
      expect(pageOne.hasMore).toBe(true);
      expect(pageOne.records.map((r) => r.id)).not.toEqual(pageTwo.records.map((r) => r.id));
      const lastPage = bodyOf(
        await runStateGrantSearch({ limit: 2, offset: 6 }, FIXTURE_NOW, PRODUCTION_DEPS),
      );
      expect(lastPage.returned).toBe(0);
      expect(lastPage.totalCount).toBe(5);
      expect(lastPage.hasMore).toBe(false);
    });
  });

  test("the registry gate refuses an uncovered state, without inventing a record", async () => {
    await onBootstrapDatabase(async () => {
      const asked = bodyOf(
        await runStateGrantSearch({ stateCodes: ["MD"] }, FIXTURE_NOW, PRODUCTION_DEPS),
      );
      expect(asked.totalCount).toBe(0);
      expect(asked.records.length).toBe(0);
      expect(asked.statesIncluded).toEqual([]);
      expect(asked.statesMatched).toEqual([]);
      expect(asked.filters.stateCodes).toEqual([]);
      expect(asked.uncoveredStates).toEqual(["MD"]);
      expect(asked.uncoveredNotice).toContain("Maryland (MD)");
      expect(asked.uncoveredNotice).toContain("no records are invented");
      expect(asked.asOf).toBeNull();
    });
  });

  test("coverage reads the ladder honestly on a schema.sql-only database", async () => {
    await onBootstrapDatabase(async () => {
      // The registry MIRROR also has to be writable on this schema: the mirror
      // sync writes the derived tiers, so a stale CHECK (e.g. the 043-era
      // unavailable|connected pair) would reject `limited` right here.
      expect(await syncStateRegistry(listStates())).toBe(51);
      const mirrored = await readStateRegistry();
      expect(mirrored.length).toBe(51);
      const vaMirror = mirrored.find((r) => r.stateCode === "VA")!;
      expect(vaMirror.status).toBe("limited");
      expect(mirrored.filter((r) => r.status === "connected").length).toBe(0);
      // Nothing changed, so a second mirror writes nothing at all.
      expect(await syncStateRegistry(listStates())).toBe(0);

      const outcome = await buildStateGrantCoverage(FIXTURE_NOW);
      if (outcome.status !== 200) throw new Error(`expected 200, got ${outcome.status}`);
      const payload = outcome.body;
      expect(payload.headline).toBe(
        "State grant coverage: 6 of 51 states have a validated source (0 connected, 0 curated, 6 limited)",
      );
      expect(payload.counts).toEqual({ total: 51, validated: 6, connected: 0, curated: 0, limited: 6, unavailable: 45 });
      expect(payload.states.length).toBe(51);
      expect(payload.counts.unavailable).toBe(45);
      expect(payload.validated.map((v) => v.stateCode)).toEqual(["AZ", "DE", "HI", "PA", "RI", "VA"]);
      const virginia = payload.validated.find((v) => v.stateCode === "VA")!;
      expect(virginia.tier).toBe("limited");
      expect(virginia.note).toContain("not statewide coverage");
      expect(virginia.sourceUrl).toBe(VIRGINIA_SOURCE_URL);
      // The live counts come from THIS database's rows (5 after the fixture sync).
      expect(virginia.recordCount).toBe(5);
      expect(virginia.statusCounts.total).toBe(5);
      expect(virginia.lastSyncedAt).not.toBeNull();
      expect(virginia.lastRun?.status).toBe("ok");
      // No nationwide claim anywhere, and `forecast` is gone from the payload.
      expect(payload.noNationwideCoverage).toContain("not nationwide coverage");
      expect(JSON.stringify(payload)).not.toContain("forecast");
      expect(payload.ladder.map((r) => r.status)).toEqual([
        "connected",
        "curated",
        "limited",
        "unavailable",
      ]);
    });
  });
});
