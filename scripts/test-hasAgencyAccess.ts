/**
 * Standalone test for the hasAgencyAccess predicate (owner's QA matrix).
 * Run: bun run scripts/test-hasAgencyAccess.ts
 *
 * Constructs TrialStatus-shaped objects directly (the predicate only reads
 * fullAccess/planTier/expired). No DB / server context required.
 */
import { hasAgencyAccess, type TrialStatus } from "../src/lib/trial";

type TrialShape = Pick<TrialStatus, "fullAccess" | "planTier" | "expired">;

// Owner's 6-case QA matrix + a couple of extra guard cases.
const cases: Array<{ name: string; trial: TrialShape | null; user?: { is_admin?: boolean } | null; expected: boolean }> = [
  { name: "admin user → true (trial null)", trial: null, user: { is_admin: true }, expected: true },
  { name: "admin user → true (any trial)", trial: { fullAccess: false, planTier: "basic", expired: false }, user: { is_admin: true }, expected: true },
  { name: "demo user, not expired → true", trial: { fullAccess: false, planTier: "demo", expired: false }, expected: true },
  { name: "full_access=true grant user → true", trial: { fullAccess: true, planTier: "basic", expired: false }, expected: true },
  { name: "plan_tier='agency' paid, not expired → true", trial: { fullAccess: false, planTier: "agency", expired: false }, expected: true },
  { name: "plan_tier='starter' regular, not expired → false", trial: { fullAccess: false, planTier: "starter", expired: false }, expected: false },
  { name: "plan_tier='basic' free user → false", trial: { fullAccess: false, planTier: "basic", expired: false }, expected: false },
  // Extra guard cases (belt & suspenders on the spec)
  { name: "plan_tier=null → false", trial: { fullAccess: false, planTier: null, expired: false }, expected: false },
  { name: "trial undefined → false", trial: undefined as unknown as TrialShape | null, expected: false },
  { name: "expired agency → false (grant/paid lapsed)", trial: { fullAccess: false, planTier: "agency", expired: true }, expected: false },
  { name: "expired demo → false", trial: { fullAccess: false, planTier: "demo", expired: true }, expected: false },
  { name: "non-admin, non-demo, unknown tier → false", trial: { fullAccess: false, planTier: "professional", expired: false }, user: { is_admin: false }, expected: false },
];

let failures = 0;
for (const c of cases) {
  const got = hasAgencyAccess(c.trial, c.user);
  const ok = got === c.expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} | ${c.name} => got ${got}, expected ${c.expected}`);
}

console.log(`\n${cases.length - failures}/${cases.length} passed`);
if (failures > 0) {
  console.error(`${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("ALL PASS — hasAgencyAccess matches the owner's QA matrix");
