-- Migration 045 — Nonprofit Free: the data foundation (owner green-lit 2026-09-21).
--
-- ADDITIVE + IDEMPOTENT + SPLITTABLE: every statement below is safe to re-run any
-- number of times, and no statement contains a `;` (see db/migrations/sql-statements.ts
-- for why — the runner and the test provisioning both execute this file statement
-- by statement). Replayed by db/migrations/run-045.ts
-- (`bun run db/migrations/run-045.ts`).
--
-- WHAT THIS IS. The owner's Nonprofit Free tier ("Government grant search — free for
-- verified nonprofit organizations. No credit card required.") needs three things that
-- do not exist in the repo today: somewhere to hold an application, the IRS records the
-- verification decision is made FROM, and a place to keep a verified org's saved grants.
-- The verification RULE itself lives in src/lib/nonprofit-verification.server.ts; this
-- file only holds the data it reads and the audit trail it must leave behind.
--
-- 1. nonprofit_applications — one row per user (UNIQUE), the owner's signup fields plus
--    the audit/evidence columns the research requires ON EVERY DECISION
--    (/home/team/shared/nonprofit-free-teos-research-2026-09-21.md §2.5, last paragraph):
--    which IRS file, which posting date and which matched names produced the verdict, so
--    the annual reverify and the owner's right to revoke are auditable. `ein` is CHAR(9)
--    and is ALWAYS a zero-padded string: 3.0 % of real IRS EINs begin with `0`, so a
--    numeric column would silently corrupt 010488538 into 10488538.
-- 2. irs_eo_bmf / irs_pub78 / irs_revocations — the LOCAL MIRROR of the three official
--    IRS bulk datasets (research §1.d, §3). Verification is a local DB lookup; there is
--    never a live call to irs.gov per request. `content_hash` is the no-op-write guard:
--    a monthly refresh re-inserts ~4.6 M rows and only the CHANGED ones may cause a
--    tuple rewrite (skill: neon-cu-noop-write-elimination).
--    `irs_revocations` has NO single-EIN key on purpose: the IRS file carries 1,247,137
--    rows for 1,227,732 distinct EINs (19,405 EINs appear more than once), so the row's
--    identity is its content, not its EIN.
-- 3. irs_mirror_runs — the mirror's own log: posting date, row counts and how many rows
--    were actually written. This is where the honest label "IRS records as of <date>"
--    on every auto-approve record comes from.
-- 4. saved_grants — the free tier's "save up to 10 grants" promise, with an offline
--    snapshot so a saved grant can still render when the upstream listing moves.
--
-- NOT HERE, ON PURPOSE: no Stripe column, no grants_subscriptions write (that table's
-- contract is "Stripe webhooks are the only writer"), no plan_tier change. The nonprofit
-- entitlement is a separate internal record — pre-revenue product, zero billing surface.
--
-- Mirrored in src/db/schema.sql (the canonical merged schema, applied by
-- `bun run db/setup.ts`). The federal /grants product is untouched by every statement
-- here — nothing in this file is read by /api/grants/search until a later phase wires it.
CREATE TABLE IF NOT EXISTS nonprofit_applications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id),
    -- The legal name exactly as the applicant submitted it. Compared against the IRS
    -- BMF NAME after normalisation; never rewritten by a verification run.
    org_name TEXT NOT NULL,
    work_email TEXT NOT NULL,
    website TEXT,
    -- CHAR(9), zero-padded, as a STRING. 010488538 is a real EIN (Maine Association of
    -- Nonprofits) and must never round-trip through an integer.
    ein CHAR(9) NOT NULL,
    state TEXT,
    contact_name TEXT NOT NULL,
    contact_role TEXT,
    org_use_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    -- pending | approved | manual_review | rejected | revoked.
    -- `manual_review` is a real terminal-for-now state, not an error: EIN-not-found,
    -- a name mismatch (DBAs are absent from the IRS file by design), a revoked EIN and a
    -- non-01/02 STATUS all land here and NONE of them is ever an auto-reject.
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'manual_review', 'rejected', 'revoked')),
    -- How the decision was reached: the IRS mirror (auto) or a human exception
    -- (churches, government entities, fiscal-sponsorship projects, newly approved orgs,
    -- group-exemption subordinates). NULL while pending.
    verification_method TEXT
        CHECK (verification_method IS NULL OR verification_method IN ('irs_eo_bmf', 'manual_exception')),
    -- ── Audit / evidence: written by the verification engine on every decision ──
    -- The submitted name after normalisation (src/lib/nonprofit-verification.server.ts),
    -- stored verbatim so a reviewer sees exactly the two strings the matcher compared.
    submitted_name_normalized TEXT,
    matched_bmf_name TEXT,
    -- A = exact, B = corresponding (token multiset / contains + Jaccard >= 0.9), C = everything else.
    bmf_name_tier TEXT CHECK (bmf_name_tier IS NULL OR bmf_name_tier IN ('A', 'B', 'C')),
    bmf_status TEXT,
    bmf_subsection TEXT,
    -- The IRS GROUP column, as TEXT: it is a group-exemption number ('0000' = none),
    -- and 20.1 % of BMF rows are subordinates under one. Never numeric — '0000' is not 0.
    bmf_group_no TEXT,
    bmf_posting_date DATE,
    -- Which mirrored file/date produced this row (e.g. 'irs_eo_bmf@2026-09-08').
    bmf_source_ref TEXT,
    pub78 BOOLEAN,
    pub78_deductibility_code TEXT,
    -- From the auto-revocation list. `on_revocation_list` is the required NEGATIVE
    -- signal: 13.0 % of revoked EINs are still in the BMF with STATUS '01'.
    on_revocation_list BOOLEAN,
    revocation_date DATE,
    revocation_posting_date DATE,
    -- The revocation file's 12th column. Its official name is not yet confirmed against
    -- the IRS data dictionary (research §1.d/§5); the empirical read is "reinstatement
    -- date" (59.7 % of EINs carrying it are also in Pub 78, versus 1.9 % of those that
    -- are not). Stored, never used as an auto-approve signal.
    reinstatement_date DATE,
    -- auto_approve | manual_review | rejected | reentry_required
    -- (`reentry_required` is a form-validation outcome — a malformed EIN — never a review).
    decision TEXT
        CHECK (decision IS NULL OR decision IN ('auto_approve', 'manual_review', 'rejected', 'reentry_required')),
    decision_reason TEXT,
    -- Secondary signals kept for the reviewer: group_exemption_subordinate,
    -- revocation_reinstatement_hypothesis, status_inactive, subsection_not_501c3, ...
    decision_flags TEXT[] NOT NULL DEFAULT '{}'::text[],
    -- Which file/date/router produced the verdict (research §2.5: "that record is what
    -- makes the annual reverify and the owner's right to revoke auditable").
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    granted_at TIMESTAMPTZ,
    -- Annual reverify. An OVERDUE reverify NEVER removes free access — the owner's rule
    -- is that basic searching stays free indefinitely for a verified nonprofit; this date
    -- only raises a review task (see nonprofit.server.ts).
    reverify_due_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One application per user (the owner's form is submitted once per account; a re-apply
-- updates the same row so the audit trail cannot fork).
CREATE UNIQUE INDEX IF NOT EXISTS nonprofit_applications_user_id_key ON nonprofit_applications (user_id);
-- The manual-review queue read (agent-lead owns it).
CREATE INDEX IF NOT EXISTS idx_nonprofit_applications_status_created ON nonprofit_applications (status, created_at);
CREATE TABLE IF NOT EXISTS irs_eo_bmf (
    -- The IRS EO BMF extract, slimmed to the identity columns. Exactly the fields the
    -- research (§3) names; the 28-column source row is not stored wholesale.
    ein CHAR(9) PRIMARY KEY,
    name TEXT NOT NULL,
    -- Officially the "SORT NAME LINE (SECONDARY NAME LINE)" — a SECOND name to match,
    -- not a sort key. Empty for many rows.
    sort_name TEXT,
    state TEXT,
    -- '03' = 501(c)(3); the mirror keeps the code and the decision layer labels it.
    subsection TEXT,
    -- '01' Unconditional Exemption, '02' Conditional Exemption, '12' trust described in
    -- IRC 4947(a)(2), '25' terminated. Only 01/02 can auto-approve.
    status TEXT,
    -- Group-exemption number as TEXT ('0000' = not a subordinate).
    group_no TEXT,
    ruling_year TEXT,
    ntee TEXT,
    -- The IRS posting date of the file this row came from — the "as of" label.
    posting_date DATE,
    -- Hash of the slim field values. The monthly refresh upserts only when this differs,
    -- so an unchanged row is never rewritten (no tuple, no WAL, no index churn).
    content_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- The prune after a refresh: rows the new file did not republish keep an older
-- posting_date and are removed in one indexed pass.
CREATE INDEX IF NOT EXISTS idx_irs_eo_bmf_posting_date ON irs_eo_bmf (posting_date);
CREATE TABLE IF NOT EXISTS irs_pub78 (
    -- Publication 78: organizations eligible to receive tax-deductible contributions.
    -- Used as strong POSITIVE corroboration only (1,419,989 records, all EINs distinct).
    ein CHAR(9) PRIMARY KEY,
    -- PC / PF / EO / SO / GROUP / FORGN / SOUNK / ... and 'EO,LODGE' — the codes
    -- themselves contain commas, which is why the source is split on `|` only.
    deductibility_code TEXT,
    posting_date DATE,
    content_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_irs_pub78_posting_date ON irs_pub78 (posting_date);
CREATE TABLE IF NOT EXISTS irs_revocations (
    -- The automatic-revocation list: the required negative signal.
    -- NO primary key on ein: 1,247,137 rows cover 1,227,732 distinct EINs, and an EIN can
    -- legitimately carry more than one revocation posting. Identity = the row content.
    id BIGSERIAL PRIMARY KEY,
    ein CHAR(9) NOT NULL,
    revocation_date DATE,
    revocation_posting_date DATE,
    reinstatement_date DATE,
    row_hash TEXT NOT NULL UNIQUE,
    posting_date DATE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_irs_revocations_ein ON irs_revocations (ein);
CREATE INDEX IF NOT EXISTS idx_irs_revocations_posting_date ON irs_revocations (posting_date);
CREATE TABLE IF NOT EXISTS irs_mirror_runs (
    -- One row per source per refresh. This is the ONLY place the honest "IRS records as
    -- of <posting date>" label is derived from — never guessed, never typed by hand.
    id SERIAL PRIMARY KEY,
    -- 'eo_bmf' | 'pub78' | 'revocations'
    source TEXT NOT NULL,
    payload TEXT NOT NULL,
    posting_date DATE,
    row_count INTEGER NOT NULL DEFAULT 0,
    distinct_ein_count INTEGER,
    quarantined_count INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    unchanged_count INTEGER NOT NULL DEFAULT 0,
    pruned_count INTEGER NOT NULL DEFAULT 0,
    -- 'verify' writes NOTHING to the mirror tables — it only measures and logs.
    mode TEXT NOT NULL CHECK (mode IN ('verify', 'import')),
    status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_irs_mirror_runs_source_started ON irs_mirror_runs (source, started_at DESC);
CREATE TABLE IF NOT EXISTS saved_grants (
    -- "Save up to 10 grants" for a verified nonprofit (owner spec item 4), and the same
    -- rows the later weekly deadline email reads. Snapshot fields are stored so a saved
    -- grant still renders after the upstream listing is withdrawn.
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id),
    -- The upstream opportunity id as TEXT: Grants.gov ids are numeric today and must
    -- never be stored as an integer (they are opaque to us), and a state opportunity id
    -- is not numeric at all.
    opportunity_id TEXT NOT NULL,
    -- Which product surface it came from (e.g. 'grants_gov', 'state:ME').
    source TEXT NOT NULL DEFAULT 'grants_gov',
    title TEXT NOT NULL,
    agency TEXT,
    status TEXT,
    -- The single honesty-labelled deadline the UI already renders; NULL when the source
    -- published no close date ("Not specified" is a display decision, not a stored value).
    closing_date DATE,
    -- The display string only (e.g. '$19,000,000'); never re-parsed into a number and
    -- never summed, because the upstream format is not a machine-readable amount.
    award_display TEXT,
    official_url TEXT,
    -- Anything else the caller wants the card to keep, verbatim from the source payload.
    snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- UNIQUE (user_id, opportunity_id): saving the same opportunity twice is one row.
CREATE UNIQUE INDEX IF NOT EXISTS saved_grants_user_opportunity_key ON saved_grants (user_id, opportunity_id);
CREATE INDEX IF NOT EXISTS idx_saved_grants_user_created ON saved_grants (user_id, created_at DESC);
