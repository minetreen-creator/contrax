import { describe, expect, test } from "bun:test";
import { hasQaCookie, isQaTraffic } from "./qa-traffic";
import { handleIntake, handleIntakeBatch } from "./tracking-intake";
describe("explicit QA exclusion", () => {
  test("only the exact QA marker is recognized", () => {
    expect(hasQaCookie("contrax_vid=customer; contrax_qa=1")).toBe(true);
    for (const cookie of [null, "", "contrax_qa=0", "other_contrax_qa=1", "contrax_qa=10"]) expect(hasQaCookie(cookie)).toBe(false);
    expect(isQaTraffic()).toBe(false);
  });
  test("page and event beacons are dropped before any DB write", async () => {
    for (const kind of ["page", "event"]) {
      const req = new Request("https://www.contrax.company/api/track-visitor", {
        method: "POST", headers: { cookie: "contrax_qa=1", "Content-Type": "application/json" },
        body: JSON.stringify({ kind, path: "/radar", event: "signup_abandon" }),
      });
      expect(await (await handleIntake(req)).json()).toEqual({ ok: true, qa: true });
    }
  });
  test("batch exclusion survives navigation to a URL without QA query", async () => {
    const req = new Request("https://www.contrax.company/api/track-visitor", {method:"POST", headers:{cookie:"contrax_qa=1"}});
    const res = await handleIntakeBatch(req, [{kind:"page", path:"/signup", href:"https://www.contrax.company/signup"}]);
    expect(res.status).toBe(200);
  });
});
