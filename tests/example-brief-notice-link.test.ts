/**
 * ── NEW (owner 09-18 follow-up to PR #397) ─────────────────────────────────
 * Unit tests for the bounded, cached "does the original notice URL RESOLVE?"
 * probe (~/lib/notice-link-check.ts).
 *
 * The production evidence pinned here: the NYC City Record link that the
 * homepage example used to display —
 *   https://a856-cityrecord.nyc.gov/20260902028
 * — redirects to https://a856-cityrecord.nyc.gov/Error/Error404?aspxerrorpath=/20260902028,
 * and that error page answers **HTTP 200**. A status-code-only check calls it
 * healthy; the probe must not.
 *
 * No network: every case injects `fetchImpl` / a body stream.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  NOTICE_LINK_MAX_BYTES,
  NOTICE_LINK_TTL_ENV,
  NOTICE_LINK_UNKNOWN_TTL_MS,
  __noticeLinkCacheSize,
  __resetNoticeLinkCache,
  checkNoticeLink,
  looksLikeErrorPage,
  noticeLinkTimeoutMs,
  parseEnvInt,
  probeNoticeLink,
} from "~/lib/notice-link-check";

/** A Response stand-in whose final URL we control (Response.url is read-only). */
function fakeResponse(init: {
  status?: number;
  url?: string;
  contentType?: string;
  body?: string;
}): Response {
  const { status = 200, url = "", contentType = "text/html; charset=utf-8", body = "" } = init;
  return {
    status,
    url,
    headers: new Headers({ "content-type": contentType }),
    body: new Response(body).body,
  } as unknown as Response;
}

beforeEach(() => {
  __resetNoticeLinkCache();
});

describe("NEW notice link — the dead NYC City Record link", () => {
  const DEAD_INPUT = "https://a856-cityrecord.nyc.gov/20260902028";
  const DEAD_FINAL = "https://a856-cityrecord.nyc.gov/Error/Error404?aspxerrorpath=/20260902028";

  test("a 200-answering publisher error page is DEAD, not healthy", async () => {
    const probe = await probeNoticeLink(DEAD_INPUT, {
      fetchImpl: (async () =>
        fakeResponse({ status: 200, url: DEAD_FINAL })) as unknown as typeof fetch,
    });
    expect(probe.status).toBe("dead");
    expect(probe.reason).toBe("error_page_redirect");
    expect(probe.httpStatus).toBe(200);
  });

  test("the observed error-page URL/title shape is recognised by the shared rule", () => {
    expect(looksLikeErrorPage(DEAD_FINAL, "")).toBe(true);
    expect(looksLikeErrorPage("https://x.test/notice/1", "<title>The City Record Online (CROL) | 404 Error</title>")).toBe(true);
    expect(looksLikeErrorPage("https://x.test/notice/1", "<h1>Page Not Found</h1>")).toBe(true);
    expect(
      looksLikeErrorPage(
        "https://a856-cityrecord.nyc.gov/RequestDetail/20260902028",
        "<title>The City Record Online (CROL) | Notice Details</title><h1>Harlem Hospital</h1>",
      ),
    ).toBe(false);
  });

  test("the CORRECT notice URL (RequestDetail) probes live", async () => {
    const probe = await probeNoticeLink("https://a856-cityrecord.nyc.gov/RequestDetail/20260902028", {
      fetchImpl: (async () =>
        fakeResponse({
          status: 200,
          url: "https://a856-cityrecord.nyc.gov/RequestDetail/20260902028",
          body: "<title>The City Record Online (CROL) | Notice Details</title>",
        })) as unknown as typeof fetch,
    });
    expect(probe.status).toBe("live");
  });
});

describe("NEW notice link — outcome mapping", () => {
  const ok = (res: Response) => (async () => res) as unknown as typeof fetch;

  test("4xx/5xx destinations are dead", async () => {
    for (const status of [400, 404, 410, 500, 503]) {
      const probe = await probeNoticeLink("https://x.test/a", {
        fetchImpl: ok(fakeResponse({ status })),
      });
      expect(probe.status).toBe("dead");
      expect(probe.reason).toBe(`http_${status}`);
    }
  });

  test("bot-blocking statuses are UNKNOWN (never claimed dead)", async () => {
    for (const status of [401, 403, 429]) {
      const probe = await probeNoticeLink("https://x.test/a", {
        fetchImpl: ok(fakeResponse({ status })),
      });
      expect(probe.status).toBe("unknown");
    }
  });

  test("a timeout is unknown, never dead", async () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    const probe = await probeNoticeLink("https://x.test/a", {
      timeoutMs: 25,
      fetchImpl: (async () => {
        throw err;
      }) as unknown as typeof fetch,
    });
    expect(probe.status).toBe("unknown");
    expect(probe.reason).toBe("timeout");
  });

  test("a network error is unknown, never dead", async () => {
    const probe = await probeNoticeLink("https://x.test/a", {
      fetchImpl: (async () => {
        throw new Error("ENOTFOUND");
      }) as unknown as typeof fetch,
    });
    expect(probe.status).toBe("unknown");
    expect(probe.reason).toBe("network_error");
  });

  test("a malformed or non-http URL is dead (it cannot open)", async () => {
    expect((await probeNoticeLink("not a url", {})).status).toBe("dead");
    expect((await probeNoticeLink("mailto:someone@x.test", {})).status).toBe("dead");
    expect((await probeNoticeLink("not a url", {})).reason).toBe("invalid_url");
  });

  test("a normal 200 notice page is live", async () => {
    const probe = await probeNoticeLink("https://x.test/a", {
      fetchImpl: ok(fakeResponse({ status: 200, body: "<title>Notice</title>ok" })),
    });
    expect(probe.status).toBe("live");
  });

  test("a non-HTML 200 (a PDF notice) is live without body sniffing", async () => {
    const probe = await probeNoticeLink("https://x.test/a.pdf", {
      fetchImpl: ok(
        fakeResponse({ status: 200, contentType: "application/pdf", body: "%PDF-1.7" }),
      ),
    });
    expect(probe.status).toBe("live");
  });
});

