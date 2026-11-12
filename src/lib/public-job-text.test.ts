import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { jobSummary, publicJobText, stripAgencyNumbers } from "./bid-job-summary";

const readSrc = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const VDOT =
  "VDOT highway construction advertisement: 2027 PLANT MIX - INTERSTATE (order 756; location Fauquier; route 66; state project PM7D-030-27F, P401; contract time limit 11/19/2027). Bids are due at VDOT's 12/16/2026 letting. Proposals, plans, plan holders and notices are on VDOT's Construction Advertisement Bulletin Board (CABB).";

describe("the free page never shows the agency's own numbers (owner 2026-11-11, leak found 2026-11-12)", () => {
  test("a VDOT description loses its order and project numbers and the note naming where the documents are", () => {
    const out = publicJobText(VDOT, "PM7D-030-27F, P401")!;
    expect(out).toBe("VDOT highway construction advertisement: 2027 PLANT MIX - INTERSTATE (location Fauquier; route 66; contract time limit 11/19/2027). Bids are due at VDOT's 12/16/2026 letting.");
    for (const gone of ["756", "PM7D", "P401", "Bulletin Board", "CABB", "plan holders"]) expect(out).not.toContain(gone);
  });

  test("labelled numbers go even when the bid's own number is not known", () => {
    expect(stripAgencyNumbers("Roof work. Solicitation No. 24-118.")).toBe("Roof work.");
    expect(stripAgencyNumbers("Paving (contract ID C00123456; federal project STP-5A27(123))")).not.toMatch(/C00123456|STP-5A27/);
    expect(stripAgencyNumbers("Bid number: IFB-2026-044 for mowing")).toBe("for mowing");
  });

  test("the bid's stored number is removed wherever it appears, as a whole token", () => {
    expect(stripAgencyNumbers("Work under W912DY26R0012 at the depot", "W912DY26R0012")).toBe("Work under at the depot");
    expect(stripAgencyNumbers("Building 12345 repairs", "1234")).toBe("Building 12345 repairs");
  });

  test("ordinary sentences are left alone", () => {
    const plain = "Furnish and install 12 HVAC units in order to serve 3 schools. Work must finish in 90 days.";
    expect(stripAgencyNumbers(plain)).toBe(plain);
    expect(publicJobText(plain)).toBe(plain);
    expect(publicJobText("")).toBeNull();
    expect(publicJobText(null)).toBeNull();
  });

  test("the summary on the page applies the same rule", () => {
    const s = jobSummary(VDOT, "2027 PLANT MIX - INTERSTATE — Fauquier", null)!;
    expect(s).not.toMatch(/756|PM7D|CABB/);
    expect(s).toContain("location Fauquier");
  });

  test("the cleaning runs on the server, before the page data is sent", () => {
    const bid = readSrc("src/routes/bid.$bidId.tsx");
    expect(bid).toContain("description: publicJobText(r.description ? String(r.description) : null, r.solicitation_number ? String(r.solicitation_number) : null),");
    expect(readSrc("src/lib/seo-landing.tsx")).toContain("description: publicJobText(");
    // Company pages show no description, so none is stored or sent.
    expect(readSrc("src/lib/company-pages.server.ts")).toContain("description: null,");
  });
});
