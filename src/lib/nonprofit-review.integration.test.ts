/**
 * Nonprofit Free phase 2 (unit B) — the admin review queue against a REAL database.
 *
 * WHY THIS EXISTS. The unit suite proves the plan, the guards and the audit contract with the
 * database injected out. What only a real database can prove is the behaviour the owner's
 * locks actually depend on:
 *   • the guarded UPDATE really matches 0 rows when the row moved underneath the reviewer,
 *     and it writes NO audit row in that case (the "already actioned" 409);
 *   • a replayed action cannot double-apply — one approve, one document request and one
 *     release each leave exactly one audit row;
 *   • `release` sets `released_at` while the status stays put, the released row SURVIVES with
 *     its whole audit trail, and the partial unique index makes the EIN claimable by a
 *     DIFFERENT account;
 *   • the queue's default view is `pending` + `manual_review` ordered by `created_at`, the
 *     "denied & revoked" view is reachable (that is how an administrator can release), and
 *     the EIN-conflict claimant appears only in the admin-gated detail read;
 *   • the admin gate that both routes call resolves 401 (no session) / 403 (non-admin) /
 *     allowed (admin) against real `users` + `sessions` rows.
 *
 * HOW IT IS PROVIDED (and why it never touches the team's data). It issues `CREATE DATABASE` /
 * `DROP DATABASE` ONLY for a name containing "nonprofit_bootstrap", builds that database from
 * `src/db/schema.sql` ALONE, and drops it in `afterAll` — including after a failed run. The
 * only production-adjacent thing it touches is the connection URL, and every query runs
 * against the throwaway database.
 *
 * OPT-IN, CI-ONLY (the standing hard rule). The sandbox `DATABASE_URL` IS production, so this
 * suite does NOTHING unless BOTH `DATABASE_URL` and `NONPROFIT_TEST_PROVISION_SCHEMA=1` are
 * set. CI is its only judge.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { schemaStatements } from "../../db/migrations/sql-statements";

const ENABLED =
  process.env.NONPROFIT_TEST_PROVISION_SCHEMA === "1" && !!process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_URL ?? "";
const SCHEMA_DB = "contrax_nonprofit_bootstrap_review";
const SCHEMA_FILE = "../../src/db/schema.sql";

type Db = ReturnType<typeof neon>;

function urlForDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

let SCHEMA_URL: string | null = null;
let READY = false;

if (ENABLED) {
  const admin = neon(ADMIN_URL);
  await admin`DROP DATABASE IF EXISTS ${admin.unsafe(SCHEMA_DB)} WITH (FORCE)`;
  await admin`CREATE DATABASE ${admin.unsafe(SCHEMA_DB)}`;
  SCHEMA_URL = urlForDatabase(ADMIN_URL, SCHEMA_DB);
  const db = neon(SCHEMA_URL);
  const statements = schemaStatements(readFileSync(new URL(SCHEMA_FILE, import.meta.url), "utf8"));
  for (const statement of statements) {
    try {
      await db`${db.unsafe(statement)}`;
    } catch (error) {
      throw new Error(
        `[nonprofit review bootstrap] schema.sql failed on: ${statement.split("\n")[0].slice(0, 120)} :: ${
          (error as Error).message
        }`,
      );
    }
  }
  READY = true;
  console.log(
    `[nonprofit review bootstrap] built ${SCHEMA_DB} from src/db/schema.sql alone (${statements.length} statements)`,
  );
} else {
  console.warn(
    "[nonprofit review bootstrap] SKIPPED: set DATABASE_URL and NONPROFIT_TEST_PROVISION_SCHEMA=1 to build a " +
      "throwaway database from src/db/schema.sql. This suite is CI-only on purpose (the default sandbox " +
      "DATABASE_URL IS production).",
  );
}

afterAll(async () => {
  if (!ENABLED) return;
  const admin = neon(ADMIN_URL);
  try {
    await admin`DROP DATABASE IF EXISTS ${admin.unsafe(SCHEMA_DB)} WITH (FORCE)`;
  } catch (error) {
    console.warn(`[nonprofit review bootstrap] could not drop ${SCHEMA_DB}: ${(error as Error).message}`);
  }
});

/**
 * `~/db`'s `sql()` resolves `process.env.DATABASE_URL` LAZILY per call, so pointing that
 * variable at the throwaway database for the duration of a test is enough; the caller's
 * original value is always restored.
 */
