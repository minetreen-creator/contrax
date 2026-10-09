import { isQaTraffic } from "~/lib/qa-traffic";
/**
 * CLIENT TRACKING QUEUE (owner 2026-10-02 — Vercel CPU).
 *
 * Every trackEvent() / page view used to be its own POST to /api/track-visitor
 * — one server function invocation each; one Radar scan fired ~10. Payloads
 * are now queued and sent together as `{ batch: [...] }` (one invocation):
 *
 *   - after FLUSH_DELAY_MS of quiet, or as soon as MAX_BATCH items queue;
 *   - IMMEDIATELY for the signup one-shot family (signup_*), whose attempt
 *     dedupe and attribution must never wait;
 *   - on pagehide / tab hidden (keepalive fetch), so navigating away never
 *     drops the queue.
 *
 * Each item carries the page URL it was recorded on (`href`), because the
 * server uses the Referer header per item and an SPA can navigate between
 * enqueue and flush. A single queued item is sent in the original one-item
 * shape, byte-identical to before.
 */
const FLUSH_DELAY_MS = 1000;
export const MAX_BATCH = 20;
const ENDPOINT = "/api/track-visitor";

type Payload = Record<string, unknown>;
let queue: Payload[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function send(items: Payload[]): void {
  if (items.length === 0 || isQaTraffic()) return;
  let body: Payload;
  if (items.length === 1) {
    // One item: the original single-payload shape (the Referer header is the
    // page it was recorded on, near enough — flushed within a second).
    const { href: _href, ...single } = items[0];
    body = single;
  } else {
    body = { batch: items };
  }
  try {
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      /* fire-and-forget — never surface tracking failures */
    });
  } catch {
    /* never let tracking break rendering */
  }
}

/** Send everything queued now. */
export function flushTracking(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  while (queue.length > 0) send(queue.splice(0, MAX_BATCH));
}

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("pagehide", flushTracking);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushTracking();
  });
}

/** True for events that must be sent without waiting. */
export function isImmediateEvent(event: unknown): boolean {
  return typeof event === "string" && event.startsWith("signup_");
}

/** Queue one /api/track-visitor payload. */
export function enqueueTracking(payload: Payload): void {
  if (typeof window === "undefined" || isQaTraffic()) return;
  listen();
  queue.push({ ...payload, href: payload.href ?? window.location.href });
  if (isImmediateEvent(payload.event) || queue.length >= MAX_BATCH) {
    flushTracking();
    return;
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushTracking, FLUSH_DELAY_MS);
}
