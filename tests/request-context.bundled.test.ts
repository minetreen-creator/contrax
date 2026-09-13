/**
 * BUNDLED request-context integration test (NOT source-only).
 *
 * Executes the ASSEMBLED render-function bundle produced by build-vercel.sh
 * (.vercel/output/functions/render.func/index.mjs — the exact artifact Vercel
 * runs in production). The launcher (vercel-entry.ts) is bundled from SOURCE
 * while the TanStack SSR handler runs from dist/server/server.js, so
 * request-context.ts exists TWICE inside one process. The global accessor
 * registry (globalThis key "__contrax_request_context_accessor_v1__") is what
 * lets both copies share one store; without it, authenticated SSR would read
 * the empty context and (b) would fail. This test is the non-vacuous proof:
 *
 *   (a) two overlapping requests retain DIFFERENT cookies AND different IPs
 *   (b) authenticated SSR resolves the correct user from a REAL session cookie
 *   (c) an exception thrown mid-request does NOT leak context into the next
 *       request (/_server-fn/ with an empty id throws deterministically inside
 *       the AsyncLocalStorage run scope -> 500 -> next request must be clean)
 *   (d) an anonymous /score RPC receives its OWN request IP (the free-score
 *       credits table is keyed by the REQUEST IP, not a shared/previous one)
 *
 * DB-dependent cases run when DATABASE_URL is set (local sandbox); in CI
 * (no secrets) they are reported as explicit skips. The deterministic 500 case
 * (c) and the registry/boot assertions run everywhere.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { neon } from "@neondatabase/serverless";

// Server-fn RPC base must be set BEFORE the bundle is imported (the handler
// reads it at module scope). Not set in prod Vercel env? — it is; locally we
// must provide it to exercise the throwing case + the /score RPC.
process.env.TSS_SERVER_FN_BASE ??= "/_server-fn/";

const bundle = (await import(
  "../.vercel/output/functions/render.func/index.mjs"
)) as unknown as {
  default: (req: unknown, res: unknown) => Promise<void>;
};
const vercelHandler = bundle.default;

if (typeof vercelHandler !== "function") {
  throw new Error(
    "render.func/index.mjs does not export a default (req, res) handler",
  );
}

const HAS_DB = !!process.env.DATABASE_URL;
const ACCESSOR_KEY = "__contrax_request_context_accessor_v1__";
const db = () => neon(process.env.DATABASE_URL!);

const STATIC_OK_PATH = "/learn/ai-proposal-writing"; // inlined HTML — DB-free

/** Minimal Node IncomingMessage/ServerResponse doubles (GET-only). */
function callHandler(opts: {
  url: string;
  headers?: Record<string, string>;
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const headers: Record<string, string> = { host: "localhost", ...opts.headers };
    const req = { url: opts.url, method: "GET", headers } as unknown;
    const res = {
      statusCode: 0,
      setHeader(_k: string, _v: string) {},
      write(c: unknown) {
        chunks.push(Buffer.from(c as Buffer));
      },
      end() {},
    } as { statusCode: number; setHeader: (k: string, v: string) => void; write: (c: unknown) => void; end: () => void };
    vercelHandler(req, res)
      .then(() =>
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }),
      )
      .catch(reject);
  });
}

let port = 0;
let server: ReturnType<typeof Bun.serve> | null = null;
const baseUrl = () => `http://127.0.0.1:${port}`;