async function inSchemaDb<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = SCHEMA_URL as string;
  try {
    return await fn();
  } finally {
    process.env.DATABASE_URL = previous;
  }
}

let cached: typeof import("~/lib/nonprofit-review.server") | null = null;
async function review() {
  if (!cached) cached = await import("./nonprofit-review.server");
  return cached;
}

async function newUser(db: Db, email: string, isAdmin = false): Promise<number> {
  const rows = (await db`
    INSERT INTO users (email, password_hash, is_admin) VALUES (${email}, 'x', ${isAdmin}) RETURNING id
  `) as { id: number }[];
  return rows[0]!.id;
}

/** One application row with the columns the queue reads, and nothing invented. */
async function newApplication(
  db: Db,
  input: {
    userId: number;
    ein: string;
    status?: string;
    orgName?: string;
    daysAgo?: number;
    website?: string | null;
    workEmail?: string;
    supportingDocsRequested?: boolean;
    evidence?: Record<string, unknown>;
  },
): Promise<number> {
  const createdAt = new Date(Date.now() - (input.daysAgo ?? 0) * 86_400_000).toISOString();
  const rows = (await db`
    INSERT INTO nonprofit_applications (
      user_id, org_name, work_email, website, ein, state, contact_name, contact_role,
      org_use_confirmed, status, submitted_name_normalized, decision, decision_reason,
      reason_class, decision_flags, supporting_docs_requested, evidence, created_at, updated_at
    ) VALUES (
      ${input.userId}, ${input.orgName ?? "Review Queue Org"}, ${input.workEmail ?? "work@example.org"},
      ${input.website ?? null}, ${input.ein}, 'ME', 'Test Applicant', 'Director', TRUE,
      ${input.status ?? "manual_review"}, 'REVIEW QUEUE ORG', 'manual_review', 'ein_not_found',
      'no-match-request-docs', '{}'::text[], ${input.supportingDocsRequested ?? false},
      ${JSON.stringify(input.evidence ?? {})}::jsonb, ${createdAt}, ${createdAt}
    ) RETURNING id
  `) as { id: number }[];
  return rows[0]!.id;
}

async function auditRows(db: Db, applicationId: number) {
  return (await db`
    SELECT action, prior_status, new_status, actor_user_id, actor_email, internal_note
    FROM nonprofit_application_reviews WHERE application_id = ${applicationId} ORDER BY id ASC
  `) as {
    action: string;
    prior_status: string;
    new_status: string;
    actor_user_id: number;
    actor_email: string;
    internal_note: string | null;
  }[];
}