describe("NEW notice link — the probe is tiny (no document download)", () => {
  test("the body read stops at the byte cap and cancels the stream", async () => {
    let pulls = 0;
    let cancelled = false;
    const chunk = new Uint8Array(1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 10_000) controller.close();
        else controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const res = {
      status: 200,
      url: "https://x.test/big",
      headers: new Headers({ "content-type": "text/html" }),
      body: stream,
    } as unknown as Response;

    const probe = await probeNoticeLink("https://x.test/big", {
      fetchImpl: (async () => res) as unknown as typeof fetch,
    });
    expect(probe.status).toBe("live");
    expect(cancelled).toBe(true);
    // ~16 KB read, not a multi-MB document.
    expect(pulls).toBeLessThanOrEqual(Math.ceil(NOTICE_LINK_MAX_BYTES / 1024) + 1);
  });
});

describe("NEW notice link — caching (fast paths never re-fetch inside the TTL)", () => {
  const probeFor = (status: number, body = "<title>Notice</title>") => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return fakeResponse({ status, url: "https://x.test/a", body });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls: () => calls };
  };

  test("a proven-dead URL is probed once and remembered", async () => {
    const f = probeFor(404);
    let clock = 1_000_000;
    const now = () => clock;
    const first = await checkNoticeLink("https://x.test/a", { fetchImpl: f.fetchImpl, now });
    const second = await checkNoticeLink("https://x.test/a", { fetchImpl: f.fetchImpl, now });
    expect(first.status).toBe("dead");
    expect(second.status).toBe("dead");
    expect(f.calls()).toBe(1);
    expect(__noticeLinkCacheSize()).toBe(1);

    // Still cached at 11 h, re-probed at 13 h (default ~12 h TTL).
    clock += 11 * 60 * 60 * 1000;
    await checkNoticeLink("https://x.test/a", { fetchImpl: f.fetchImpl, now });
    expect(f.calls()).toBe(1);
    clock += 2 * 60 * 60 * 1000;
    await checkNoticeLink("https://x.test/a", { fetchImpl: f.fetchImpl, now });
    expect(f.calls()).toBe(2);
  });

  test("an UNKNOWN result is only remembered briefly (a transient failure is retried)", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;
    let clock = 5_000_000;
    const now = () => clock;

    expect((await checkNoticeLink("https://x.test/flaky", { fetchImpl, now })).status).toBe(
      "unknown",
    );
    await checkNoticeLink("https://x.test/flaky", { fetchImpl, now });
    expect(calls).toBe(1);

    clock += NOTICE_LINK_UNKNOWN_TTL_MS + 1_000;
    await checkNoticeLink("https://x.test/flaky", { fetchImpl, now });
    expect(calls).toBe(2);
  });

  test("concurrent checks for the same URL share ONE probe", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return fakeResponse({ status: 200, url: "https://x.test/a", body: "<title>N</title>" });
    }) as unknown as typeof fetch;

    const [a, b, c] = await Promise.all([
      checkNoticeLink("https://x.test/a", { fetchImpl }),
      checkNoticeLink("https://x.test/a", { fetchImpl }),
      checkNoticeLink("https://x.test/a", { fetchImpl }),
    ]);
    expect([a.status, b.status, c.status]).toEqual(["live", "live", "live"]);
    expect(calls).toBe(1);
  });

  test("the cache TTL is env-overridable", async () => {
    const f = probeFor(200);
    let clock = 10_000_000;
    const now = () => clock;
    const env = { [NOTICE_LINK_TTL_ENV]: "60000" };
    await checkNoticeLink("https://x.test/a", { fetchImpl: f.fetchImpl, now, env });
    clock += 61_000;
    await checkNoticeLink("https://x.test/a", { fetchImpl: f.fetchImpl, now, env });
    expect(f.calls()).toBe(2);
  });
});

describe("NEW notice link — env parsing", () => {
  test("timeout parsing falls back on junk and clamps", () => {
    expect(noticeLinkTimeoutMs({})).toBe(4_500);
    expect(noticeLinkTimeoutMs({ EXAMPLE_BRIEF_LINK_CHECK_TIMEOUT_MS: "3000" })).toBe(3_000);
    expect(noticeLinkTimeoutMs({ EXAMPLE_BRIEF_LINK_CHECK_TIMEOUT_MS: "junk" })).toBe(4_500);
    expect(noticeLinkTimeoutMs({ EXAMPLE_BRIEF_LINK_CHECK_TIMEOUT_MS: "999999" })).toBe(10_000);
    expect(parseEnvInt({}, "X", 7, 1, 10)).toBe(7);
    expect(parseEnvInt({ X: "12" }, "X", 7, 1, 10)).toBe(10);
  });
});
