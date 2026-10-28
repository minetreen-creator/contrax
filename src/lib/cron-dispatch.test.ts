import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DAILY_EMAILS_WORKFLOW, dispatchWorkflow, isAuthorizedCron, safeEqual } from "~/lib/cron-dispatch";

const req = (auth?: string) =>
  new Request("https://www.contrax.company/api/cron/daily-emails?slot=10", auth ? { headers: { authorization: auth } } : {});

describe("cron auth", () => {
  test("accepts only the exact Bearer secret", () => {
    expect(isAuthorizedCron(req("Bearer s3cret"), "s3cret")).toBe(true);
    expect(isAuthorizedCron(req("Bearer wrong!"), "s3cret")).toBe(false);
    expect(isAuthorizedCron(req("s3cret"), "s3cret")).toBe(false);
    expect(isAuthorizedCron(req(), "s3cret")).toBe(false);
  });
  test("fails closed when the secret is unset or empty", () => {
    expect(isAuthorizedCron(req("Bearer "), "")).toBe(false);
    expect(isAuthorizedCron(req("Bearer x"), undefined)).toBe(false);
  });
  test("a query-string token is never accepted", () => {
    const r = new Request("https://www.contrax.company/api/cron/daily-emails?token=s3cret");
    expect(isAuthorizedCron(r, "s3cret")).toBe(false);
  });
  test("safeEqual", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("dispatchWorkflow", () => {
  test("POSTs the dispatch with ref, inputs and the token", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const r = await dispatchWorkflow({ token: "tok", repo: "o/r", workflow: DAILY_EMAILS_WORKFLOW, inputs: { gated: "true" }, fetchImpl: fake });
    expect(r).toEqual({ ok: true, status: 204, detail: "dispatched" });
    expect(seen!.url).toBe("https://api.github.com/repos/o/r/actions/workflows/daily-emails.yml/dispatches");
    expect(seen!.init.method).toBe("POST");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(seen!.init.body))).toEqual({ ref: "main", inputs: { gated: "true" } });
  });
  test("reports GitHub errors and network failures without throwing", async () => {
    const denied = (async () => new Response("Bad credentials", { status: 401 })) as unknown as typeof fetch;
    expect(await dispatchWorkflow({ token: "x", repo: "o/r", workflow: "w.yml", fetchImpl: denied })).toEqual({ ok: false, status: 401, detail: "Bad credentials" });
    const down = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    expect(await dispatchWorkflow({ token: "x", repo: "o/r", workflow: "w.yml", fetchImpl: down })).toEqual({ ok: false, status: 0, detail: "ECONNRESET" });
  });
});

describe("wiring", () => {
  test("the build registers the morning email, bid sync, SAM import and checkout follow-up crons", () => {
    const sh = readFileSync("build-vercel.sh", "utf8");
    const json = sh.slice(sh.indexOf("cat > .vercel/output/config.json <<'JSON'") + "cat > .vercel/output/config.json <<'JSON'".length);
    const cfg = JSON.parse(json.slice(0, json.indexOf("\nJSON")));
    expect(cfg.crons).toEqual([
      { path: "/api/cron/daily-emails?slot=10", schedule: "0 10 * * *" },
      { path: "/api/cron/daily-emails?slot=11", schedule: "0 11 * * *" },
      { path: "/api/cron/sync-bids?slot=weekday", schedule: "0 */4 * * 1-5" },
      { path: "/api/cron/sync-bids?slot=weekend", schedule: "0 15 * * 0,6" },
      { path: "/api/cron/sam-csv", schedule: "17 5 * * *" },
      { path: "/api/cron/checkout-followup", schedule: "23 * * * *" },
    ]);
  });
  test("the workflow passes the gated input to the gate", () => {
    const wf = readFileSync(".github/workflows/daily-emails.yml", "utf8");
    expect(wf).toContain("gated:");
    expect(wf).toContain("GATED: ${{ inputs.gated && 'true' || 'false' }}");
  });
  test("Sync Bids is gated and the sync job waits on the gate", () => {
    const wf = readFileSync(".github/workflows/sync-bids.yml", "utf8");
    expect(wf).toContain("GATED: ${{ inputs.gated && 'true' || 'false' }}");
    expect(wf).toContain("needs: gate");
    expect(wf).toContain("if: needs.gate.outputs.run == 'true'");
    // The sync job keeps its name: the gate script looks it up by name.
    expect(wf).toContain("name: Run bid sync");
  });
});