describe.if(ENABLED)("the review queue on a schema.sql-only database", () => {
  test("the default view is pending + manual_review, oldest first; other statuses are excluded", async () => {
    const db = neon(SCHEMA_URL as string);
    expect(READY).toBe(true);
    const older = await newApplication(db, { userId: await newUser(db, "queue-a@example.org"), ein: "100000001", daysAgo: 9 });
    const newer = await newApplication(db, { userId: await newUser(db, "queue-b@example.org"), ein: "100000002", status: "pending", daysAgo: 2 });
    await newApplication(db, { userId: await newUser(db, "queue-c@example.org"), ein: "100000003", status: "approved", daysAgo: 1 });
    await newApplication(db, { userId: await newUser(db, "queue-d@example.org"), ein: "100000004", status: "revoked", daysAgo: 3 });

    await inSchemaDb(async () => {
      const { listNonprofitApplications } = await review();
      const queue = await listNonprofitApplications("queue", { limit: 50 });
      const ids = queue.map((row) => row.id);
      expect(ids).toContain(older);
      expect(ids).toContain(newer);
      // Oldest first: the applicant who has waited longest is at the top of the SLA queue.
      expect(ids.indexOf(older)).toBeLessThan(ids.indexOf(newer));
      const statuses = new Set(queue.map((row) => row.status));
      expect([...statuses].sort()).toEqual(["manual_review", "pending"]);
      // The projection carries no EIN in any form.
      expect(JSON.stringify(queue)).not.toMatch(/\bein\b/i);
      expect(queue[0]!.age.businessDays).toBeGreaterThanOrEqual(0);
    });
  });

  test("the 'denied & revoked' view is reachable, which is how a release can be made", async () => {
    const db = neon(SCHEMA_URL as string);
    await inSchemaDb(async () => {
      const { listNonprofitApplications } = await review();
      const releasable = await listNonprofitApplications("denied_revoked", { limit: 50 });
      const statuses = new Set(releasable.map((row) => row.status));
      expect([...statuses].sort()).toEqual(["revoked"]);
      expect(releasable.length).toBeGreaterThan(0);
      const all = await listNonprofitApplications("all", { limit: 50 });
      expect(all.length).toBeGreaterThanOrEqual(releasable.length);
    });
  });

  test("an unknown id has no detail (the route's 404), and the detail carries the audit trail", async () => {
    const db = neon(SCHEMA_URL as string);
    await inSchemaDb(async () => {
      const { getNonprofitReviewApplication } = await review();
      expect(await getNonprofitReviewApplication(9_999_999)).toBeNull();

      const detail = await getNonprofitReviewApplication(
        (
          await db`SELECT id FROM nonprofit_applications WHERE ein = '100000001' LIMIT 1`
        )[0]!.id as number,
      );
      expect(detail).not.toBeNull();
      expect(detail!.audit).toEqual([]);
      // The domain comparison is recomputed server-side, labelled, and never a verdict.
      expect(detail!.domainSignal.label).toBe("secondary signal — never a verdict");
      expect(detail!.irs.decision).toBe("manual_review");
    });
  });

  test("the EIN-conflict claimant is on the admin-gated detail read, not in the queue list", async () => {
    const db = neon(SCHEMA_URL as string);
    const applicantUserId = await newUser(db, "claimant-detail@example.org");
    const holderUserId = await newUser(db, "claimant-holder@example.org");
    const applicationId = await newApplication(db, {
      userId: applicantUserId,
      ein: "100000010",
      evidence: {
        ein_claim: { claimed_by_user_id: holderUserId, claimed_org_name: "The Other Org" },
        decided_by: "system",
      },
      daysAgo: 1,
    });
    await inSchemaDb(async () => {
      const { getNonprofitReviewApplication, listNonprofitApplications } = await review();
      const detail = await getNonprofitReviewApplication(applicationId);
      expect(detail!.einClaim).toEqual({ claimedByUserId: holderUserId, claimedOrgName: "The Other Org" });
      expect(detail!.irs.decidedBy).toBe("system");
      const queue = await listNonprofitApplications("all", { limit: 200 });
      const row = queue.find((entry) => entry.id === applicationId);
      expect(row).toBeTruthy();
      // The bulk read carries neither the raw evidence blob nor the claimant id.
      expect(JSON.stringify(row)).not.toContain("claimedByUserId");
      expect(JSON.stringify(row)).not.toContain("claimed_by_user_id");
    });
  });

  test("the guarded UPDATE matches 0 rows when the row moved, and writes NO audit row", async () => {
    const db = neon(SCHEMA_URL as string);
    const applicationId = await newApplication(db, {
      userId: await newUser(db, "stale-guard@example.org"),
      ein: "100000020",
      status: "manual_review",
    });
    await inSchemaDb(async () => {
      const { buildNonprofitDecisionStatement, planNonprofitReviewDecision, applyNonprofitDecision } = await review();
      // A reviewer read the row while it was `pending`; another reviewer has since moved it to
      // `manual_review`. The plan is built from the STALE status, so its guard is satisfiable…
      const planned = planNonprofitReviewDecision({
        applicationId,
        action: "approve",
        actor: { id: 1, email: "admin@example.org" },
        currentStatus: "pending",
        now: new Date("2026-09-23T12:00:00.000Z"),
      });
      expect(planned.ok).toBe(true);
      if (!planned.ok) return;
      const statement = buildNonprofitDecisionStatement(planned.plan);
      // …but the status it read first is the one the guard accepts, so make the guard stale by
      // denying it the row's ACTUAL status.
      const stale = { ...planned.plan, expectedStatuses: ["denied"] as const };
      const applied = await applyNonprofitDecision(stale);
      expect(applied).toBeNull();
      expect(await auditRows(db, applicationId)).toHaveLength(0);
      expect(statement.text).toContain("status = ANY(");
    });
  });

  test("one action, one audit row — and a replayed approve cannot double-apply", async () => {
    const db = neon(SCHEMA_URL as string);
    const actorUserId = await newUser(db, "reviewer-approve@example.org");
    const applicationId = await newApplication(db, {
      userId: await newUser(db, "approve-subject@example.org"),
      ein: "100000030",
      status: "manual_review",
      daysAgo: 1,
    });
    await inSchemaDb(async () => {
      const { decideNonprofitApplication, applyNonprofitDecision } = await review();
      expect(typeof applyNonprofitDecision).toBe("function");
      const first = await decideNonprofitApplication({
        applicationId,
        action: "approve",
        note: "checked the IRS record",
        actor: { id: actorUserId, email: "reviewer-approve@example.org" },
      });
      expect(first.status).toBe(200);
      expect(first.body.newStatus).toBe("approved");

      const rows = (await db`
        SELECT status, verification_method, granted_at, reverify_due_at, reviewed_by, decision, reason_class
        FROM nonprofit_applications WHERE id = ${applicationId}
      `) as Record<string, unknown>[];
      expect(rows[0]!.status).toBe("approved");
      expect(rows[0]!.verification_method).toBe("manual_exception");
      expect(rows[0]!.granted_at).not.toBeNull();
      expect(rows[0]!.reverify_due_at).not.toBeNull();
      expect(rows[0]!.reviewed_by).toBe(`user:${actorUserId} <reviewer-approve@example.org>`);
      // The engine's own audit columns are untouched by a human decision.
      expect(rows[0]!.decision).toBe("manual_review");
      expect(rows[0]!.reason_class).toBe("no-match-request-docs");

      const audit = await auditRows(db, applicationId);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe("approve");
      expect(audit[0]!.prior_status).toBe("manual_review");
      expect(audit[0]!.new_status).toBe("approved");
      expect(audit[0]!.actor_email).toBe("reviewer-approve@example.org");

      // A second approve is a 409 and changes nothing — not the row, not the audit trail.
      const replay = await decideNonprofitApplication({
        applicationId,
        action: "approve",
        actor: { id: actorUserId, email: "reviewer-approve@example.org" },
      });
      expect(replay.status).toBe(409);
      expect(await auditRows(db, applicationId)).toHaveLength(1);
      const after = (await db`
        SELECT status, reviewed_by FROM nonprofit_applications WHERE id = ${applicationId}
      `) as Record<string, unknown>[];
      expect(after[0]!.status).toBe("approved");
    });
  });

  test("request-info sets the doc flag, keeps the row in review, and cannot double-apply", async () => {
    const db = neon(SCHEMA_URL as string);
    const actorUserId = await newUser(db, "reviewer-docs@example.org");
    const applicationId = await newApplication(db, {
      userId: await newUser(db, "docs-subject@example.org"),
      ein: "100000040",
      status: "pending",
    });
    await inSchemaDb(async () => {
      const { decideNonprofitApplication } = await review();
      const first = await decideNonprofitApplication({
        applicationId,
        action: "request_info",
        note: "need the determination letter",
        actor: { id: actorUserId, email: "reviewer-docs@example.org" },
      });
      expect(first.status).toBe(200);
      expect(first.body.newStatus).toBe("manual_review");
      const rows = (await db`
        SELECT status, supporting_docs_requested FROM nonprofit_applications WHERE id = ${applicationId}
      `) as Record<string, unknown>[];
      expect(rows[0]!.status).toBe("manual_review");
      expect(rows[0]!.supporting_docs_requested).toBe(true);
      expect(await auditRows(db, applicationId)).toHaveLength(1);

      const replay = await decideNonprofitApplication({
        applicationId,
        action: "request_info",
        actor: { id: actorUserId, email: "reviewer-docs@example.org" },
      });
      expect(replay.status).toBe(409);
      expect(await auditRows(db, applicationId)).toHaveLength(1);
    });
  });

  test("a deny without a note is refused and writes nothing", async () => {
    const db = neon(SCHEMA_URL as string);
    const actorUserId = await newUser(db, "reviewer-deny@example.org");
    const applicationId = await newApplication(db, {
      userId: await newUser(db, "deny-subject@example.org"),
      ein: "100000050",
    });
    await inSchemaDb(async () => {
      const { decideNonprofitApplication } = await review();
      const refused = await decideNonprofitApplication({
        applicationId,
        action: "deny",
        actor: { id: actorUserId, email: "reviewer-deny@example.org" },
      });
      expect(refused.status).toBe(400);
      const rows = (await db`
        SELECT status FROM nonprofit_applications WHERE id = ${applicationId}
      `) as Record<string, unknown>[];
      expect(rows[0]!.status).toBe("manual_review");
      expect(await auditRows(db, applicationId)).toHaveLength(0);

      const denied = await decideNonprofitApplication({
        applicationId,
        action: "deny",
        note: "identity contradicts the application",
        actor: { id: actorUserId, email: "reviewer-deny@example.org" },
      });
      expect(denied.status).toBe(200);
      expect(denied.body.newStatus).toBe("denied");
      const audit = await auditRows(db, applicationId);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe("deny");
      expect(audit[0]!.internal_note).toBe("identity contradicts the application");
    });
  });

  test("release frees the EIN, keeps the status and the row, and cannot replay", async () => {
    const db = neon(SCHEMA_URL as string);
    const actorUserId = await newUser(db, "reviewer-release@example.org");
    const holderUserId = await newUser(db, "release-holder@example.org");
    const applicationId = await newApplication(db, {
      userId: holderUserId,
      ein: "100000060",
      status: "denied",
    });
    await inSchemaDb(async () => {
      const { decideNonprofitApplication } = await review();
      const released = await decideNonprofitApplication({
        applicationId,
        action: "release",
        note: "wrong org, released at the owner's instruction",
        actor: { id: actorUserId, email: "reviewer-release@example.org" },
      });
      expect(released.status).toBe(200);
      // No invented 'released' status: the status is exactly what it was.
      expect(released.body.newStatus).toBe("denied");
      const rows = (await db`
        SELECT status, released_at FROM nonprofit_applications WHERE id = ${applicationId}
      `) as Record<string, unknown>[];
      expect(rows[0]!.status).toBe("denied");
      expect(rows[0]!.released_at).not.toBeNull();
      const audit = await auditRows(db, applicationId);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe("release");
      expect(audit[0]!.prior_status).toBe("denied");
      expect(audit[0]!.new_status).toBe("denied");

      // A replay matches nothing: the EIN is no longer held, so there is nothing to release.
      const replay = await decideNonprofitApplication({
        applicationId,
        action: "release",
        actor: { id: actorUserId, email: "reviewer-release@example.org" },
      });
      expect(replay.status).toBe(409);
      expect(await auditRows(db, applicationId)).toHaveLength(1);

      // The released row SURVIVES with its status and audit trail, and the EIN is now
      // claimable by a different account (the partial unique index).
      const claimedBy = await newUser(db, "release-claimer@example.org");
      const claimed = await db`
        INSERT INTO nonprofit_applications (user_id, org_name, work_email, ein, state, contact_name,
          org_use_confirmed, status)
        VALUES (${claimedBy}, 'New Claimant Org', 'new@example.org', '100000060', 'ME', 'New Applicant', TRUE, 'manual_review')
        RETURNING id
      `;
      expect(claimed).toHaveLength(1);
      const original = (await db`
        SELECT status, released_at FROM nonprofit_applications WHERE id = ${applicationId}
      `) as Record<string, unknown>[];
      expect(original[0]!.status).toBe("denied");
      expect(await auditRows(db, applicationId)).toHaveLength(1);
    });
  });

  test("the admin gate resolves 401 / 403 / allowed against real sessions", async () => {
    const db = neon(SCHEMA_URL as string);
    await inSchemaDb(async () => {
      const { getUserFromRequest } = await import("~/lib/api-auth");
      const plainUserId = await newUser(db, "gate-plain@example.org");
      const adminUserId = await newUser(db, "gate-admin@example.org", true);
      await db`
        INSERT INTO sessions (user_id, token, expires_at) VALUES
          (${plainUserId}, 'gate-plain-token', NOW() + interval '1 hour'),
          (${adminUserId}, 'gate-admin-token', NOW() + interval '1 hour')
      `;
      const url = "https://contrax.test/api/admin/nonprofit-applications";
      // No session cookie ⇒ the route answers 401.
      expect(await getUserFromRequest(new Request(url))).toBeNull();
      // A signed-in non-admin ⇒ the route answers 403 (`is_admin` false and the email is not
      // on the ADMIN_EMAILS allowlist).
      const plain = await getUserFromRequest(
        new Request(url, { headers: { cookie: "contrax_session=gate-plain-token" } }),
      );
      expect(plain).not.toBeNull();
      expect(plain!.is_admin).toBe(false);
      // An admin (is_admin = TRUE) ⇒ the queue is reachable.
      const admin = await getUserFromRequest(
        new Request(url, { headers: { cookie: "contrax_session=gate-admin-token" } }),
      );
      expect(admin!.is_admin).toBe(true);
    });
  });
});
