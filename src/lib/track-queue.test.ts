import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Minimal browser stubs: the queue only needs window.location, listeners and fetch.
type Sent = { url: string; body: unknown };
let sent: Sent[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  sent = [];
  (globalThis as any).window = { location: { href: "https://www.contrax.company/radar" }, addEventListener: () => {} };
  (globalThis as any).document = { addEventListener: () => {}, visibilityState: "visible" };
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response("{}");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
// The stubs must not leak into other test files (bun shares one process).
afterAll(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
});

const { enqueueTracking, flushTracking, isImmediateEvent, MAX_BATCH } = await import("./track-queue");

describe("client tracking queue (owner 2026-10-02)", () => {
  test("several events are sent as ONE batched request with each item's page", () => {
    enqueueTracking({ kind: "event", event: "radar_scan_start" });
    enqueueTracking({ kind: "event", event: "radar_scan_complete" });
    enqueueTracking({ kind: "event", event: "radar_results_viewed" });
    expect(sent.length).toBe(0);
    flushTracking();
    expect(sent.length).toBe(1);
    const body = sent[0].body as { batch: Record<string, unknown>[] };
    expect(sent[0].url).toBe("/api/track-visitor");
    expect(body.batch.map((b) => b.event)).toEqual(["radar_scan_start", "radar_scan_complete", "radar_results_viewed"]);
    expect(body.batch[0].href).toBe("https://www.contrax.company/radar");
  });

  test("a single queued item keeps the original one-payload shape (no href)", () => {
    enqueueTracking({ kind: "page", path: "/pricing" });
    flushTracking();
    expect(sent[0].body).toEqual({ kind: "page", path: "/pricing" });
  });

  test("signup events go out immediately, taking the queue with them", () => {
    enqueueTracking({ kind: "event", event: "radar_scan_start" });
    enqueueTracking({ kind: "event", event: "signup_success" });
    expect(sent.length).toBe(1);
    expect((sent[0].body as { batch: unknown[] }).batch.length).toBe(2);
    expect(isImmediateEvent("signup_start")).toBe(true);
    expect(isImmediateEvent("radar_scan_start")).toBe(false);
  });

  test("a full queue flushes at MAX_BATCH", () => {
    for (let i = 0; i < MAX_BATCH; i++) enqueueTracking({ kind: "event", event: `e${i}` });
    expect(sent.length).toBe(1);
    expect((sent[0].body as { batch: unknown[] }).batch.length).toBe(MAX_BATCH);
  });

  test("server wiring: the endpoint routes { batch } to handleIntakeBatch; BotID once", () => {
    const route = readFileSync(join(import.meta.dir, "..", "routes", "api", "track-visitor.ts"), "utf8");
    const intake = readFileSync(join(import.meta.dir, "tracking-intake.ts"), "utf8");
    expect(route).toContain("if (Array.isArray(batch)) return handleIntakeBatch(request, batch);");
    expect(intake).toContain("const res = await handleIntake(itemRequest, undefined, i > 0);");
    expect(intake).toContain("export const MAX_INTAKE_BATCH = 20;");
  });
});
