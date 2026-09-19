/**
 * Contrax Grants — State Grants TEST SUPPORT (part 2).
 *
 * Shared fixtures + the real-DB guard for the state-grants suites. NOTHING in
 * the application imports this file: it exists so the integration suites use the
 * REAL parser, the REAL runner and the REAL schema rather than an imitation of
 * them, and so the schema guard is written once.
 *
 * DATA DISCIPLINE (unchanged from part 1): every row a suite writes carries a
 * SYNTHETIC state code (ZZ / ZY / MD), so teardown can only ever delete rows the
 * suite created. A real state's rows are never read, updated or deleted here —
 * except by the VA assertions, which only READ.
 *
 * SCHEMA: migration 043 is applied in production. A database without the three
 * tables only gets them when the operator opts in
 * (`STATE_GRANTS_TEST_PROVISION_SCHEMA=1`, i.e. `bun run
 * test:state-grants:integration`), and then only the DDL the migration file
 * itself contains.
 */
import { readFileSync } from "node:fs";
import { sql as dbFactory } from "~/db";
import {
  classifyStateGrant,
  type SourceGrantRecord,
  type StateGrantConnector,
} from "~/lib/state-grants/connector";
import { parseVirginiaGrantsPage } from "~/lib/state-grants/connectors/virginia";

export const HEALTHY_STATE = "ZZ";
export const SIBLING_STATE = "ZY";
export const REFUSED_STATE = "MD";

/**
 * The search suite's deterministic corpus lives under MARYLAND's code, and the
 * choice is deliberate:
 *   - MD is a REAL US state code, so the search API's own state validation
 *     accepts it (a synthetic code like ZZ would be rejected as invalid — which
 *     is the correct behaviour and is tested separately);
 *   - MD is `unavailable` in the registry, so no production sync will ever write
 *     rows there, and the rows below are written ONLY by an injected connector
 *     inside the test process;
 *   - the suite deletes them again in afterAll.
 */
export const SEARCH_FIXTURE_STATE = "MD";

/** The clock every synthetic fixture is written with. */
export const FIXTURE_NOW = new Date("2026-09-19T12:00:00Z");

export const HAS_DB = !!process.env.DATABASE_URL;
export const PROVISION = process.env.STATE_GRANTS_TEST_PROVISION_SCHEMA === "1";

const MIGRATION_SQL = readFileSync(
  new URL("../../../db/migrations/043_state_grants.sql", import.meta.url),
  "utf8",
);

export async function tablesPresent(): Promise<boolean> {
  if (!HAS_DB) return false;
  const db = dbFactory();
  const rows = (await db`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('state_grant_opportunities', 'state_grant_sync_runs', 'state_grant_registry')
  `) as { n: number }[];
  return Number(rows[0]?.n ?? 0) === 3;
}

async function provisionSchema(): Promise<void> {
  const db = dbFactory();
  const statements = MIGRATION_SQL.split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await db`${db.unsafe(statement)}`;
  }
}

/**
 * True when the suite can run against the real database. Skips LOUDLY (never
 * silently) when the tables are absent and provisioning was not opted into.
 */
export async function ensureStateGrantsTables(): Promise<boolean> {
  if (!HAS_DB) return false;
  let present = await tablesPresent();
  if (!present && PROVISION) {
    await provisionSchema();
    present = await tablesPresent();
  }
  if (!present) {
    console.warn(
      `[state-grants] SKIPPED: the state grants tables are absent.\n` +
        `  Apply the migration (owner-approved): bun run db/migrations/run-043.ts\n` +
        `  ...or let the suite provision them: STATE_GRANTS_TEST_PROVISION_SCHEMA=1 bun test src/lib/state-grants`,
    );
  }
  return present;
}

