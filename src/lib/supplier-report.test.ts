import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SUPPLIER_AWARD_MIN, SUPPLIER_CONTACT_NOTE, SUPPLIER_MULTI_STATE, SUPPLIER_USES, SUPPLIER_SUBHEAD, SUPPLIER_NOT_YET, SUPPLIER_PRICE, SUPPLIER_SAMPLE_STATES, cleanSupplierRequest, supplierDay, supplierMoney, supplierNotice } from "./supplier-report";

describe("supplier report (owner 2026-11-18)", () => {
  test("a request needs a real email and a real state; the business type falls back", () => {
    expect(cleanSupplierRequest({ email: "nope", state: "SC" })).toEqual({ ok: false, error: "Enter the email address the report should go to." });
    expect(cleanSupplierRequest({ email: "a@b.co", state: "ZZ" })).toEqual({ ok: false, error: "Pick the state you sell in." });
    expect(cleanSupplierRequest(null).ok).toBe(false);
    expect(cleanSupplierRequest({ email: " Buyer@Truss.CO ", state: "sc", company: "  Carolina   Truss ", type: "made-up" })).toEqual({
      ok: true,
      request: { email: "buyer@truss.co", company: "Carolina Truss", type: "other", state: "SC" },
    });
  });
  test("the owner's notice names the company, business, state and email", () => {
    const m = supplierNotice({ email: "buyer@truss.co", company: "Carolina Truss", type: "materials", state: "SC" });
    expect(m.subject).toBe("Supplier report request: Carolina Truss, South Carolina");
    expect(m.text).toContain("Business: Building materials or supply");
    expect(m.text).toContain("Email: buyer@truss.co");
    expect(m.text).toContain(SUPPLIER_PRICE);
  });
  test("money and dates read plainly", () => {
    expect(supplierMoney(7918965)).toBe("$7.9 million");
    expect(supplierMoney(890535)).toBe("$890,535");
    expect(supplierMoney(1_300_000_000)).toBe("$1.3 billion");
    expect(supplierMoney(0)).toBe("");
    expect(supplierDay("2026-12-18T00:00:00.000Z")).toBe("Dec 18");
    expect(supplierDay("nonsense")).toBe("");
  });
  test("the page never promises local award winners, sells the Agency plan as the paid step, and the homepage links to it", () => {
    const page = readFileSync(new URL("../routes/suppliers.tsx", import.meta.url), "utf8");
    expect(SUPPLIER_NOT_YET).toContain("not in the report yet");
    expect(page).toContain("{SUPPLIER_NOT_YET}");
    // The paid step is the existing Agency plan at $199 (owner 2026-11-12), the same price the form names.
    expect(SUPPLIER_PRICE).toBe("$199");
    expect(page).toContain('href="/upgrade?plan=agency&source=suppliers"');
    expect(readFileSync(new URL("../components/SupplierRequestForm.tsx", import.meta.url), "utf8")).toContain('fetch("/api/supplier-report"');
    const home = readFileSync(new URL("../routes/index.tsx", import.meta.url), "utf8");
    expect(home).toContain('href="/suppliers"');
    // Owner 2026-11-18: the homepage opens with the supplier report and its request form.
    expect(home).toContain("<HomeSupplierHero samples={supplierSamples} />");
    expect(home).toContain("<HomeSupplierRows key={one.state} sample={one} />");
    // Owner 2026-11-18 ("lets add NC too", "might as well add VA, FL and GA"); small awards left out.
    expect([...SUPPLIER_SAMPLE_STATES]).toEqual(["SC", "NC", "VA", "GA", "FL"]);
    expect(home).toContain("supplierSamples.slice(0, SUPPLIER_HOME_ROW_STATES).map(");
    expect(SUPPLIER_AWARD_MIN).toBe(100_000);
    // The pitch names only what the report holds: no bidder lists, no contact details, federal winners only.
    expect(SUPPLIER_SUBHEAD).toContain("who just won federal work");
    expect(SUPPLIER_SUBHEAD).not.toMatch(/about to bid|phone|contact/i);
    expect(home + page).not.toMatch(/555-01\d\d/);
    // Review 2026-11-18: how to use it, what a row contains, tailoring and several states, all true of what ships.
    expect(SUPPLIER_USES).toHaveLength(3);
    expect(SUPPLIER_USES.map((u) => u.use).join(" ")).not.toMatch(/bidding contractors|bidders list|phone/i);
    expect(SUPPLIER_CONTACT_NOTE).toContain("does not include phone numbers or email addresses");
    // The address and contact come from a separate lookup, so a missing table never hides an award.
    expect(readFileSync(new URL("./supplier-report.server.ts", import.meta.url), "utf8")).toContain("FROM sam_contacts WHERE uei = ANY(${ueis})`.catch(() => [])");
    expect(page).toContain("Contact on file: {a.contact}");
    expect(SUPPLIER_MULTI_STATE).toContain("up to 10 territories");
    expect(readFileSync(new URL("./plan-features.ts", import.meta.url), "utf8")).toContain("Up to 10 client workspaces");
    expect(page).toContain("{SUPPLIER_CONTACT_NOTE}");
    // The homepage carries one short line of fine print; the full wording is on /suppliers.
    expect(home).toContain("{SUPPLIER_FINE_PRINT_SHORT}");
    expect(home).not.toContain("{SUPPLIER_CONTACT_NOTE}");
    expect(home).toContain("<HomePrivateBids />");
    // Each federal winner links to its public award record instead (real, public, on USAspending.gov).
    expect(home).toContain("<a href={a.url} target=\"_blank\" rel=\"noopener noreferrer\"");
    expect(page).toContain("Federal award record →");
    // 2026-11-18: and to the company's own website when its public SAM.gov registration lists one (about 6 in 10).
    expect(page).toContain("{a.site && (");
    expect(readFileSync(new URL("./supplier-report.server.ts", import.meta.url), "utf8")).toContain("LEFT JOIN sam_registrants r ON r.uei = a.recipient_uei");
    // The contractor sections are one click away, unchanged, on /contractors.
    expect(home).toContain("export function ContractorSections(");
    const contractors = readFileSync(new URL("../routes/contractors.tsx", import.meta.url), "utf8");
    expect(contractors).toContain("<ContractorSections sample={sample} contractMap={contractMap} maxProofCurrent={maxProofCurrent} />");
    expect(readFileSync(new URL("../routes/prep.tsx", import.meta.url), "utf8")).toContain("/contractors?utm_source=");
    expect(home).toContain('<SupplierRequestForm where="home_hero" />');
    expect(home.match(/<h1/g)?.length).toBe(1);
  });
});

