/**
 * Request-context isolation tests (bun test).
 *
 * Proves the AsyncLocalStorage replacement for the old
 * `globalThis.__contrax_request_cookie__/__contrax_request_ip__` stash:
 *   1. concurrent requests with different cookie/IP values never cross-talk;
 *   2. an error thrown mid-request leaves the store clean for the next one.
 */
import { describe, expect, test } from "bun:test";
import { getRequestContext, setRequestContextAccessor } from "./request-context";
import {
  contraxRequestStore,
  runWithRequestContext,
} from "./request-context.server";

// Mirror vercel-entry.ts's boot wiring: point the client-safe readers at the
// AsyncLocalStorage store. (The real launcher gets this for free via the
// module side effect in request-context.server.ts.)
setRequestContextAccessor(() => contraxRequestStore.getStore());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("request-context: AsyncLocalStorage isolation", () => {
  test("two concurrent requests with different cookie/IP values do not cross-talk", async () => {
    const [a, b] = await Promise.all([
      runWithRequestContext(
        { cookie: "contrax_session=alpha", ip: "10.0.0.1" },
        async () => {
          // Interleave with the sibling request so both stores are live at once.
          await sleep(20);
          const ctx = getRequestContext();
          return { cookie: ctx.cookie, ip: ctx.ip };
        },
      ),
      runWithRequestContext(
        { cookie: "contrax_session=beta", ip: "10.0.0.2" },
        async () => {
          await sleep(1);
          const ctx = getRequestContext();
          return { cookie: ctx.cookie, ip: ctx.ip };
        },
      ),
    ]);
    expect(a).toEqual({ cookie: "contrax_session=alpha", ip: "10.0.0.1" });
    expect(b).toEqual({ cookie: "contrax_session=beta", ip: "10.0.0.2" });
  });

  test("an error thrown mid-request leaves the store clean for the next request", async () => {
    await expect(
      runWithRequestContext(
        { cookie: "contrax_session=doomed", ip: "10.0.0.9" },
        async () => {
          // The request saw its own context before blowing up.
          expect(getRequestContext().cookie).toBe("contrax_session=doomed");
          throw new Error("boom");
        },
      ),
    ).rejects.toThrow("boom");

    // Outside any request (and after the error): no leaked context.
    expect(getRequestContext()).toEqual({ cookie: "", ip: "" });

    // A subsequent request is unaffected and sees only its own context.
    const fresh = await runWithRequestContext(
      { cookie: "contrax_session=fresh", ip: "10.0.0.7" },
      async () => {
        const ctx = getRequestContext();
        return { cookie: ctx.cookie, ip: ctx.ip };
      },
    );
    expect(fresh).toEqual({ cookie: "contrax_session=fresh", ip: "10.0.0.7" });
  });

  test("reads outside any request fall back to the empty context (fail-open)", () => {
    expect(getRequestContext()).toEqual({ cookie: "", ip: "" });
  });
});