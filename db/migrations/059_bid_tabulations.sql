-- Migration 059 — BID TABULATIONS (owner-picked feature, Phase 1 source = ALDOT).
-- Owner RE-AFFIRMED the original Bid Tabulations pitch on 2026-10-09 (ALDOT named
-- as a core source), so this is the Phase-1 build. Written by the engineer and NOT
-- APPLIED by the engineer: the lead applies it to production BEFORE the merge
-- (the #414 sequencing rule — a deployed sync that writes a missing table would
-- fail, so the shape lands first).
--
-- WHAT THIS IS FOR. A "bid tabulation" is the publisher's own record of what every
-- bidder bid on a contract that was let before: "last time this project was let:
-- 3 bidders, apparent low $X by NAME, high $Y". Nothing here is Contrax's
-- arithmetic on top of a guess — every row carries the publisher's URL and the
-- publisher's own date, and the amounts are stored VERBATIM as published.
--
-- FOUR OWNER RULES baked into the shape:
--   ① PROVABLE LINK ONLY (owner 2026-10-08). A tabulation attaches to an open bid
--      ONLY through `bid_tabulation_links`, whose CHECK constraint permits exactly
--      three match kinds: 'reference_number' (the publisher's own solicitation /
--      contract-identifier numbering space), 'project_number' (the publisher's own
--      project number, e.g. a same-project re-let) and 'predecessor_named' (the new
--      solicitation literally names its predecessor). There is NO title/agency/NAICS
--      fuzzy fallback and there never will be: an unprovable match shows no prices.
--      Each link row also stores the CONCRETE matched `match_value`, so "why are
--      these two attached?" is always answerable from the row itself.
--   ② VERBATIM PRICES ONLY (owner 2026-10-08). `bid_tabulation_bidders.bid_amount`
--      is the number the publisher printed; the publisher's own typos are stored as
--      printed and labelled "as published" on the surface. Never recomputed, never
--      "cleaned", never presented as a winning price.
--   ③ SCANNED-PDF FLAG (owner 2026-10-08). `scanned` marks a tabulation whose source
--      document is a scanned image: text extraction yields (almost) nothing, so the
--      prices are NOT machine-readable. Such a row stores ZERO bidder rows and an
--      `extraction_note`; the surface says so instead of guessing. OCR is never
--      applied by default.
--   ④ STARTER-$19 UNLOCK (owner 2026-10-08). The prices unlock at the FIRST PAID
--      plan. That is an entitlement READ (src/lib/trial.ts), not a column: nothing
--      in these tables is per-user, and no grant/allowance path reads them.
--
-- ADDITIVE + IDEMPOTENT ONLY. Three NEW tables; no ALTER on `bids` or on anything
-- else; no back-fill; no default that implies a value. A database that never runs
-- this migration keeps working exactly as before (every read is fail-open: an
-- absent table renders nothing). Re-running it is a no-op.
--
-- ROLLBACK: DROP TABLE IF EXISTS bid_tabulation_links, bid_tabulation_bidders,
-- bid_tabulations; — nothing else references them.

CREATE TABLE IF NOT EXISTS bid_tabulations (
    id                SERIAL PRIMARY KEY,
    -- Same label space as bids.source (here: 'al_aldot').
    source            TEXT NOT NULL,
    -- The publisher's own identifier for this tabulation within the source.
    -- ALDOT: the printed Contract ID, e.g. '20260130067'.
    source_project_id TEXT,
    -- The publisher's solicitation / contract identifier, VERBATIM.
    reference_number  TEXT,
    -- The publisher's project number(s), VERBATIM (ALDOT prints e.g.
    -- 'ATRP2-37-2024-109'); a re-let of this number is the same project.
    project_number    TEXT,
    agency            TEXT,
    -- The publisher's own contract description, verbatim (truncated by the reader,
    -- never rewritten).
    title             TEXT,
    -- The publisher's stated opening / letting date for THIS tabulation.
    bid_opened_on     DATE,
    -- As published ("Construction letting" for ALDOT).
    tabulation_type   TEXT,
    -- Counted from the bidder rows we actually stored. Never inferred from the
    -- document, and NULL when nothing was stored.
    bidders_count     INTEGER,
    -- min / max of the STORED bidder amounts only — NULL when no amount is stored.
    -- These are a property of the stored set, not a claim about the letting.
    low_amount        NUMERIC(16,2),
    high_amount       NUMERIC(16,2),
    -- The publisher's own page for THIS tabulation. NOT NULL: a row without a
    -- public source URL is not admissible.
    source_url        TEXT NOT NULL,
    -- The publisher's own date on that document.
    source_published  DATE,
    -- 'pdf' | 'html' | 'csv' | 'json' — what we actually read.
    raw_format        TEXT,
    fetched_at        TIMESTAMPTZ DEFAULT NOW(),
    -- Owner rule ③: the source document is a scanned image, so no price could be
    -- machine-read. Default false = "we read text"; never "the numbers are right".
    scanned           BOOLEAN DEFAULT false,
    -- Why extraction produced what it produced (how many pages/lines, what was
    -- missing). Free text, written by the reader, shown to nobody by default.
    extraction_note   TEXT,
    UNIQUE (source, source_project_id)
);

CREATE TABLE IF NOT EXISTS bid_tabulation_bidders (
    id            SERIAL PRIMARY KEY,
    tabulation_id INTEGER NOT NULL REFERENCES bid_tabulations(id) ON DELETE CASCADE,
    -- Verbatim, exactly as the publisher prints it.
    bidder_name   TEXT NOT NULL,
    -- Verbatim as published, NULL when the publisher printed none or when the cell
    -- could not be read cleanly (parse-or-NULL — never cleaned or guessed). There
    -- is deliberately NO rank / is_apparent_low column: the ranking we show is the
    -- publisher's own, and "apparent low, as published" is derived at render time
    -- from the stored set rather than frozen as a claim.
    bid_amount    NUMERIC(16,2),
    -- The bidder row's own publisher URL (the same document, cited per row).
    source_url    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bid_tabulation_bidders_tabulation
    ON bid_tabulation_bidders (tabulation_id);

CREATE TABLE IF NOT EXISTS bid_tabulation_links (
    bid_id        INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
    tabulation_id INTEGER NOT NULL REFERENCES bid_tabulations(id) ON DELETE CASCADE,
    -- Owner rule ①: ONLY these three kinds. No fuzzy/title matching, ever.
    match_kind    TEXT NOT NULL CHECK (match_kind IN ('reference_number', 'project_number', 'predecessor_named')),
    -- The concrete value that matched, as printed on the publisher's side; it is
    -- DISPLAYED, not hidden, so a user can see the proof.
    match_value   TEXT NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (bid_id, tabulation_id)
);

CREATE INDEX IF NOT EXISTS idx_bid_tabulation_links_tabulation
    ON bid_tabulation_links (tabulation_id);
