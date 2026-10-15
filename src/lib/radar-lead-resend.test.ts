import { describe, expect, test } from "bun:test";
import { confirmResendDecision } from "./radar-leads-funnel";

const now = new Date("2026-10-15T23:00:00Z");
const pending = { confirmed_at: null, unsubscribed_at: null, confirm_resent_at: null };

describe("Radar lead confirmation resend (owner 2026-10-15)", () => {
  test("a pending lead can be resent", () => {
    expect(confirmResendDecision(pending, now)).toEqual({ ok: true });
  });
  test("never to a confirmed or unsubscribed lead", () => {
    expect(confirmResendDecision({ ...pending, confirmed_at: "2026-10-15T17:49:00Z" }, now)).toEqual({ ok: false, reason: "already_confirmed" });
    expect(confirmResendDecision({ ...pending, unsubscribed_at: "2026-10-15T18:00:00Z" }, now)).toEqual({ ok: false, reason: "unsubscribed" });
  });
  test("at most once a day", () => {
    expect(confirmResendDecision({ ...pending, confirm_resent_at: "2026-10-15T10:00:00Z" }, now)).toEqual({ ok: false, reason: "too_soon" });
    expect(confirmResendDecision({ ...pending, confirm_resent_at: "2026-10-14T22:00:00Z" }, now)).toEqual({ ok: true });
  });
  test("a missing lead", () => {
    expect(confirmResendDecision(null, now)).toEqual({ ok: false, reason: "not_found" });
  });
});
