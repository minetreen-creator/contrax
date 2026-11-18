import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { packSupplierPitch, supplierPitch, supplierPitchBody, supplierPitchSubject, unpackSupplierPitch } from "./supplier-outreach";
import type { SupplierSample } from "./supplier-report";

const sample: SupplierSample = {
  state: "SC", stateName: "South Carolina", open: 84, newThisWeek: 19, closingSoon: 22,
  newJobs: [{ id: 1, title: "Sunset Park Partial Roof Replacement", agency: "Rock Hill School District 3", due: "2026-12-17" }],
  awards: [{ company: "Brantley Construction Services, LLC", where: "North Charleston, SC", amount: 7_900_000, date: "2026-11-06", what: "GAOA Buck Hall Recreation Phase 1 Renovation", url: "https://example.test/a", site: null, address: "8300 Dorchester Rd, North Charleston, SC 29418", contact: "Christina McAlhaney" }],
  ending: [],
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("supplier email", () => {
  test("every fact in the email comes from the live sample", () => {
    const p = supplierPitch(sample, "materials")!;
    expect(supplierPitchSubject("South Carolina", p)).toBe("Brantley Construction Services just won $7.9 million of federal work in South Carolina");
    const text = supplierPitchBody("Acme Supply", "South Carolina", p, "https://x.test/suppliers").join("\n");
    expect(text).toContain("Sunset Park Partial Roof Replacement, Rock Hill School District 3, bids due Dec 17");
    expect(text).toContain("84 public construction jobs are open in South Carolina, and 22 of them close in the next 7 days.");
    expect(text).toContain("The contact on file there is Christina McAlhaney.");
    expect(text).toContain('Reply "report"');
    expect(text).toContain("$199 a month, month to month");
    // The free offer comes before the price.
    expect(text.indexOf("free")).toBeLessThan(text.indexOf("$199"));
    // No phone number or email address of the winner is in the email.
    expect(text).not.toMatch(/\(\d{3}\)|\d{3}-\d{3}-\d{4}|@/);
  });
  test("the pitch survives being stored on the draft row, and nothing is sent without real rows", () => {
    const p = supplierPitch(sample, "bonding")!;
    expect(unpackSupplierPitch(packSupplierPitch(p))).toEqual(p);
    expect(supplierPitch(null, "materials")).toBeNull();
    expect(supplierPitch({ ...sample, open: 0 }, "materials")).toBeNull();
    expect(supplierPitch({ ...sample, newJobs: [], awards: [] }, "materials")).toBeNull();
    expect(unpackSupplierPitch("not json")).toBeNull();
  });
  test("an unknown business type falls back to the general line", () => {
    expect(supplierPitch(sample, "nonsense")!.type).toBe("other");
  });
  test("the job queues drafts only, checks do-not-contact, and logs no addresses", () => {
    const job = read("../jobs/supplier-outreach.ts");
    expect(job).toContain("isNewAddress(email)");
    expect(job).toContain('process.env.APPLY === "true"');
    expect(job).toContain("nameOnSite(");
    for (const line of job.split("\n").filter((l) => l.includes("console.log"))) expect(line).not.toMatch(/\$\{[^}]*email/i);
    expect(read("./outreach.server.ts")).toContain("'supplier'");
    expect(read("./outreach.ts")).toContain('i.kind === "supplier"');
  });
});