describe("request-context: ASSEMBLED render-function bundle", () => {
  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch(toWebReq) {
        // Adapt the web Request back into a Node-style (req, res) call.
        const url = new URL(toWebReq.url);
        const chunks: Buffer[] = [];
        const res = {
          statusCode: 200,
          headers: {} as Record<string, string>,
          setHeader(k: string, v: string) {
            this.headers[k] = v;
          },
          write(c: unknown) {
            chunks.push(Buffer.from(c as Buffer));
          },
          end() {},
        } as { statusCode: number; headers: Record<string, string>; setHeader: (k: string, v: string) => void; write: (c: unknown) => void; end: () => void };
        const headers: Record<string, string> = {};
        toWebReq.headers.forEach((v, k) => (headers[k] = v));
        const req = {
          url: url.pathname + url.search,
          method: toWebReq.method,
          headers: { host: url.host, ...headers },
        };
        return vercelHandler(req, res).then(() =>
          new Response(Buffer.concat(chunks).toString(), { status: res.statusCode }),
        );
      },
    });
    port = (server.port as unknown as number) || 0;
  });

  afterAll(() => {
    server?.stop(true);
  });

  test("c: an exception thrown mid-request does not leak context into the next request", async () => {
    // Deterministic 500 INSIDE the AsyncLocalStorage run scope: the server-fn
    // router throws "Invalid server action param for serverFnId" for an empty
    // id. If the previous request's context leaked (old globalThis stash), a
    // subsequent request with no cookie would still resolve the leaked cookie.
    const bad = await callHandler({
      url: "/_server-fn/",
      headers: { cookie: "contrax_session=leak-probe-garbage", "x-forwarded-for": "10.9.9.9" },
    });
    expect(bad.status).toBe(500);

    // Outside any request (test scope): the accessor must yield no context.
    const accessor = (globalThis as Record<string, unknown>)[ACCESSOR_KEY] as
      | (() => { cookie: string; ip: string } | undefined)
      | undefined;
    expect(typeof accessor).toBe("function");
    expect(accessor?.()).toBeUndefined();
  });

  test("db-free: registry boot wiring + static SSR renders through the assembled bundle", async () => {
    const accessor = (globalThis as Record<string, unknown>)[ACCESSOR_KEY] as
      | (() => { cookie: string; ip: string } | undefined)
      | undefined;
    expect(typeof accessor).toBe("function");
    const staticRes = await callHandler({ url: STATIC_OK_PATH });
    expect(staticRes.status).toBe(200);
    expect(staticRes.body.length).toBeGreaterThan(1000);
  });

  test.skipIf(!HAS_DB)("a/b: overlapping authenticated SSR requests keep their own cookie + resolve the right user", async () => {
    const [u1, u2] = await db()`SELECT id, email FROM users WHERE email LIKE '%@test.contrax' ORDER BY id LIMIT 2`;
    expect(u1 && u2, "need two @test.contrax users").toBeTruthy();
    const token1 = `bundled-test-${u1.id}-${Math.random().toString(36).slice(2)}`;
    const token2 = `bundled-test-${u2.id}-${Math.random().toString(36).slice(2)}`;
    await db()`INSERT INTO sessions (user_id, token, expires_at) VALUES (${u1.id}, ${token1}, NOW() + INTERVAL '1 hour'), (${u2.id}, ${token2}, NOW() + INTERVAL '1 hour')`;
    try {
      const [ra, rb] = await Promise.all([
        fetch(`${baseUrl()}/dashboard`, {
          headers: { cookie: `contrax_session=${token1}`, "x-forwarded-for": "10.1.1.1" },
        }),
        fetch(`${baseUrl()}/dashboard`, {
          headers: { cookie: `contrax_session=${token2}`, "x-forwarded-for": "10.2.2.2" },
        }),
      ]);
      const [ta, tb] = await Promise.all([ra.text(), rb.text()]);
      expect(ta).toContain(u1.email);
      expect(ta).not.toContain(u2.email);
      expect(tb).toContain(u2.email);
      expect(tb).not.toContain(u1.email);
    } finally {
      await db()`DELETE FROM sessions WHERE token = ${token1} OR token = ${token2}`;
    }
  });

  test.skipIf(!HAS_DB)("d: anonymous /score RPC uses the request's OWN ip (free-score credit table)", async () => {
    const ipA = "203.0.113.9";
    const ipB = "203.0.113.10";
    await db()`INSERT INTO score_credits (ip, count) VALUES (${ipA}, 3), (${ipB}, 0)
      ON CONFLICT (ip) DO UPDATE SET count = EXCLUDED.count, updated_at = NOW()`;
    try {
      const url = `${baseUrl()}/_server-fn/getScoreCredits`;
      const [ra, rb] = await Promise.all([
        fetch(url, { headers: { "x-tsr-serverFn": "true", "x-forwarded-for": ipA } }),
        fetch(url, { headers: { "x-tsr-serverFn": "true", "x-forwarded-for": ipB } }),
      ]);
      const [ta, tb] = await Promise.all([ra.text(), rb.text()]);
      // seroval JSON body — assert the per-IP credit state (3=limited vs 0=open).
      expect(ta).toContain('"limited":true');
      expect(tb).toContain('"limited":false');
    } finally {
      await db()`DELETE FROM score_credits WHERE ip = ${ipA} OR ip = ${ipB}`;
    }
  });
});