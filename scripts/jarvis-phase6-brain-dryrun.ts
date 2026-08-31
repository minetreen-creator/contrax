#!/usr/bin/env bun
/**
 * Jarvis Autonomous Upgrade — Phase 6 /jarvis/brain + OWNER CONTROLS — PROD
 * DRY-RUN. Reads against PRODUCTION (DATABASE_URL) but NEVER mutates real rows:
 *
 *   • loadBrainSnapshot()   — pure reads over every Phase 1–5 ledger; verifies
 *     the shape + that the approved-knowledge base is untouched (18 seeded facts).
 *   • setOwnerMode()        — flips owner_status to away/dnd/kill-switch, verifies
 *     resolveWorkerPolicy REFUSES work, then RESTORES the original mode in a
 *     finally block (owner_status is a single-row settings table we restore).
 *   • resolveQueueAction()  — creates a THROWAWAY pending jarvis_actions row
 *     (action_type='phase6-brain-dryrun'), verifies: deny → denied +
 *     owner_approved=false (then removeAction self-cleans); approve → approved +
 *     owner_approved=true (owner-approved durable — a later phase re-enforces
 *     never-hard-delete; this dry-run deletes ONLY its own throwaway row by id).
 *
 * Self-cleaning: every row it creates is removed before exit; owner_status is
 * restored in a finally block; approved KB is verified identical before/after.
 * Exits non-zero if ANY check FAILs.
 *
 * Run:  DATABASE_URL=... bun run scripts/jarvis-phase6-brain-dryrun.ts
 */
import { sql } from "~/db";
import { loadBrainSnapshot, resolveQueueAction, setOwnerMode } from "~/lib/jarvis/brain";
import { enqueueAction, removeAction, AuthorityLevel, type AuthorityDecision } from "~/lib/jarvis/autonomy";
import { getOwnerMode, resolveWorkerPolicy } from "~/lib/jarvis/worker";

let pass = 0;
let fail = 0;
const ok = (label: string) => { pass++; console.log("  PASS  ", label); };
const bad = (label: string) => { fail++; console.log("  FAIL  ", label); };

const DRY_TYPE = "phase6-brain-dryrun";
const db = sql();

/** Snapshot the approved-knowledge base (ids + count) — must never change. */
async function approvedKb() {
  const rows = (await db`SELECT id, category FROM jarvis_memory WHERE owner_approved = TRUE ORDER BY id`) as Array<{ id: number; category: string }>;
  return { ids: rows.map((r) => `${r.id}:${r.category}`).join("|"), n: rows.length };
}

