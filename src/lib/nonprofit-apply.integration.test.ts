/**
 * Nonprofit Free phase 2 — the migration-046 ↔ src/db/schema.sql BOOTSTRAP suite.
 *
 * WHY THIS EXISTS. `src/db/schema.sql` is the canonical merged schema (`bun run
 * src/db/setup.ts` applies it to a fresh database), and the migration runner is hand-run
 * only. Migration 046 adds the second half of the nonprofit tier's data model — the
 * append-only review table, the `released_at` release column and the PARTIAL unique index
 * on `ein` that makes a released EIN claimable again, plus the digest columns. If the
 * mirror drifts, a fresh database silently lacks the owner's rule. This suite builds a
 * THROWAWAY database from schema.sql ALONE and asserts the behaviour the owner's decision
 * actually requires:
 *
 *   1. a released EIN (`released_at` set) is claimable by a DIFFERENT user, while an
 *      attached EIN still permits exactly one free org account (23505 on the second);
 *   2. UNIQUE (user_id) still allows only one application row per user;
 *   3. an EIN round-trips as a nine-character STRING with its leading zero intact;
 *   4. the review table accepts the owner's five actions and rejects anything else.
 *
 * HOW IT IS PROVIDED (and why it never touches the team's data). It only issues
 * `CREATE DATABASE` / `DROP DATABASE` for a name containing "nonprofit_bootstrap", and
 * every table it reads is inside that database. The database is dropped in `afterAll`,
 * including after a failed run.
 *
 * OPT-IN, CI-ONLY (the standing hard rule). The sandbox `DATABASE_URL` IS production, so
 * this suite does NOTHING unless BOTH `DATABASE_URL` and `NONPROFIT_TEST_PROVISION_SCHEMA=1`
 * are set — the same explicit opt-in discipline as the state-grants integration half. CI
 * is its only judge.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { schemaStatements } from "../../db/migrations/sql-statements";
import { decideNonprofitVerification } from "~/lib/nonprofit-verification.server";

const ENABLED =
  process.env.NONPROFIT_TEST_PROVISION_SCHEMA === "1" && !!process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_URL ?? "";
const SCHEMA_DB = "contrax_nonprofit_bootstrap_schema";
const SCHEMA_FILE = "../../src/db/schema.sql";

type Db = ReturnType<typeof neon>;

function urlForDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

let SCHEMA_URL: string | null = null;
let READY = false;
let STATEMENT_COUNT = 0;

if (ENABLED) {
  const admin = neon(ADMIN_URL);
  await admin`DROP DATABASE IF EXISTS ${admin.unsafe(SCHEMA_DB)} WITH (FORCE)`;
  await admin`CREATE DATABASE ${admin.unsafe(SCHEMA_DB)}`;
  SCHEMA_URL = urlForDatabase(ADMIN_URL, SCHEMA_DB);
  const db = neon(SCHEMA_URL);
  const statements = schemaStatements(readFileSync(new URL(SCHEMA_FILE, import.meta.url), "utf8"));
  STATEMENT_COUNT = statements.length;
  for (const statement of statements) {
    try {
      await db`${db.unsafe(statement)}`;
    } catch (error) {
      throw new Error(
        `[nonprofit bootstrap] schema.sql failed on: ${statement.split("\n")[0].slice(0, 120)} :: ${
          (error as Error).message
        }`,
      );
    }
  }
  READY = true;
  console.log(
    `[nonprofit bootstrap] built ${SCHEMA_DB} from src/db/schema.sql alone (${STATEMENT_COUNT} statements)`,
  );
} else {
  console.warn(
    "[nonprofit bootstrap] SKIPPED: set DATABASE_URL and NONPROFIT_TEST_PROVISION_SCHEMA=1 " +
      "to build a throwaway database from src/db/schema.sql. This suite is CI-only on purpose " +
      "(the default sandbox DATABASE_URL IS production).",
  );
}

afterAll(async () => {
  if (!ENABLED) return;
  const admin = neon(ADMIN_URL);
  try {
    await admin`DROP DATABASE IF EXISTS ${admin.unsafe(SCHEMA_DB)} WITH (FORCE)`;
  } catch (error) {
    console.warn(`[nonprofit bootstrap] could not drop ${SCHEMA_DB}: ${(error as Error).message}`);
  }
});

/** Insert one application row, returning the error code when it is rejected. */
async function insertApplication(
  db: Db,
  input: {
    userId: number;
    ein: string;
    released?: boolean;
    orgName?: string;
  },
): Promise<string | null> {
  try {
    await db`
      INSERT INTO nonprofit_applications (
        user_id, org_name, work_email, website, ein, state, contact_name, contact_role,
        org_use_confirmed, status, released_at
      ) VALUES (
        ${input.userId}, ${input.orgName ?? "Test Org"}, 'work@example.org', NULL, ${input.ein},
        'ME', 'Test Applicant', 'Director', TRUE, 'manual_review',
        ${input.released ? new Date().toISOString() : null}
      )
    `;
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? String((error as Error).message);
  }
}

