import { describe, expect, test } from "bun:test";
import { emptyLaunchpad, type LaunchpadData } from "./launchpad";
import { hasLaunchpadContent, pickLaunchpad, sanitizeWorkspace, MAX_WORKSPACE_BYTES } from "./launchpad-sync";

function withCompany(company: string, updatedAt: string): LaunchpadData {
  const d = emptyLaunchpad();
  d.profile.company = company;
  d.updatedAt = updatedAt;
  return d;
}

describe("hasLaunchpadContent", () => {
  test("an empty workspace has no content", () => {
    expect(hasLaunchpadContent(emptyLaunchpad())).toBe(false);
  });
  test("any profile field, checklist item or bid field counts", () => {
    expect(hasLaunchpadContent(withCompany("Acme", ""))).toBe(true);
    const d = emptyLaunchpad();
    d.registrations = ["buyers"];
    expect(hasLaunchpadContent(d)).toBe(true);
    const b = emptyLaunchpad();
    b.bid.notes = "call the buyer";
    expect(hasLaunchpadContent(b)).toBe(true);
  });
});

describe("pickLaunchpad", () => {
  const older = withCompany("Device copy", "2026-10-01T00:00:00.000Z");
  const newer = withCompany("Account copy", "2026-10-15T00:00:00.000Z");

  test("first sign-in with work on this device: keep it and save it to the account", () => {
    expect(pickLaunchpad(older, null)).toEqual({ use: older, push: true });
  });
  test("nothing anywhere: nothing to push", () => {
    const empty = emptyLaunchpad();
    expect(pickLaunchpad(empty, null)).toEqual({ use: empty, push: false });
  });
  test("new device: load the account copy", () => {
    const empty = emptyLaunchpad();
    expect(pickLaunchpad(empty, newer)).toEqual({ use: newer, push: false });
  });
  test("both have work: the most recently saved wins", () => {
    expect(pickLaunchpad(older, newer)).toEqual({ use: newer, push: false });
    expect(pickLaunchpad(newer, older)).toEqual({ use: newer, push: true });
  });
  test("an empty account copy never overwrites device work", () => {
    expect(pickLaunchpad(older, emptyLaunchpad())).toEqual({ use: older, push: true });
  });
});

describe("sanitizeWorkspace", () => {
  test("applies the browser-storage rules (bad state cleared, unknown keys dropped)", () => {
    const d = { ...withCompany("Acme", "2026-10-15T00:00:00.000Z"), extra: "x" } as unknown as Record<string, unknown>;
    (d.profile as Record<string, string>).state = "Virginia";
    const clean = sanitizeWorkspace(d)!;
    expect(clean.profile.company).toBe("Acme");
    expect(clean.profile.state).toBe("");
    expect("extra" in clean).toBe(false);
  });
  test("rejects non-objects, wrong versions and oversized payloads", () => {
    expect(sanitizeWorkspace(null)).toBeNull();
    expect(sanitizeWorkspace("hi")).toBeNull();
    expect(sanitizeWorkspace({ ...emptyLaunchpad(), version: 2 })).toBeNull();
    const big = emptyLaunchpad() as unknown as Record<string, unknown>;
    big.padding = "x".repeat(MAX_WORKSPACE_BYTES);
    expect(sanitizeWorkspace(big)).toBeNull();
  });
});
