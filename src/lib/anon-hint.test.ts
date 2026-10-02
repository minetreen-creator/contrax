import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { anonHintClearCookie, anonHintSetCookie, hasAnonHint, issuesSession } from "./anon-hint";

const ROOT = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("known-anonymous hint (owner 2026-10-02)", () => {
  test("cookie strings", () => {
    expect(anonHintSetCookie()).toBe("contrax_anon=1; Max-Age=3600; Path=/; SameSite=Lax; Secure");
    expect(anonHintClearCookie()).toBe("contrax_anon=; Max-Age=0; Path=/; SameSite=Lax; Secure");
  });

  test("hasAnonHint reads document.cookie / Cookie header strings", () => {
    expect(hasAnonHint("contrax_vid=abc; contrax_anon=1")).toBe(true);
    expect(hasAnonHint("contrax_anon=1")).toBe(true);
    expect(hasAnonHint("contrax_anon=")).toBe(false);
    expect(hasAnonHint("xcontrax_anon=1")).toBe(false);
    expect(hasAnonHint("")).toBe(false);
    expect(hasAnonHint(undefined)).toBe(false);
  });

  test("issuesSession: only a non-empty contrax_session counts", () => {
    expect(issuesSession(["contrax_session=tok123; Path=/; HttpOnly"])).toBe(true);
    expect(issuesSession(["other=1", "contrax_session=abc"])).toBe(true);
    expect(issuesSession(["contrax_session=; Max-Age=0; Path=/"])).toBe(false); // logout
    expect(issuesSession(["contrax_sessionx=abc"])).toBe(false);
    expect(issuesSession([])).toBe(false);
  });

  test("wiring: 401 sets the hint, the browser skips on it, launchers clear it on login", () => {
    expect(read("src/routes/api/auth/me.ts")).toContain('"set-cookie": anonHintSetCookie()');
    expect(read("src/lib/auth.ts")).toContain('if (hasAnonHint(typeof document !== "undefined" ? document.cookie : "")) return null;');
    expect(read("vercel-entry.ts")).toContain("if (issuesSession(setCookies)) {");
    expect(read("vercel-entry.ts")).toContain("anonHintClearCookie()");
    expect(read("serve.ts")).toContain("anonHintClearCookie()");
  });

  test("only a 200 is edge-cached", () => {
    expect(read("vercel-entry.ts")).toContain("if (cacheableSsrf && webRes.status === 200) {");
  });
});
