import { describe, expect, test } from "bun:test";

import { applyAdminTrialBypass, type TrialStatus } from "~/lib/trial";

const expired: TrialStatus = {
  active: false,
  daysLeft: 0,
  expired: true,
  endsAt: "2026-09-01T00:00:00.000Z",
  planTier: "professional",
  fullAccess: false,
};

describe("applyAdminTrialBypass — admins are never locked out by an expired trial", () => {
  test("an admin with an expired trial is reported as not expired", () => {
    const out = applyAdminTrialBypass(expired, { is_admin: true });
    expect(out.expired).toBe(false);
    // everything else is left as it was
    expect(out.planTier).toBe("professional");
    expect(out.endsAt).toBe(expired.endsAt);
    expect(out.active).toBe(false);
  });

  test("non-admins keep their real trial status", () => {
    expect(applyAdminTrialBypass(expired, { is_admin: false })).toEqual(expired);
    expect(applyAdminTrialBypass(expired, {})).toEqual(expired);
    expect(applyAdminTrialBypass(expired, null)).toEqual(expired);
  });

  test("an admin whose trial has not expired is unchanged", () => {
    const active: TrialStatus = { ...expired, active: true, daysLeft: 5, expired: false };
    expect(applyAdminTrialBypass(active, { is_admin: true })).toEqual(active);
  });
});
