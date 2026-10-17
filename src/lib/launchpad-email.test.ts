import { describe, expect, test } from "bun:test";
import { parseStatementRequest, statementEmailHtml } from "./launchpad-email";
import { emptyLaunchpad } from "./launchpad";

const complete = {
  ...emptyLaunchpad().profile,
  company: "Acme Cleaning LLC",
  trade: "Janitorial",
  state: "VA",
  contact: "Pat Lee",
  email: "Pat@Example.com ",
  summary: "Commercial cleaning for public buildings.",
  competencies: "Day porter, floor care",
  differentiators: "Bonded and insured",
};

describe("parseStatementRequest", () => {
  test("accepts a complete statement and normalizes the email", () => {
    const r = parseStatementRequest({ profile: complete, visitor_id: "v1" });
    expect(r?.profile.email).toBe("pat@example.com");
    expect(r?.alerts).toBe(false);
    expect(r?.visitorId).toBe("v1");
  });
  test("alerts only when explicitly true", () => {
    expect(parseStatementRequest({ profile: complete, alerts: "true" })?.alerts).toBe(false);
    expect(parseStatementRequest({ profile: complete, alerts: true })?.alerts).toBe(true);
  });
  test("rejects an incomplete statement or a bad email", () => {
    expect(parseStatementRequest({ profile: { ...complete, summary: "" } })).toBeNull();
    expect(parseStatementRequest({ profile: { ...complete, email: "not-an-email" } })).toBeNull();
    expect(parseStatementRequest(null)).toBeNull();
    expect(parseStatementRequest({})).toBeNull();
  });
  test("a non-code state fails the statement rather than being stored", () => {
    expect(parseStatementRequest({ profile: { ...complete, state: "Virginia" } })).toBeNull();
  });
  test("non-string fields are ignored", () => {
    expect(parseStatementRequest({ profile: { ...complete, phone: { evil: 1 } } })?.profile.phone).toBe("");
  });
});

describe("statementEmailHtml", () => {
  test("escapes everything the visitor typed", () => {
    const r = parseStatementRequest({ profile: { ...complete, company: "<script>alert(1)</script>", summary: "<img src=x onerror=1>" } })!;
    const html = statementEmailHtml(r.profile, false);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });
  test("the only link is back to Launchpad; a typed website is plain text", () => {
    const r = parseStatementRequest({ profile: { ...complete, website: "https://evil.example" } })!;
    const html = statementEmailHtml(r.profile, false);
    expect(html.match(/href="/g)?.length).toBe(1);
    expect(html).toContain('href="https://www.contrax.company/launchpad"');
    expect(html).toContain("https://evil.example");
  });
  test("mentions the confirmation step only when alerts were requested", () => {
    const r = parseStatementRequest({ profile: complete })!;
    expect(statementEmailHtml(r.profile, true)).toContain("confirm");
    expect(statementEmailHtml(r.profile, false)).not.toContain("separate message");
  });
});
