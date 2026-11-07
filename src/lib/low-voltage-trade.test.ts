import { expect, test } from "bun:test";
import { expandTrade, tradeTextIncludes } from "./trade-registry";

// Owner 2026-11-07 ("Zero results for a few bids"): a Virginia contractor's camera, low-voltage and
// cable searches returned 0 though matching bids were open (read-only count: "camera installation"
// reached 0 open bids as a bare phrase, 244 with the trade's terms; 18 in Virginia).
test("plain-English camera searches reach the security-systems family", () => {
  for (const q of ["camera installation", "security cameras", "surveillance cameras"]) {
    const e = expandTrade(q);
    expect(e.terms).toContain("cctv");
    expect(e.terms).toContain("access control");
    expect(e.naicsCodes).toContain("561621");
    expect(tradeTextIncludes("Request for Quotes - CCTV Camera System", e)).toBe(true);
  }
});

test("low-voltage and cabling searches reach structured-cabling bids, without every electrical job", () => {
  for (const q of ["low voltage", "cable installation", "structured cabling"]) {
    const e = expandTrade(q);
    expect(e.terms).toContain("structured cabling");
    expect(e.terms).toContain("data cabling");
    expect(e.naicsCodes).toEqual([]); // 238210 would pull in every electrical contract
    expect(tradeTextIncludes("Fiber Optic Cabling for City Hall", e)).toBe(true);
  }
});

test("neighbouring trades are untouched", () => {
  expect(expandTrade("security guard").naicsCodes).toEqual(["561612"]);
  expect(expandTrade("security guard").terms).not.toContain("camera installation");
  expect(expandTrade("electrical").terms).not.toContain("structured cabling");
});
