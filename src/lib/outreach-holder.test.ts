import { describe, expect, test } from "bun:test";

// Owner 2026-11-16: "we need to reach agencies" (bigger contractors), "go with the $149 bridge",
// "maybe find bigger companies for the $499 offer too".
describe("holder emails", () => {
  const base = {
    kind: "holder" as const, business: "Acme Facility Services, Inc.", bidId: 0,
    bidTitle: "52 openly bid federal Janitorial contracts in New York end in the next 12 months",
    due: "2027-03-31", tradeLabel: "Janitorial", postalAddress: "1 Main St", unsubscribeUrl: "https://x/u", contactId: 7, place: "New York",
  };

  test("the tier follows the size of what is ending", async () => {
    const { holderTier, packHolder, unpackHolder, HOLDER_MIN_TOTAL } = await import("./outreach");
    expect(HOLDER_MIN_TOTAL).toBe(1_000_000);
    expect(holderTier(4_000_000, 1)).toBe("report");
    expect(holderTier(12_000_000, 1)).toBe("managed");
    expect(holderTier(2_000_000, 3)).toBe("managed");
    const packed = packHolder("trade=janitorial&state=NY", "managed", "Public Buildings | Service");
    expect(unpackHolder(packed)).toEqual({ query: "trade=janitorial&state=NY", tier: "managed", agency: "Public Buildings   Service" });
    expect(unpackHolder(null)).toEqual({ query: "", tier: "report", agency: null });
  });

  test("the report email opens with their own contract and names only the one-time price", async () => {
    const { outreachEmail, packHolder } = await import("./outreach");
    const e = outreachEmail({ ...base, buyer: packHolder("trade=janitorial&state=NY", "report", "Public Buildings Service") });
    expect(e.subject).toBe("Your Public Buildings Service contract ends Mar 31, 2027");
    expect(e.text).toContain("Federal records show Acme Facility Services, Inc. holds a Janitorial contract with Public Buildings Service that ends Mar 31, 2027.");
    expect(e.text).toContain("52 openly bid federal Janitorial contracts in New York end in the next 12 months.");
    expect(e.text).toContain("/contracts-ending/new-york/janitorial?");
    expect(e.text).toContain("one-time $149");
    expect(e.text).toContain("/sample-report?");
    expect(e.text).not.toContain("$499");
    expect(e.text).not.toContain("free to the first");
  });

  test("the larger holder gets the monthly plan first and the report as the smaller start", async () => {
    const { outreachEmail, packHolder } = await import("./outreach");
    const e = outreachEmail({ ...base, buyer: packHolder("trade=janitorial&state=NY", "managed", null) });
    expect(e.subject).toBe("Your federal Janitorial contract ends Mar 31, 2027");
    expect(e.text).toContain("with a federal agency that ends");
    expect(e.text.indexOf("$499 a month")).toBeGreaterThan(0);
    expect(e.text.indexOf("$499 a month")).toBeLessThan(e.text.indexOf("one-time $149"));
    expect(e.text).toContain("/teams?");
  });

  test("the job leaves out contracts not openly bid and never guesses an address", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const job = readFileSync("src/jobs/holders-outreach.ts", "utf8");
    expect(job.match(/not_competed = false/g)!.length).toBeGreaterThanOrEqual(3);
    expect(job).toContain("emailFitsSite(e, host, h.name)");
    expect(job).toContain("isNewAddress(email)");
    expect(readFileSync(".github/workflows/holders-outreach.yml", "utf8")).toContain("APPLY: ${{ inputs.apply && 'true' || 'false' }}");
  });
});