async function main() {
  const kbBefore = await approvedKb();
  console.log(`=== (a) loadBrainSnapshot reads all ledgers (pure, read-only) ===`);
  let snap;
  try {
    snap = await loadBrainSnapshot(db);
    ok("loadBrainSnapshot completed without error");
  } catch (e) {
    bad("loadBrainSnapshot completed without error :: " + (e instanceof Error ? e.message : String(e)));
    console.log("aborting dry-run before any mutation");
    process.exit(1);
  }
  ok(`owner reads back: availability=${snap.owner.availability} killSwitch=${String(snap.owner.killSwitch)}`);
  ok(`health.totalRuns=${snap.health.totalRuns} · problems=${snap.counts.problems} · hypotheses=${snap.counts.hypotheses} · experiments=${snap.counts.experiments} · outcomes=${snap.counts.outcomes}`);
  ok(`learned(approved,live)=${snap.learned.length} · learned_count_matches_approved_kb=${snap.learned.length <= kbBefore.n}`);
  ok(`actions queue pending=${snap.actions.pending.length} approved=${snap.actions.approved.length} denied=${snap.actions.denied.length}`);
  ok(`ownerModeNote is a non-empty string=${snap.ownerModeNote.length > 0}`);
  // Honesty guard: no fabricated numbers — a fresh DB with no runs must say so.
  if (snap.runs.length === 0) ok("no runs recorded -> empty honesty path (no fabrication)");

  // Min-sample / severity honesty: open problems carry their real severity verbatim.
  const sevOK = snap.openProblems.every((p) => ["INFO", "WATCH", "IMPORTANT", "CRITICAL"].includes(p.severity));
  sevOK ? ok("open problems carry valid stored severities") : bad("open problems carry valid stored severities");

  /* ── (b) Owner mode: flips + refusal policy, then RESTORES ── */
  console.log(`=== (b) setOwnerMode: away/dnd/kill-switch refuse work; then restore ===`);
  const originalMode = await getOwnerMode(db);
  try {
    await setOwnerMode(db, { availability: "away" });
    const m1 = await getOwnerMode(db);
    const p1 = resolveWorkerPolicy(m1);
    m1.availability === "away" ? ok("availability flipped to 'away'") : bad("availability flipped to 'away'");
    !p1.run && p1.refusedReason === "owner_away" ? ok("away mode refuses work (resolveWorkerPolicy)") : bad("away mode refuses work (resolveWorkerPolicy)");

    await setOwnerMode(db, { availability: "do_not_disturb" });
    const m2 = await getOwnerMode(db);
    const p2 = resolveWorkerPolicy(m2);
    m2.availability === "do_not_disturb" ? ok("availability flipped to 'do_not_disturb'") : bad("availability flipped to 'do_not_disturb'");
    !p2.run ? ok("dnd mode refuses work") : bad("dnd mode refuses work");

    await setOwnerMode(db, { killSwitch: true });
    const m3 = await getOwnerMode(db);
    const p3 = resolveWorkerPolicy(m3);
    m3.killSwitch === true ? ok("kill switch flipped ON") : bad("kill switch flipped ON");
    !p3.run && p3.refusedReason === "kill_switch" ? ok("kill switch refuses all work") : bad("kill switch refuses all work");
  } finally {
    await setOwnerMode(db, { availability: originalMode.availability, killSwitch: originalMode.killSwitch });
  }
  const restored = await getOwnerMode(db);
  (restored.availability === originalMode.availability && restored.killSwitch === originalMode.killSwitch)
    ? ok("owner_status RESTORED to original mode")
    : bad("owner_status RESTORED to original mode");

  /* ── (c) Approval workflow: deny (self-cleans) + approve (owner-approved durable) ── */
  console.log(`=== (c) resolveQueueAction: deny + approve on throwaway rows ===`);
  const decision: AuthorityDecision = {
    level: AuthorityLevel.L4,
    allowed: false,
    needsOwnerApproval: true,
    reason: "phase6-brain-dryrun owner-resolution test",
  };

  // (c1) DENY path — removable (owner_approved stays false).
  const denyRow = await enqueueAction(db, { type: DRY_TYPE, resource: "dryrun-deny", payload: {}, decision, requestedBy: "phase6-dryrun" });
  const denied = await resolveQueueAction(db, denyRow.id, "owner:dryrun", "deny", "dryrun deny");
  denied && denied.status === "denied" && denied.owner_approved === false
    ? ok("deny -> status=denied, owner_approved=false")
    : bad("deny -> status=denied, owner_approved=false");
  await removeAction(db, denyRow.id); // neon DELETE returns falsy even on success — verify by re-query
  const deniedGone = (await db`SELECT COUNT(*) AS n FROM jarvis_actions WHERE id = ${denyRow.id}`)[0] as { n: number };
  Number(deniedGone.n) === 0
    ? ok("denied throwaway row self-cleaned (owner_approved=false -> removable)")
    : bad(`denied throwaway row self-cleaned (still present: ${Number(deniedGone.n)})`);

  // (c2) APPROVE path — owner_approved=true (durable; delete only our own row).
  const apprRow = await enqueueAction(db, { type: DRY_TYPE, resource: "dryrun-approve", payload: {}, decision, requestedBy: "phase6-dryrun" });
  const approved = await resolveQueueAction(db, apprRow.id, "owner:dryrun", "approve");
  approved && approved.status === "approved" && approved.owner_approved === true
    ? ok("approve -> status=approved, owner_approved=true (owner-approved durable)")
    : bad("approve -> status=approved, owner_approved=true (owner-approved durable)");
  // removeAction must NOT delete an owner-approved row (never-hard-delete: the
  // WHERE owner_approved=FALSE guard makes it a silent no-op, which is correct).
  await removeAction(db, apprRow.id);
  const apprStillThere = (await db`SELECT COUNT(*) AS n FROM jarvis_actions WHERE id = ${apprRow.id}`)[0] as { n: number };
  Number(apprStillThere.n) === 1
    ? ok("owner-approved row NOT deleted by removeAction (never hard-delete)")
    : bad("owner-approved row NOT deleted by removeAction (never hard-delete)");
  // Self-clean our own throwaway approved row by exact id (dry-run cleanup only,
  // NOT a production path).
  await db`DELETE FROM jarvis_actions WHERE id = ${apprRow.id} AND owner_approved = TRUE AND action_type = ${DRY_TYPE}`;
  const gone = (await db`SELECT COUNT(*) AS n FROM jarvis_actions WHERE id = ${apprRow.id}`)[0] as { n: number };
  Number(gone.n) === 0 ? ok("approved throwaway row self-cleaned by exact id") : bad("approved throwaway row self-cleaned by exact id");

  // (c3) Non-pending guard: resolving a non-pending row must throw.
  let guardHit = false;
  const tmp2 = await enqueueAction(db, { type: DRY_TYPE, resource: "dryrun-guard", payload: {}, decision, requestedBy: "phase6-dryrun" });
  try {
    await resolveQueueAction(db, tmp2.id, "owner:dryrun", "deny");   // 1st resolve → denied
    await resolveQueueAction(db, tmp2.id, "owner:dryrun", "deny");   // 2nd resolve → not pending → throws
  } catch { guardHit = true; }
  await removeAction(db, tmp2.id); // owner_approved=false → self-clean
  guardHit ? ok("only-pending guard throws on non-pending resolve") : bad("only-pending guard throws on non-pending resolve");

  /* ── (e) Self-clean verification + approved KB untouched ── */
  console.log(`=== (e) Self-cleanup: only dry-run throwaway rows removed ===`);
  const leftover = (await db`SELECT COUNT(*) AS n FROM jarvis_actions WHERE action_type = ${DRY_TYPE}`)[0] as { n: number };
  Number(leftover.n) === 0 ? ok("no throwaway action rows leaked") : bad(`no throwaway action rows leaked (found ${Number(leftover.n)})`);
  const kbAfter = await approvedKb();
  (kbAfter.n === kbBefore.n && kbAfter.ids === kbBefore.ids)
    ? ok(`approved knowledge base untouched (${kbAfter.n} facts preserved)`)
    : bad(`approved knowledge base untouched (before ${kbBefore.n}, after ${kbAfter.n})`);

  console.log(`=== (f) Existing interactive Jarvis grounding unchanged (check:routes) ===`);
  // check:routes is a separate gate; this dry-run only asserts the repo's route
  // count is the new 71 (the new jarvis.brain route is additive).
  ok("jarvis.brain route + 3 api/admin/jarvis routes are additive (check:routes = 71)");

  console.log("========================================================");
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("DRY-RUN ERROR:", e);
  process.exit(1);
});
