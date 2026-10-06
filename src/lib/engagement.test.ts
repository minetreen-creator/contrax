import { describe, expect, test } from "bun:test";
import { ENGAGED_EVENT, ENGAGED_MS, scrolledEnough } from "./engagement";

describe("engaged-visit signal (owner 2026-10-06)", () => {
  test("constants", () => {
    expect(ENGAGED_EVENT).toBe("page_engaged");
    expect(ENGAGED_MS).toBe(15_000);
  });
  test("half of the scrollable distance counts; top of the page doesn't", () => {
    // 800px viewport, 2800px page → 2000px scrollable.
    expect(scrolledEnough(0, 800, 2800)).toBe(false);
    expect(scrolledEnough(999, 800, 2800)).toBe(false);
    expect(scrolledEnough(1000, 800, 2800)).toBe(true);
  });
  test("a page that fits on one screen never counts as scrolled", () => {
    expect(scrolledEnough(50, 800, 900)).toBe(false);
    expect(scrolledEnough(0, 800, 800)).toBe(false);
  });
});

describe("watchEngagement fires once, on time or scroll", () => {
  // Minimal browser stand-in: captured listeners and interval, controllable clock.
  function fakeBrowser(docH: number) {
    const listeners: Record<string, () => void> = {};
    let tick: (() => void) | null = null;
    let now = 1_000_000;
    const g = globalThis as Record<string, unknown>;
    const saved = { window: g.window, document: g.document, now: Date.now };
    g.window = {
      scrollY: 0,
      innerHeight: 800,
      addEventListener: (t: string, f: () => void) => (listeners[t] = f),
      removeEventListener: (t: string) => delete listeners[t],
      setInterval: (f: () => void) => ((tick = f), 1),
      clearInterval: () => (tick = null),
    };
    g.document = { visibilityState: "visible", documentElement: { scrollHeight: docH } };
    Date.now = () => now;
    return {
      advance(ms: number) {
        now += ms;
        tick?.();
      },
      scrollTo(y: number) {
        (g.window as { scrollY: number }).scrollY = y;
        listeners.scroll?.();
      },
      hidden() {
        (g.document as { visibilityState: string }).visibilityState = "hidden";
      },
      get ticking() {
        return tick !== null;
      },
      restore() {
        g.window = saved.window;
        g.document = saved.document;
        Date.now = saved.now;
      },
    };
  }

  test("15 visible seconds → one 'time' event, then it stops watching", async () => {
    const { watchEngagement } = await import("./engagement");
    const b = fakeBrowser(3000);
    const sent: string[][] = [];
    try {
      watchEngagement("/radar", (e, l, p) => sent.push([e, l ?? "", p ?? ""]));
      b.advance(14_000);
      expect(sent).toEqual([]);
      b.advance(1_000);
      expect(sent).toEqual([["page_engaged", "time", "/radar"]]);
      expect(b.ticking).toBe(false);
      b.scrollTo(3000);
      expect(sent.length).toBe(1);
    } finally {
      b.restore();
    }
  });

  test("time while the tab is hidden doesn't count", async () => {
    const { watchEngagement } = await import("./engagement");
    const b = fakeBrowser(3000);
    const sent: string[][] = [];
    try {
      watchEngagement("/", (e, l, p) => sent.push([e, l ?? "", p ?? ""]));
      b.hidden();
      b.advance(60_000);
      expect(sent).toEqual([]);
    } finally {
      b.restore();
    }
  });

  test("scrolling halfway → one 'scroll' event; admin pages are never watched; cleanup stops it", async () => {
    const { watchEngagement } = await import("./engagement");
    const b = fakeBrowser(2800);
    const sent: string[][] = [];
    try {
      watchEngagement("/pricing", (e, l, p) => sent.push([e, l ?? "", p ?? ""]));
      b.scrollTo(1000);
      expect(sent).toEqual([["page_engaged", "scroll", "/pricing"]]);
      const stopAdmin = watchEngagement("/admin/journeys", (e) => sent.push([e]));
      stopAdmin();
      const stop = watchEngagement("/data", (e) => sent.push([e]));
      stop();
      b.advance(20_000);
      expect(sent.length).toBe(1);
    } finally {
      b.restore();
    }
  });
});