describe("readable rows (owner 2026-11-18)", () => {
  test("capitals from government records become title case; acronyms, numbers and mixed case are left alone", async () => {
    const { tidyCaps, clip, SUPPLIER_SUPPLY_PATTERN } = await import("./supplier-report");
    expect(tidyCaps("BRANTLEY CONSTRUCTION SERVICES, LLC")).toBe("Brantley Construction Services, LLC");
    expect(tidyCaps("CITY OF RALEIGH")).toBe("City of Raleigh");
    expect(tidyCaps("EHRM DATA CENTER UPGRADES - CHARLESTON, SC EO 14398")).toBe("EHRM Data Center Upgrades - Charleston, SC EO 14398");
    expect(tidyCaps("DESIGN BUILD CONSTRUCTION FOR HC-130J FLIGHT SIMULATOR FACILITY AT U.S. COAST GUARD BASE")).toBe("Design Build Construction for HC-130J Flight Simulator Facility at U.S. Coast Guard Base");
    expect(tidyCaps("SDC TIDEWATER JV, LLC")).toBe("SDC Tidewater JV, LLC");
    expect(tidyCaps("VDOT HVAC UPGRADE PHASE III")).toBe("VDOT HVAC Upgrade Phase III");
    expect(tidyCaps("ACME BUILDERS INC.")).toBe("Acme Builders Inc.");
    expect(tidyCaps("USCG BASE ELIZABETH CITY, NC")).toBe("USCG Base Elizabeth City, NC");
    expect(tidyCaps("Town of Sullivan's Island")).toBe("Town of Sullivan's Island");
    expect(clip("Design Build Construction for HC-130J Flight Simulator Facility at U.S. Coast Guard Base Elizabeth City", 90)).toBe("Design Build Construction for HC-130J Flight Simulator Facility at U.S. Coast Guard Base…");
    expect(clip("short", 90)).toBe("short");
    // Goods are not construction work.
    const supply = new RegExp(SUPPLIER_SUPPLY_PATTERN.replace(/\\m|\\M/g, "\\b"), "i");
    expect(supply.test("District 6 Deicer for Bridges")).toBe(true);
    expect(supply.test("IFB 161313 Delivered Aggregate")).toBe(true);
    expect(supply.test("Triad Park Roof Replacement")).toBe(false);
    expect(supply.test("Bolin Road Reconstruction")).toBe(false);
  });
});

