import { describe, expect, test } from "bun:test";
import { matchDotListings, parseDotDirectory, type DotListing } from "./dot-directory";

const source = `<h3>FY2026 Subcontracting Directory</h3><table><tr>
<th>Vendor Name</th><th>Vendor Physical Address</th><th>NAICS Code</th>
<th>Major Products/Service Lines 1</th><th>Official's Name and Phone</th></tr>
<tr><td>ACME &amp; SONS, INC.</td><td>1 Main St, VA. 23834</td><td>237310</td>
<td>ROAD WORK</td><td>Example (555) 555-5555</td></tr></table>`;

describe("DOT publication boundary", () => {
  test("parses published cells and rejects a changed table shape", () => {
    expect(parseDotDirectory(source)).toEqual([{
      name: "ACME & SONS, INC.", address: "1 Main St, VA. 23834", state: "VA",
      naics: "237310", services: "ROAD WORK", liaison: "Example (555) 555-5555",
    }]);
    expect(() => parseDotDirectory(source.replace("<td>ROAD WORK</td>", ""))).toThrow();
  });

  test("keeps missing, ambiguous and duplicate identities private", () => {
    const listing = parseDotDirectory(source)[0]!;
    const primes = [
      { id: "1", uei: "ABC", name: "ACME & SONS INC", state: "Virginia", naics: ["237310: Roads"] },
    ];
    expect(matchDotListings([listing], primes)[0]).toMatchObject({ kind: "matched", primeId: "1" });
    expect(matchDotListings([listing], [{ ...primes[0]!, state: "Maryland" }])[0]).toMatchObject({ kind: "review" });
    expect(matchDotListings([listing], [{ ...primes[0]!, naics: ["561720"] }])[0]).toMatchObject({ kind: "review" });
    expect(matchDotListings([listing], [...primes, { ...primes[0]!, id: "2", uei: "DIFFERENT" }])[0])
      .toMatchObject({ kind: "review", reason: "ambiguous identity" });
    expect(matchDotListings([listing, listing], primes).every((item) => item.kind === "review")).toBe(true);
  });

  test("unreadable state or NAICS can never match", () => {
    const listing: DotListing = { ...parseDotDirectory(source)[0]!, state: "", naics: "237310" };
    expect(matchDotListings([listing], [{ id: "1", uei: "ABC", name: listing.name,
      state: "VA", naics: [listing.naics] }])[0]).toMatchObject({ kind: "review" });
  });
});
