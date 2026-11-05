import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { claimCanMovePass, passMovedAlert, PASS_CLAIM_COOKIE, readClaimToken } from "./pass-claim";

// Owner 2026-11-04: a buyer paid the $5 pass as one email, then signed up 44 s
// later with a work email and saw the free version. "yes" to fixing it.
const T = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const NOW = Date.parse("2026-11-05T00:00:00Z");
const base = { claimCreatedMs: NOW - 60_000, claimed: false, now: NOW, passEndsMs: NOW + 29 * 864e5, paidAccountOnboarded: false, sameAccount: false };

describe("pass claim", () => {
  test("the claim token reads from the Cookie header, and nothing else does", () => {
    expect(readClaimToken(`a=1; ${PASS_CLAIM_COOKIE}=${T}; b=2`)).toBe(T);
    expect(readClaimToken(`${PASS_CLAIM_COOKIE}=not-a-token!`)).toBeNull();
    expect(readClaimToken("a=1")).toBeNull();
    expect(readClaimToken(null)).toBeNull();
  });

  test("a fresh, unused claim moves a running pass", () => {
    expect(claimCanMovePass(base)).toBe(true);
  });

  test("never twice, never after a day, never an ended pass, never off an account the buyer set up", () => {
    expect(claimCanMovePass({ ...base, claimed: true })).toBe(false);
    expect(claimCanMovePass({ ...base, claimCreatedMs: NOW - 25 * 3600_000 })).toBe(false);
    expect(claimCanMovePass({ ...base, passEndsMs: NOW - 1 })).toBe(false);
    expect(claimCanMovePass({ ...base, passEndsMs: null })).toBe(false);
    expect(claimCanMovePass({ ...base, paidAccountOnboarded: true })).toBe(false);
    expect(claimCanMovePass({ ...base, sameAccount: true })).toBe(false);
  });

  test("the owner is told where the pass went", () => {
    expect(passMovedAlert("a@gmail.com", "a@work.com").body).toBe("Paid as a@gmail.com, signed up as a@work.com. The pass is now on a@work.com.");
  });

  test("post-checkout sets the claim for guest pass checkouts and says which email has the pass", () => {
    const src = readFileSync("src/routes/post-checkout.tsx", "utf8");
    expect(src).toContain("metadataUserId == null && session.metadata?.starter_pass === \"true\"");
    expect(src).toContain("createPassClaim(userId)");
    expect(src).toContain("pass is on");
  });

  test("signup moves the pass, clears the cookie and never fails because of it", () => {
    const src = readFileSync("src/routes/api/signup.ts", "utf8");
    const i = src.indexOf("movePassOnSignup(claimToken, user.id)");
    expect(i).toBeGreaterThan(0);
    expect(src.lastIndexOf("try {", i)).toBeGreaterThan(src.lastIndexOf("INSERT INTO sessions", i));
    expect(src).toContain("maxAge: 0");
  });
});
