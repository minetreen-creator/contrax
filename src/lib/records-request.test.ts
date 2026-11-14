import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { RECORDS_REQUESTS_PER_MONTH, recordsRequestLetter } from "./records-request";

// Owner 2026-11-14 (competitor review, idea 6): winning-proposal requests for Managed clients.
test("the letter names the contract, asks for releasable records and accepts redactions", () => {
  const l = recordsRequestLetter({ agency: "Department of Veterans Affairs", awardId: "36C10B21F0001", holder: "ACME FEDERAL LLC" }, "November 14, 2026")!;
  expect(l.subject).toBe("FOIA request: contract 36C10B21F0001");
  expect(l.body).toContain("5 U.S.C. § 552");
  expect(l.body).toContain("awarded to ACME FEDERAL LLC");
  expect(l.body).toContain("to the extent they are incorporated in the contract or otherwise releasable");
  expect(l.body).toContain("Exemption 4");
  expect(l.body).toContain("commercial use by Contrax LLC");
  expect(l.body).toContain("fees up to $50");
});

test("a fee limit is capped and a request without a contract number is refused", () => {
  expect(recordsRequestLetter({ agency: "GSA", awardId: "47QFCA21F0001", holder: "X CO", feeLimit: 9999 }, "d")!.body).toContain("fees up to $500");
  expect(recordsRequestLetter({ agency: "GSA", awardId: "", holder: "X CO" }, "d")).toBeNull();
});

test("the page promises one a month and is honest about what an agency may release", () => {
  expect(RECORDS_REQUESTS_PER_MONTH).toBe(1);
  const page = readFileSync("src/routes/teams.tsx", "utf8");
  expect(page).toContain("one public-records request a month");
  expect(page).toContain("the agency decides what it releases, and that can take months");
  expect(page).toContain('["Winning proposals", "Not included", "One records request a month, filed for you"]');
});
