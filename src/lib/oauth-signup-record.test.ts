import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { linkVisitorConversion, recordOAuthSignup, type SqlFactory } from "./identity-backfill";

/** A fake tagged-template db that records each statement's text and values. */
function fakeDb() {
  const calls: { text: string; values: unknown[] }[] = [];
  const tag = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve([]);
  }) as unknown;
  return { db: (() => tag) as unknown as SqlFactory, calls };
}

describe("OAuth signups reach the visitor record (owner 2026-10-19)", () => {
  test("recordOAuthSignup writes one signup_success event tied to visitor and account", async () => {
    const { db, calls } = fakeDb();
    await recordOAuthSignup(db, { userId: 42, email: "a@biz.com", visitorId: "v1", provider: "google" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toContain("INSERT INTO funnel_events");
    expect(calls[0]!.text).toContain("'signup_success'");
    expect(calls[0]!.values).toEqual(["google", "/auth/google/callback", "google-oauth-callback", "v1", "42", "a@biz.com"]);
  });
  test("no visitor cookie: nothing written", async () => {
    const { db, calls } = fakeDb();
    await recordOAuthSignup(db, { userId: 42, email: "a@biz.com", visitorId: "", provider: "linkedin" });
    await linkVisitorConversion(db, 42, "");
    expect(calls).toHaveLength(0);
  });
  test("both OAuth callbacks link NEW accounts only", () => {
    for (const f of ["src/routes/auth/google/callback.tsx", "src/routes/auth/linkedin/callback.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).toContain("if (data.isNewUser) {");
      expect(src).toContain("await linkVisitorConversion(sql, data.userId, vid);");
      expect(src).toContain("linkOAuthVisitor({ data: { userId, email: userEmail, isNewUser } })");
    }
  });
});
