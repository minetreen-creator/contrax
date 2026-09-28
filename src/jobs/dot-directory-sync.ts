/** Operator-run DOT import. Dry-run by default; --apply requires migration 054. */
import { sql } from "~/db";
import { DOT_DIRECTORY_URL, matchDotListings, parseDotDirectory } from "~/lib/subcontracts/dot-directory";
import type { MatchablePrime } from "~/lib/subcontracts/dot-directory";

const response = await fetch(DOT_DIRECTORY_URL, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`DOT returned HTTP ${response.status}`);
const listings = parseDotDirectory(await response.text());
// An unexpectedly short document must never replace a previous complete check.
if (listings.length < 100) throw new Error(`DOT only returned ${listings.length} rows`);
if (process.argv.includes("--parse-only")) {
  console.log(JSON.stringify({ rows: listings.length, matchableShape: listings.filter(
    (row) => Boolean(row.state) && /^\d{6}$/.test(row.naics)).length }));
  process.exit(0);
}
const db = sql();
const primes = await db`
  SELECT p.id, p.uei, p.legal_name AS name, p.vendor_state AS state,
    p.naics, p.vendor_address AS address
  FROM subcontract_primes p
  JOIN subcontract_sources s ON s.id = p.source_id
  WHERE s.source_key = 'gsa-find-opportunities'
  ORDER BY p.id
` as MatchablePrime[];
const decisions = matchDotListings(listings, primes);
const matched = decisions.filter((item) => item.kind === "matched");
const review = decisions.filter((item) => item.kind === "review");
console.log(JSON.stringify({ rows: listings.length, matched: matched.length, privateReview: review.length }));
if (!process.argv.includes("--apply")) {
  console.log("Dry-run only. Pass --apply after reviewing counts to write a complete snapshot.");
  process.exit(0);
}
// Partial runs stay 'staging'. Public reads select only the latest COMPLETE run.
const run = await db`
  INSERT INTO dot_directory_runs (status, source_url, source_label)
  VALUES ('staging', ${DOT_DIRECTORY_URL}, 'FY2026') RETURNING id
` as { id: string }[];
const runId = run[0]?.id;
if (!runId) throw new Error("Could not create DOT run");
for (let i = 0; i < decisions.length; i += 50) {
  const batch = decisions.slice(i, i + 50).map((item, offset) => ({
    row_number: i + offset + 1,
    vendor_name: item.listing.name,
    vendor_address: item.listing.address,
    vendor_state: item.listing.state || null,
    naics: item.listing.naics || null,
    services: item.listing.services || null,
    liaison: item.listing.liaison || null,
    prime_id: item.kind === "matched" ? item.primeId : null,
    review_reason: item.kind === "review" ? item.reason : null,
  }));
  await db`
    INSERT INTO dot_directory_records
      (run_id, row_number, vendor_name, vendor_address, vendor_state, naics,
       services, liaison, prime_id, review_reason)
    SELECT ${runId}::uuid, r.row_number, r.vendor_name, r.vendor_address,
      r.vendor_state, r.naics, r.services, r.liaison, r.prime_id::uuid, r.review_reason
    FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS r(
      row_number int, vendor_name text, vendor_address text, vendor_state text,
      naics text, services text, liaison text, prime_id text, review_reason text)
  `;
}
const checked = await db`
  SELECT count(*)::int AS total, count(*) FILTER (WHERE prime_id IS NOT NULL)::int AS matched
  FROM dot_directory_records WHERE run_id = ${runId}
` as { total: number; matched: number }[];
if (Number(checked[0]?.total) !== decisions.length || Number(checked[0]?.matched) !== matched.length) {
  throw new Error("DOT staging count mismatch; run remains private");
}
await db`UPDATE dot_directory_runs SET status = 'complete', completed_at = NOW() WHERE id = ${runId}`;
console.log(`DOT run ${runId} complete; ${matched.length} matched, ${review.length} private review`);