describe.if(ENABLED)("migration 046 on a schema.sql-only database", () => {
  test("the EIN unique index is PARTIAL (released rows do not hold the EIN)", async () => {
    const db = neon(SCHEMA_URL as string);
    const rows = (await db`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'nonprofit_applications_ein_key'
    `) as { indexdef: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toContain("WHERE (released_at IS NULL)");
    // UNIQUE (user_id) is untouched.
    const userKey = (await db`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'nonprofit_applications_user_id_key'
    `) as { indexdef: string }[];
    expect(userKey).toHaveLength(1);
  });

  test("the review table and the digest columns exist", async () => {
    const db = neon(SCHEMA_URL as string);
    const columns = (await db`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'nonprofit_application_reviews'
    `) as { column_name: string }[];
    const names = columns.map((row) => row.column_name).sort();
    expect(names).toEqual(
      [
        "action",
        "actor_email",
        "actor_user_id",
        "application_id",
        "created_at",
        "id",
        "internal_note",
        "new_status",
        "prior_status",
        "reason_code",
      ].sort(),
    );
    const digest = (await db`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'nonprofit_applications'
        AND column_name IN ('released_at', 'digest_opt_out_at', 'digest_unsubscribe_token_hash', 'digest_last_sent_at')
    `) as { column_name: string }[];
    expect(digest).toHaveLength(4);
  });

  test("a released EIN is claimable by a DIFFERENT user; an attached one is not", async () => {
    const db = neon(SCHEMA_URL as string);
    await db`INSERT INTO users (email, password_hash) VALUES ('a@example.org', 'x'), ('b@example.org', 'x'), ('c@example.org', 'x')`;
    // 010488538 is the Maine Association of Nonprofits — a REAL EIN with a leading zero,
    // which is exactly why the column is a string.
    expect(await insertApplication(db, { userId: 1, ein: "010488538", released: true })).toBeNull();
    // The released row no longer holds the EIN: a different user may claim it.
    expect(await insertApplication(db, { userId: 2, ein: "010488538" })).toBeNull();
    // ...and now it IS held: a third account is refused by the partial unique index.
    expect(await insertApplication(db, { userId: 3, ein: "010488538" })).toBe("23505");
    // A RELEASED row for the same EIN is outside the partial index, so it is allowed —
    // the release is what makes a second, independent application possible.
    expect(await insertApplication(db, { userId: 3, ein: "010488538", released: true })).toBeNull();
  });

  test("UNIQUE (user_id) still allows one application row per user", async () => {
    const db = neon(SCHEMA_URL as string);
    // user 2 already has a row; a different EIN does not help.
    expect(await insertApplication(db, { userId: 2, ein: "142007220" })).toBe("23505");
  });

  test("the EIN round-trips as a nine-character string, leading zero intact", async () => {
    const db = neon(SCHEMA_URL as string);
    const rows = (await db`
      SELECT ein, length(ein) AS len FROM nonprofit_applications WHERE user_id = 2
    `) as { ein: string; len: number }[];
    expect(rows[0]!.ein).toBe("010488538");
    expect(rows[0]!.len).toBe(9);
  });

  test("the review table accepts the owner's actions and rejects anything else", async () => {
    const db = neon(SCHEMA_URL as string);
    const rows = (await db`
      SELECT id FROM nonprofit_applications WHERE user_id = 2
    `) as { id: number }[];
    const applicationId = rows[0]!.id;
    await db`
      INSERT INTO nonprofit_application_reviews
        (application_id, action, actor_user_id, actor_email, reason_code, internal_note, prior_status, new_status)
      VALUES (${applicationId}, 'approve', 1, 'user:1 <admin@example.org>', 'clear-match', 'checked', 'manual_review', 'approved')
    `;
    const saved = (await db`
      SELECT action, actor_user_id, prior_status, new_status FROM nonprofit_application_reviews
      WHERE application_id = ${applicationId}
    `) as { action: string; actor_user_id: number; prior_status: string; new_status: string }[];
    expect(saved).toHaveLength(1);
    expect(saved[0]!.action).toBe("approve");
    // An action outside the owner's list is refused by the CHECK constraint.
    let rejected = "";
    try {
      await db`
        INSERT INTO nonprofit_application_reviews
          (application_id, action, actor_user_id, actor_email, prior_status, new_status)
        VALUES (${applicationId}, 'archive', 1, 'user:1 <admin@example.org>', 'approved', 'archived')
      `;
    } catch (error) {
      rejected = String((error as Error).message);
    }
    expect(rejected).toMatch(/check constraint|violates/i);
  });

  /**
   * QA §2.53. The unit suite proves "one row per user" by SOURCE TEXT; this proves it by
   * BEHAVIOUR, through the writer that production actually runs
   * (`saveNonprofitApplicationOutcome`: INSERT … ON CONFLICT (user_id) DO UPDATE).
   *
   * HOW IT REACHES THE THROWAWAY DATABASE. `~/db`'s `sql()` resolves `process.env.DATABASE_URL`
   * LAZILY on every call (deliberately — the site must build without a database), so pointing
   * that variable at the throwaway schema database for the duration of this one test is
   * enough; the original value is restored in `finally`, and every other query in this file
   * keeps using its own `neon(SCHEMA_URL)` handle. The alternative — hand-writing the
   * upsert — is exactly the thing that would have to be trusted instead of tested.
   */
  test("a re-apply updates ONE row and the first grant date survives", async () => {
    const db = neon(SCHEMA_URL as string);
    const users = (await db`
      INSERT INTO users (email, password_hash) VALUES ('reapply-one-row@example.org', 'x')
      RETURNING id
    `) as { id: number }[];
    const userId = users[0]!.id;

    const previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = SCHEMA_URL as string;
    try {
      const { saveNonprofitApplicationOutcome } = await import("./nonprofit-apply.server");
      const input = {
        userId,
        orgName: "Reapply Test Org",
        workEmail: "reapply@example.org",
        website: null,
        ein: "142007299",
        state: "ME",
        contactName: "Test Applicant",
        contactRole: "Director",
        orgUseConfirmed: true,
        now: new Date("2026-09-21T12:00:00.000Z"),
      };

      // 1. A first application that AUTO-APPROVES — this is what stamps `granted_at`.
      const approved = decideNonprofitVerification({
        einFormat: "ok",
        ein: "142007299",
        einFound: true,
        nameTier: "A",
        submittedNameNormalized: "REAPPLY TEST ORG",
        matchedBmfName: "REAPPLY TEST ORG",
        bmfStatus: "01",
        bmfSubsection: "03",
        bmfGroupNo: "0000",
        bmfPostingDate: "2026-09-08",
        onRevocationList: false,
        inPub78: true,
        pub78DeductibilityCode: "PC",
        now: input.now,
      });
      expect(approved.decision).toBe("auto_approve");
      const first = await saveNonprofitApplicationOutcome(approved, input);
      expect(first.ok).toBe(true);
      const grantedRow = (await db`
        SELECT id, status, granted_at FROM nonprofit_applications WHERE user_id = ${userId}
      `) as { id: number; status: string; granted_at: string | null }[];
      expect(grantedRow).toHaveLength(1);
      expect(grantedRow[0]!.status).toBe("approved");
      expect(grantedRow[0]!.granted_at).not.toBeNull();

      // 2. The SAME user re-applies and does NOT get approved this time (the EIN is not in
      //    the mirror → manual review, a null `granted_at`).
      const manual = decideNonprofitVerification({
        einFormat: "ok",
        ein: "142007299",
        einFound: false,
        submittedNameNormalized: "REAPPLY TEST ORG RENAMED",
        now: input.now,
      });
      expect(manual.status).toBe("manual_review");
      const second = await saveNonprofitApplicationOutcome(manual, {
        ...input,
        orgName: "Reapply Test Org Renamed",
      });
      expect(second.ok).toBe(true);
      expect(second.applicationId).toBe(first.applicationId);

      const after = (await db`
        SELECT id, status, granted_at, org_name, ein,
               (SELECT COUNT(*) FROM nonprofit_applications WHERE user_id = ${userId}) AS rows_for_user
        FROM nonprofit_applications WHERE user_id = ${userId}
      `) as {
        id: number;
        status: string;
        granted_at: string | null;
        org_name: string;
        ein: string;
        rows_for_user: string | number;
      }[];
      // ONE row, the SAME row, updated in place — the audit trail cannot fork.
      expect(after).toHaveLength(1);
      expect(Number(after[0]!.rows_for_user)).toBe(1);
      expect(after[0]!.id).toBe(first.applicationId);
      expect(after[0]!.status).toBe("manual_review");
      expect(after[0]!.org_name).toBe("Reapply Test Org Renamed");
      // `granted_at = COALESCE(EXCLUDED.granted_at, nonprofit_applications.granted_at)`: the
      // historical first-grant date survives a later verdict that grants nothing.
      expect(after[0]!.granted_at).not.toBeNull();
      expect(new Date(after[0]!.granted_at as string).toISOString()).toBe(
        new Date(grantedRow[0]!.granted_at as string).toISOString(),
      );
      // The EIN round-trips through the writer as a nine-character STRING (owner rule:
      // never an integer — 3% of real EINs start with a zero).
      expect(after[0]!.ein).toBe("142007299");
      expect(String(after[0]!.ein).length).toBe(9);
    } finally {
      process.env.DATABASE_URL = previousUrl;
    }
  });
});
