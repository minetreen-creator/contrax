import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isLookupHiccup } from "./fetch-failure";

describe("a name lookup that timed out gets one more try", () => {
  test("the la_sulphur failure, in the shapes the runtime reports it", () => {
    expect(isLookupHiccup(new Error("getaddrinfo ETIMEOUT www.sulphurla.gov"))).toBe(true);
    expect(isLookupHiccup(Object.assign(new TypeError("fetch failed"), { cause: { code: "ETIMEOUT", syscall: "getaddrinfo", message: "getaddrinfo ETIMEOUT www.sulphurla.gov" } }))).toBe(true);
    expect(isLookupHiccup(Object.assign(new TypeError("fetch failed"), { cause: { code: "EAI_AGAIN", syscall: "getaddrinfo" } }))).toBe(true);
  });

  test("a name that does not exist, a refused or slow connection and an abort are not retried", () => {
    expect(isLookupHiccup(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND", syscall: "getaddrinfo" } }))).toBe(false);
    expect(isLookupHiccup(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED", syscall: "connect" } }))).toBe(false);
    expect(isLookupHiccup(Object.assign(new TypeError("fetch failed"), { cause: { code: "ETIMEDOUT", syscall: "connect" } }))).toBe(false);
    expect(isLookupHiccup(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }))).toBe(false);
    expect(isLookupHiccup(null)).toBe(false);
  });

  test("the board fetch retries only inside its catch, once, and never on an HTTP answer", () => {
    const src = readFileSync(new URL("./sources/civicengage-bids.ts", import.meta.url), "utf8");
    expect(src).toContain("attempt === 1 && isLookupHiccup(e)");
    const afterLoop = src.slice(src.indexOf("if (!resp.ok)"));
    expect(afterLoop).not.toContain("isLookupHiccup");
  });
});
