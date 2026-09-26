-- Migration 051 — GSA PRIME CONTRACTOR DIRECTORY, schema delta
-- (owner-approved expansion 2026-09-26; mechanism proven by
-- shared/subcontracting-expansion-research-2026-09-25/spike/README.md §6.1).
--
-- ADDITIVE ONLY, and idempotent: three NULLABLE columns on the table migration 050
-- created. Nothing is dropped, renamed, defaulted or back-filled, and no existing row
-- changes: the SBA FY24 rows simply keep NULL in all three.
--
--   vendor_address     the GSA file publishes the full physical address (SBA's file had
--                      HQ state only, so SBA rows stay NULL — no backfill, no invention)
--   products_services  GSA's own "Major products or service lines" text. Deliberately NOT
--                      `industries[]`: that array's documented meaning is the migration-050
--                      brief-name map, which GSA does not publish.
--   source_file_date   DATE, the source's OWN file date taken from its dated file URL
--                      (…/subcontractor_directory_Jul-9-2025.csv). Evidence, not an
--                      assertion: it is never derived from Last-Modified (the two
--                      disagree — the name says Jul-9-2025, the CDN restamps 2026-05-11).
--
-- NO CHECK-CONSTRAINT CHANGE IS NEEDED. `subcontract_sources.kind` already allows
-- 'prime_directory', which is what the GSA source row uses. `subcontract_primes.fy` is
-- NOT NULL and stays that way: the GSA rows store the literal 'past fiscal year' (this
-- source publishes no fiscal year, and the owner-locked heading asserts none).
--
-- THE SOURCE ROW IS NOT INSERTED HERE. It is created/refreshed idempotently by the sync
-- job through `ensureSubcontractSource(GSA_PRIME_DIRECTORY_SOURCE)` — exactly the pattern
-- the SBA sources use — with these stock values:
--   source_key    'gsa-find-opportunities'
--   agency        'GSA'
--   cadence       'annual file; refetched weekly with conditional-GET gate'
--   coverage_tier 'curated'
--   kind          'prime_directory'
--
-- ROLLBACK: `ALTER TABLE subcontract_primes DROP COLUMN vendor_address, DROP COLUMN
-- products_services, DROP COLUMN source_file_date;` — the columns are new and no SBA row
-- depends on them. Dropping them removes the GSA directory's stored address/products
-- evidence but never touches a notice row.

ALTER TABLE subcontract_primes ADD COLUMN IF NOT EXISTS vendor_address TEXT;
ALTER TABLE subcontract_primes ADD COLUMN IF NOT EXISTS products_services TEXT;
ALTER TABLE subcontract_primes ADD COLUMN IF NOT EXISTS source_file_date DATE;
