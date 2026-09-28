/**
 * Nonprofit signup-source marker (owner-directed 2026-09-28, migration 053) — the
 * deterministic, ZERO-network, ZERO-database half of the proof.
 *
 * WHAT THIS SUITE IS FOR. The marker is a small tracking fix with exactly three moving
 * parts that must never drift apart: (1) the allowlist, (2) the door links that carry
 * `?source=nonprofit_apply`, and (3) the two write/read paths (the signup POST body, the
 * /api/signup INSERT and the admin signups list). A unit test of the allowlist alone would
 * prove none of (2) and (3), so this suite also reads the shipped files and asserts the
 * wiring — the same file-contract technique the nonprofit and funnel-ux suites already use
 * in this repo.
 *
 * The LIVE half (a real POST through the real handler landing the value on a real user row,
 * then teardown) is the separate harness in shared/nonprofit-marker-2026-09-28/, because it
 * needs the production database and therefore must never be part of the default test run.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { migrationStatements } from "../../db/migrations/sql-statements";
import {
  SIGNUP_SOURCE_NONPROFIT_APPLY,
  SIGNUP_SOURCE_NONPROFIT_APPLY_LABEL,
  SIGNUP_SOURCE_VALUES,
  isNonprofitApplySource,
  normalizeSignupSource,
} from "~/lib/signup-source";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

const SIGNUP_PAGE = read("../routes/signup.tsx");
const SIGNUP_API = read("../routes/api/signup.ts");
const ADMIN_SIGNUPS = read("../routes/admin/signups.tsx");
const ADMIN_METRICS_API = read("../routes/api/admin/metrics.ts");
const GRANTS_PAGE = read("../routes/grants.tsx");
const APPLY_PAGE = read("../routes/nonprofit/apply.tsx");
const STATUS_PAGE = read("../routes/nonprofit/status.tsx");
const MIGRATION = read("../../db/migrations/053_signup_source.sql");
const MIGRATION_RUNNER = read("../../db/migrations/run-053.ts");
const SCHEMA = read("../../src/db/schema.sql");

describe("the source family allowlist", () => {
  test("the pre-existing members are unchanged and the nonprofit member is added", () => {
    // Byte-for-byte the six values the inline validator accepted before this change, so no
    // previously-accepted URL stopped working — plus exactly ONE new member.
    expect([...SIGNUP_SOURCE_VALUES]).toEqual([
      "radar",
      "radar_results_unlock",
      "radar_results_cta",
      "autopsy",
      "closing_soon",
      "incumbent",
      "nonprofit_apply",
    ]);
    expect(SIGNUP_SOURCE_NONPROFIT_APPLY).toBe("nonprofit_apply");
    // Repo style: the family is snake_case, not hyphenated.
    expect(SIGNUP_SOURCE_NONPROFIT_APPLY).not.toContain("-");
  });

  test("normalizeSignupSource accepts every member and nothing else", () => {
    for (const value of SIGNUP_SOURCE_VALUES) {
      expect(normalizeSignupSource(value)).toBe(value);
    }
    for (const rejected of [
      undefined,
      null,
      42,
      "",
      " ",
      "hax",
      "nonprofit-apply", // the hyphenated spelling is NOT a member
      "NONPROFIT_APPLY",
      "nonprofit_apply ", // padded — trimmed, so this one IS accepted (see next assertion)
      "<script>",
    ]) {
      const result = normalizeSignupSource(rejected);
      if (rejected === "nonprofit_apply ") expect(result).toBe("nonprofit_apply");
      else expect(result).toBeNull();
    }
  });

  test("only the nonprofit member reads as the nonprofit door", () => {
    expect(isNonprofitApplySource("nonprofit_apply")).toBe(true);
    expect(isNonprofitApplySource("radar")).toBe(false);
    expect(isNonprofitApplySource(null)).toBe(false);
    expect(isNonprofitApplySource("agency")).toBe(false);
    expect(SIGNUP_SOURCE_NONPROFIT_APPLY_LABEL).toBe("Nonprofit apply");
  });
});

describe("the door links carry the marker", () => {
  test("/grants nonprofit CTA carries ?source=nonprofit_apply into the apply page", () => {
    // The door link is the ONE place the marker is introduced on the grants surface.
    expect(GRANTS_PAGE).toContain(
      "href={`/nonprofit/apply?next=%2Fgrants&source=${SIGNUP_SOURCE_NONPROFIT_APPLY}`}",
    );
    expect(GRANTS_PAGE).toContain("~/lib/signup-source");
  });

  test("the nonprofit apply page's signed-out signup CTA carries it into /signup", () => {
    expect(APPLY_PAGE).toContain(
      "href={`/signup?next=${encodeURIComponent(APPLY_PATH)}&source=${SIGNUP_SOURCE_NONPROFIT_APPLY}`}",
    );
    // The sign-in path is NOT touched: signing in is not a signup and records nothing.
    expect(APPLY_PAGE).toContain("href={`/login?next=${encodeURIComponent(APPLY_PATH)}`}");
  });

  test("the status page's apply link carries it too", () => {
    expect(STATUS_PAGE).toContain(
      "href={`/nonprofit/apply?source=${SIGNUP_SOURCE_NONPROFIT_APPLY}`}",
    );
  });
});

describe("/signup forwards the marker and /api/signup is the authority", () => {
  test("the signup page validates through the shared allowlist (not an inline list)", () => {
    expect(SIGNUP_PAGE).toContain("source: normalizeSignupSource(search.source) ?? undefined");
    // The old inline OR-chain is gone — one normaliser, shared with the server.
    expect(SIGNUP_PAGE).not.toContain('search.source === "autopsy"');
    expect(SIGNUP_PAGE).toContain('import {');
    expect(SIGNUP_PAGE).toContain("} from \"~/lib/signup-source\"");
  });

  test("the signup POST body carries signup_source", () => {
    expect(SIGNUP_PAGE).toContain("signup_source: source ?? undefined,");
  });

  test("the API normalises the field before it is written (never echoes a raw value)", () => {
    expect(SIGNUP_API).toContain("signup_source?: unknown;");
    expect(SIGNUP_API).toContain("const signupSource = normalizeSignupSource(body.signup_source);");
    // The value reaches the INSERT as the normalised local, never as `body.signup_source`.
    expect(SIGNUP_API).toContain(
      "INSERT INTO users (email, password_hash, plan_tier, trial_started_at, company_name, signup_source)",
    );
    expect(SIGNUP_API).toContain(
      "VALUES (${email}, ${passwordHash}, 'basic', NULL, ${company}, ${signupSource})",
    );
    expect(SIGNUP_API).not.toContain("${body.signup_source}");
  });
});

describe("migration 053 is the additive schema delta and the bootstrap mirror agrees", () => {
  test("one ADD COLUMN IF NOT EXISTS on users, no default, no backfill, no DML", () => {
    // The repo's own migration splitter (comment-stripping + `;` split) — the SAME thing
    // the hand-run migration runner executes, so this asserts what actually reaches the DB.
    expect(migrationStatements(MIGRATION)).toEqual([
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_source TEXT",
    ]);
    // Nothing but that one statement: no DML, and (proven by the exact statement above) no
    // constraint, no default and no backfill.
    expect(MIGRATION).not.toMatch(/^\s*(UPDATE|DELETE|INSERT|CREATE)\b/m);
  });

  test("the runner proves the column's shape and does not move a row", () => {
    expect(MIGRATION_RUNNER).toContain("signup_source: { type: \"text\", nullable: true }");
    expect(MIGRATION_RUNNER).toContain('"users"');
    expect(MIGRATION_RUNNER).toContain('"nonprofit_applications"');
    // Additive proof: the AFTER block fails the run on any moved row or a new table.
    expect(MIGRATION_RUNNER).toContain("FAIL: table(s) changed row count");
    expect(MIGRATION_RUNNER).toContain("public table count went");
  });

  test("src/db/schema.sql (the fresh-database bootstrap) carries the same column", () => {
    const users = SCHEMA.slice(
      SCHEMA.indexOf("CREATE TABLE IF NOT EXISTS users"),
      SCHEMA.indexOf("CREATE TABLE IF NOT EXISTS google_accounts"),
    );
    expect(users).toContain("signup_source TEXT");
  });
});

describe("Admin → Signups shows the marker distinctly", () => {
  test("the metrics endpoint selects and returns it", () => {
    expect(ADMIN_METRICS_API).toContain("u.signup_source AS signup_source");
    expect(ADMIN_METRICS_API).toContain("signup_source: r.signup_source ?? null,");
  });

  test("the signups table renders a distinct nonprofit label and an honest dash otherwise", () => {
    expect(ADMIN_SIGNUPS).toContain("<th className=\"px-5 py-3 font-medium\">Signup source</th>");
    expect(ADMIN_SIGNUPS).toContain("isNonprofitApplySource(s.signup_source)");
    expect(ADMIN_SIGNUPS).toContain("{SIGNUP_SOURCE_NONPROFIT_APPLY_LABEL}");
    expect(ADMIN_SIGNUPS).toContain("signup_source: string | null;");
  });
});

describe("the marker is attribution only — no entitlement, billing or approval path reads it", () => {
  test("no gate/checkout/trial/nonprofit-approval module mentions signup_source", () => {
    const entitlementSurfaces = [
      "../lib/plan-gates.ts",
      "../lib/checkout.ts",
      "../lib/stripe.ts",
      "../lib/trial.ts",
      "../lib/nonprofit-apply.server.ts",
      "../lib/nonprofit.server.ts",
      "../lib/nonprofit-review.server.ts",
      "../lib/nonprofit-reverify.server.ts",
      "../routes/api/nonprofit/apply.ts",
      "../routes/api/bids.$bidId.analyze.ts",
    ];
    for (const path of entitlementSurfaces) {
      const text = read(path);
      expect(text).not.toContain("signup_source");
      expect(text).not.toContain("SIGNUP_SOURCE_");
    }
  });

  test("the acquisition BUCKET vocabulary is untouched (no new funnel bucket, no data change)", () => {
    // The nonprofit source deliberately maps to NO bucket: adding one would have invented a
    // funnel dimension and changed every reported number. It resolves from the referrer,
    // exactly as it did before this change.
    const telemetry = read("../lib/signup-telemetry.ts");
    expect(telemetry).not.toContain("nonprofit_apply");
    expect(telemetry).toContain('radar: "radar",');
  });
});
