import { describe, expect, test } from "bun:test";
import { isAdminEmail } from "./admin";
import { adminUserEmailExclusionSQL, qaExternalUserSQL } from "./qa-exclusion";

describe("the owner's own accounts never count as customers (owner 2026-10-30)", () => {
  test("the company Gmail inbox is an admin with or without the dot", () => {
    expect(isAdminEmail("contrax.companyllc@gmail.com")).toBe(true);
    expect(isAdminEmail("ContraxCompanyLLC@gmail.com")).toBe(true);
  });
  test("customer counts leave out admin emails as well as the is_admin column", () => {
    expect(adminUserEmailExclusionSQL("u.")).toContain("LOWER(COALESCE(u.email, '')) NOT IN (");
    expect(adminUserEmailExclusionSQL()).toContain("'contraxcompanyllc@gmail.com'");
    expect(qaExternalUserSQL()).toContain("NOT IN (");
  });
});