describe("contact line and design-services requests", () => {
  test("an honorific is not shown as a job title", async () => {
    const { contactLine } = await import("./supplier-report");
    expect(contactLine("Micheal Heath", "Mr.")).toBe("Micheal Heath");
    expect(contactLine("Rafael Cabello", "President")).toBe("Rafael Cabello, President");
    expect(contactLine("Christina Mcalhaney", null)).toBe("Christina McAlhaney");
    expect(contactLine("", "President")).toBeNull();
  });
  test("requests for design or consulting services are not counted as construction jobs", async () => {
    const { SUPPLIER_SUPPLY_PATTERN } = await import("./supplier-report");
    const re = new RegExp(SUPPLIER_SUPPLY_PATTERN.replace(/\\m|\\M/g, "\\b"), "i");
    expect(re.test("Request for Qualifications for Engineering, Landscape Architecture and/or Consulting Services")).toBe(true);
    expect(re.test("Design Build Construction for HC-130J Flight Simulator Facility")).toBe(false);
    expect(re.test("Sunset Park Partial Roof Replacement")).toBe(false);
  });
});

describe("acronyms and Mc names in capitalised records", () => {
  test("program acronyms stay in capitals and Mc surnames get their second capital", async () => {
    const { tidyCaps } = await import("./supplier-report");
    expect(tidyCaps("GAOA BUCK HALL RECREATION PHASE 1 RENOVATION")).toBe("GAOA Buck Hall Recreation Phase 1 Renovation");
    expect(tidyCaps("EHRM DATA CENTER UPGRADES - CHARLESTON, SC")).toBe("EHRM Data Center Upgrades - Charleston, SC");
    expect(tidyCaps("CHRISTINA MCALHANEY")).toBe("Christina McAlhaney");
    expect(tidyCaps("BRANTLEY CONSTRUCTION SERVICES, LLC")).toBe("Brantley Construction Services, LLC");
  });
});

describe("role lines, closing note and forward note", () => {
  test("every business type has its own line, shown under the dropdown", async () => {
    const { SUPPLIER_TYPES } = await import("./supplier-report");
    for (const t of SUPPLIER_TYPES) expect(t.why.length).toBeGreaterThan(40);
    expect(new Set(SUPPLIER_TYPES.map((t) => t.why)).size).toBe(SUPPLIER_TYPES.length);
    const form = readFileSync(new URL("../components/SupplierRequestForm.tsx", import.meta.url), "utf8");
    expect(form).toContain("?.why");
    expect(form).toContain("SUPPLIER_FORWARD_NOTE");
  });
  test("the homepage says what closing in 7 days means for a supplier, and nothing promises a document we do not send", async () => {
    const { SUPPLIER_CLOSING_NOTE, SUPPLIER_FORWARD_NOTE } = await import("./supplier-report");
    expect(readFileSync(new URL("../routes/index.tsx", import.meta.url), "utf8")).toContain("{SUPPLIER_CLOSING_NOTE}");
    expect(SUPPLIER_CLOSING_NOTE).toContain("before bid day");
    expect(SUPPLIER_FORWARD_NOTE).not.toMatch(/ROI/i);
  });
});

describe("second round of review notes (2026-11-18)", () => {
  test("the table says the report covers any state, the form says who it is for, and each sample has a button to the form", () => {
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    expect(read("../routes/index.tsx")).toContain("{SUPPLIER_ANY_STATE_NOTE}");
    expect(read("../components/SupplierRequestForm.tsx")).toContain("{SUPPLIER_AUDIENCE}");
    const page = read("../routes/suppliers.tsx");
    expect(page).toContain('href="#get-report"');
    expect(page).toContain('id="get-report"');
  });
});
