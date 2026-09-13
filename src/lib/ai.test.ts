/**
 * Pure unit tests for src/lib/ai.ts telemetry sanitization
 * (PR: self-diagnosing [ai-brief] generation_failed logs).
 *
 * Guarantees: an OpenAI-style `sk-` key or bearer token can NEVER reach a
 * log line, even when it appears just before the truncation boundary, and
 * non-string inputs degrade to empty/short safe strings.
 */
import { describe, expect, test } from "bun:test";
import { sanitizeLogString } from "./ai";

describe("sanitizeLogString", () => {
  test("strips sk- API key fragments from error text", () => {
    const fakeKey = "sk-abc1234567890ABCDEFxyz";
    const out = sanitizeLogString(`OpenAI API error (401): Invalid API key provided: ${fakeKey}`);
    expect(out).not.toContain(fakeKey);
    expect(out).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
    expect(out).toContain("OpenAI API error (401)");
  });

  test("strips bearer tokens case-insensitively", () => {
    expect(sanitizeLogString("Bearer sk-abcdefgh12345678 rejected")).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
    expect(sanitizeLogString("Bearer sk-abcdefgh12345678 rejected")).not.toMatch(/bearer\s+sk-/i);
    const out = sanitizeLogString("authorization: bearer ABCDEF1234567890");
    expect(out).not.toContain("ABCDEF1234567890");
  });

  test("strips BEFORE truncation so a key at the boundary cannot leak", () => {
    const key = "sk-abcdefgh12345678";
    const msg = `message ${key}`; // key near end — would survive a naive truncate-first
    const padded = `${"x".repeat(180)}${msg}`;
    const out = sanitizeLogString(padded);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).not.toContain(key);
  });

  test("truncates long messages to 200 chars", () => {
    expect(sanitizeLogString("x".repeat(500))).toHaveLength(200);
    expect(sanitizeLogString("short")).toBe("short");
  });

  test("uses Error.message and degrades non-strings safely", () => {
    expect(sanitizeLogString(new Error("boom"))).toBe("boom");
    expect(sanitizeLogString(undefined)).toBe("");
    expect(sanitizeLogString(null)).toBe("");
    expect(sanitizeLogString(42)).toBe("42");
    expect(sanitizeLogString({ toString: () => "obj" })).toBe("obj");
  });
});