/** Deletes ONLY synthetic-code rows: opportunities + their run history. */
export async function deleteSyntheticStateRows(codes: readonly string[]): Promise<void> {
  if (!HAS_DB) return;
  const list = codes.map((c) => c.toUpperCase()).join(",");
  const db = dbFactory();
  await db`
    DELETE FROM state_grant_opportunities
    WHERE state_code = ANY(string_to_array(${list}::text, ','))
  `;
  await db`
    DELETE FROM state_grant_sync_runs
    WHERE state_code = ANY(string_to_array(${list}::text, ','))
  `;
}

// ── Synthetic fixtures ──────────────────────────────────────────────────────

export interface FixtureRow {
  slug: string;
  title: string;
  opened?: string;
  opens?: string;
  closes?: string;
  closed?: string;
  when?: string;
}

/** A synthetic state's page in the exact shape the Virginia connector parses. */
export function fixturePage(rows: readonly FixtureRow[]): string {
  const blocks = rows
    .map(
      (r) => `
<p class="wp-block-paragraph"><a href="https://vatc.org/grants/${r.slug}/" target="_blank"><strong>${r.title}</strong></a></p>
<ul class="wp-block-list">
${r.opened || r.closes || r.closed ? `<li><strong>${r.opened ? "Opened:" : "Opens:"}</strong> ${r.opened ?? r.closes} <strong>${r.closed ? "Closed:" : "Closes:"}</strong> ${r.closed ?? r.closes}</li>` : ""}
${r.when ? `<li><strong>When:</strong> ${r.when}</li>` : ""}
</ul>`,
    )
    .join("\n<hr class='wp-block-separator'/>\n");
  return `<html><body><article><div class="entry-content">${blocks}</div></article></body></html>`;
}

/** A connector that serves a fixed page through the REAL Virginia parser. */
export function syntheticConnector(
  stateCode: string,
  page: () => string,
): StateGrantConnector<string> {
  return {
    id: `itest-${stateCode.toLowerCase()}`,
    stateCode,
    stateName: `Test ${stateCode}`,
    sourceUrl: "https://vatc.org/grants/",
    officialHost: "www.vatc.org",
    sourceValidationTest: "itest",
    async fetch() {
      const body = page();
      if (body.startsWith("FETCH_FAIL")) throw new Error(body.slice(11).trim() || "boom");
      return body;
    },
    parse(raw: string) {
      return parseVirginiaGrantsPage(raw).map((r) => ({ ...r, stateCode }));
    },
    classify(record: SourceGrantRecord, now: Date | number = new Date()) {
      return classifyStateGrant(record, now);
    },
  };
}

/**
 * The search suite's fixture corpus, written with FIXTURE_NOW (2026-09-19):
 *
 *   md-alpha    opened 2026-01-05, closed 2026-03-19   → closed
 *   md-beta     opens  2026-12-01, closes 2026-12-31   → forecast (estimate)
 *   md-gamma    year-round, no deadline                → open (ongoing)
 *   md-delta    opened 2026-01-05, closes 2026-12-31   → open, real deadline
 *   md-epsilon  opened 2026-02-10, closes 2026-02-20   → closed
 *
 * So the stored picture is 2 open / 1 forecast / 2 closed, and one of the open
 * rows (md-delta) carries a deadline the calendar will overtake — which is what
 * the read-time freshness test reads against a later clock.
 */
export const SEARCH_FIXTURE_ROWS: readonly FixtureRow[] = [
  {
    slug: "md-alpha",
    title: "MD Alpha Workforce Grant",
    opened: "January 5, 2026",
    closed: "March 19, 2026",
  },
  {
    slug: "md-beta",
    title: "MD Beta Tourism Program",
    opens: "December 1, 2026",
    closes: "December 31, 2026",
  },
  {
    slug: "md-gamma",
    title: "MD Gamma Rolling Program",
    when: "Year-round; no time limitations",
  },
  {
    slug: "md-delta",
    title: "MD Delta Rural Grant",
    opened: "January 5, 2026",
    closes: "December 31, 2026",
  },
  {
    slug: "md-epsilon",
    title: "MD Epsilon Water Grant",
    opened: "February 10, 2026",
    closes: "February 20, 2026",
  },
];
