import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { POST_PROJECT_PATH, cleanProjectPost, projectPostNotice } from "./private-bid-post";

const good = { business: "Main Street Diner", name: "Pat", email: "Pat@Example.com", work: "Parking lot restriping", city: "Aiken", state: "sc", deadline: "2026-12-10", details: "About 40 spaces, two handicap stalls, arrows. Work must be done on a Sunday." };
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("post your project", () => {
  test("a complete post is cleaned and kept", () => {
    const r = cleanProjectPost(good, "2026-11-18");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.post).toMatchObject({ email: "pat@example.com", state: "SC", deadline: "2026-12-10" });
  });
  test("a deadline is optional, and a past one is refused", () => {
    expect(cleanProjectPost({ ...good, deadline: "" }, "2026-11-18").ok).toBe(true);
    expect(cleanProjectPost({ ...good, deadline: "2026-11-01" }, "2026-11-18").ok).toBe(false);
    expect(cleanProjectPost({ ...good, deadline: "next week" }, "2026-11-18").ok).toBe(false);
  });
  test("missing business, email, work, state or details is refused with a plain message", () => {
    for (const k of ["business", "email", "work", "state", "details"] as const) {
      const r = cleanProjectPost({ ...good, [k]: "" }, "2026-11-18");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(10);
    }
  });
  test("a filled hidden field is refused", () => {
    expect(cleanProjectPost({ ...good, website: "http://x.example" }, "2026-11-18").ok).toBe(false);
  });
  test("the owner's notice says it is not public and names the business", () => {
    const r = cleanProjectPost(good, "2026-11-18");
    if (!r.ok) throw new Error("expected ok");
    const m = projectPostNotice(r.post);
    expect(m.subject).toBe("Project posted for review: Main Street Diner, Aiken, South Carolina");
    expect(m.text).toContain("NOT public yet");
  });
  test("nothing is published by the form: the API only stores and emails", () => {
    const api = read("../routes/api/private-bid-post.ts");
    expect(api).toContain("INSERT INTO private_bid_posts");
    expect(api).not.toContain("PRIVATE_BID_REQUESTS");
    // No request details in the server log (the repo's logs are public).
    expect(api).not.toMatch(/console\.(log|error)\([^)]*\bp\./);
  });
  test("the form page exists and the listing pages link to it", () => {
    expect(read("../routes/private-bids.post.tsx")).toContain('createFileRoute("/private-bids/post")');
    expect(read("../components/PostProjectForm.tsx")).toContain('fetch("/api/private-bid-post"');
    expect(read("../routes/private-bids.index.tsx")).toContain("POST_PROJECT_PATH");
    expect(read("../routes/index.tsx")).toContain("POST_PROJECT_PATH");
    expect(read("../routes/index.tsx")).toContain("Post your project free →");
    expect(POST_PROJECT_PATH).toBe("/private-bids/post");
  });
});
