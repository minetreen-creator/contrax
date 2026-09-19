# State Grants connector conventions

The owner's state-grants rollout (order 2026-09-18), corrected by the owner's
2026-09-19 P1 review (R1). This document is the contract every future state
connector must honour. It is short on purpose: the rules that matter are the ones
that keep the product honest.

## The shape of everything

```
fetch()    → the RAW source payload (HTML string, JSON object, …)
parse()    → SourceGrantRecord[]   normalised, UNCLASSIFIED, faithful, one SOURCE
classify() → open | upcoming | rolling | closed | unverified + which date is which
dedupe()   → one record per (SOURCE, external_id)
store      → ONE statement: changed rows + last_seen refresh + stale sweep + run row
```

`StateGrantConnector` in `connector.ts` is the interface; `virginia.ts` is the
reference implementation; `sources.ts` is the code-level source registry.
`sync.server.ts` is the only thing that ever drives a connector in production, and
`store.server.ts` is the only thing that ever writes to the four tables.

## 1. No fabrication — ever

Every field is the source's own value or nothing:

| situation | what you store |
| --- | --- |
| source publishes no summary / eligibility / geography / award / match / funding | `NOT_SPECIFIED` ("Not specified") |
| source publishes no date | `null` — never an estimate you computed |
| source publishes a date you cannot parse exactly | `null` (+ keep the raw label text in `raw`) |
| source marks a date as an estimate ("est.") | `estimated_close_date`, **never** `close_date` |
| source gives no per-record link | the listing page (`sourceUrl`) |
| source gives no per-record updated stamp | `sourceUpdatedAt: null` |

Never interpolate a date, never roll a deadline forward to "next cycle", never
convert "Spring 2026" into a day. A missing fact is a missing fact.

Normalized columns (owner correction 4, 2026-09-19) are real columns —
`eligible_applicants`, `eligible_geography`, `categories TEXT[]`, `award_range`
(TEXT, the source's own wording) plus `award_min_amount`/`award_max_amount`
(NUMERIC, arithmetic on the amounts the source published — a single amount is the
ceiling, as in the source's own "up to $X"), `total_funding`,
`matching_requirement`. The raw JSONB payload stays as the backstop.

## 2. Status taxonomy — `open | upcoming | rolling | closed | unverified`

`classifyStateGrant()` in `connector.ts` is the ONE implementation; a connector
may override `classify` only to be **stricter**. In evaluation order:

1. Source explicitly marks the cycle **closed** (a past-tense label) → `closed`.
   The source's own words win even if a date looks future.
2. Source explicitly declares the program **ongoing / year-round / rolling / no
   deadline** → `rolling`, `close_date = null` (there is no deadline to expire).
   Only the SOURCE may declare this — we never infer continuous acceptance.
3. A published closing date, with a published **opening date still in the
   future** → `upcoming` (see the policy note below).
4. A published closing date that has **not passed** (US Eastern day boundary,
   deadline day inclusive) → `open`, with `close_date` set. A future published
   deadline with no opening date at all is still `open`.
5. A published closing date that has passed → `closed`.
6. No published closing date, but the source published an **estimate** →
   `unverified`, with the estimate kept in `estimated_close_date`.
7. Anything else (no dates at all, or an opening date with no closing date) →
   `unverified`.

**`unverified` is the honest home for missing or ambiguous dates.** There is no
`forecast` status any more: a record is never promoted to a live cycle because we
hope one is coming. Estimated dates live in `estimated_close_date`, are labelled
as estimates, and never masquerade as posted deadlines.

Consequences the store enforces: `close_date` is only ever set for
open/upcoming/closed rows; no row can carry both `close_date` and
`estimated_close_date`; `unverified` and `rolling` rows always have
`close_date = null`. The serving order is
`open → upcoming → rolling → closed → unverified`.

**The announced-cycle policy (one constant, one judgement call).**
`ANNOUNCED_CYCLE_STATUS` in `connector.ts` decides what rule 3 produces. The
owner defined `upcoming` as "announced not-yet-open cycle (published,
non-estimated dates)", so the default is `upcoming`. The 2026-09-19 review note
also called Virginia's Special Events cycle "est. only"; the live page publishes
that cycle's dates with NO estimate marker anywhere (verified 2026-09-19), and
the owner's own rule puts an estimate-only record in `unverified` while this one
has a posted date — so it classifies as `upcoming`, with a published
`close_date`. Flipping the constant to `"unverified"` moves every announced cycle
to `unverified` (keeping the announced date in `estimated_close_date`); the unit
test pins the constant so the flip is deliberate and visible.

## 3. Sources, identity, dedupe and amendments

- **A row belongs to a SOURCE, not a state** (owner correction 1). Every source
  has a `state_grant_sources` row (`source_key`, `state_code`, `name`, `agency`,
  `official_url`, `official_host`), written by `ensureStateSource()` from the
  connector itself — never from a payload.
- **Identity is `(source_id, external_id)`** (UNIQUE index
  `state_grant_opportunities_source_external_key`). Two agencies in one state
  that both reuse a short program id produce **two rows**; neither can overwrite
  the other. The old `(state_code, external_id)` uniqueness is gone.
- **external_id** is the source's own identifier — for Virginia, the slug of the
  program's official page path (`/grants/mmlp/` → `mmlp`). Derived, never
  positional, and stable across runs.
- A re-published record is the **same** external_id, so an amendment updates the
  same row. `inserted_count` and `updated_count` can never both grow for one
  source id. Duplicate ids *within one payload* are deduped, reported in
  `collisions`, and disambiguated deterministically (`-2`, `-3`) so a later id is
  still stable.
- An external id carrying a comma, brace or newline is **refused loudly**
  (`externalIdCsv`) rather than being silently spliced into the seen-list.
- **fingerprint** is a content hash of the normalised record (including the raw
  extracted fields and `source_updated_at`). Same content ⇒ same fingerprint ⇒
  the upsert's `WHERE fingerprint IS DISTINCT FROM EXCLUDED.fingerprint` writes
  nothing: **no no-op rewrites, and `created_at`/`fetched_at` are untouched by a
  re-run.** Changed content ⇒ the row updates in place.

## 4. Freshness: `last_seen_at` and the stale sweep (owner correction 3)

- `last_seen_at` is set on **every row a COMPLETE run saw**, unchanged rows
  included. It means "the source still publishes this".
- After a successful COMPLETE run, every row of that source the run did **not**
  see flips to `unverified` — a record the source stopped publishing is never
  left sitting there looking open. Rows already `unverified` are not rewritten.
- The sweep runs **only** in the same transaction as a complete parse, so a
  failed run cannot reclassify anything: it writes nothing at all — no rows, and
  no stale sweep. Its only trace is a `state_grant_sync_runs` row with
  `status = 'error'`.
- Rows are never deleted; a vanished record stays in the table, marked
  `unverified`, with its last-known `last_seen_at`.

## 5. Fail-closed

- A fetch/parse failure throws. The runner then writes **nothing** to the
  opportunity table and records a `state_grant_sync_runs` row with `status =
  'error'`, the stage (`registry` | `fetch` | `parse` | `source` | `read` |
  `write` | `timeout`) and the message.
- A page that no longer looks like the expected source (a content marker is
  missing, or it parses to zero blocks) is a **parse failure**, not an empty
  corpus. Silence is never coverage.
- One state's (or source's) failure never affects another's rows or run history.

## 6. The coverage ladder — `unavailable | limited | curated | connected`

`registry.ts` derives every state's status on every read (the
`state_grant_registry` table is a MIRROR of that derivation, never a source of
truth). The ladder (owner correction 2; the four values are the owner's, the
prose below is the team's reading pending confirmation):

| tier | meaning |
| --- | --- |
| `unavailable` | no validated source. Nothing is served. |
| `limited` | one, or a few, validated **single-agency** sources. Real records, plainly not a statewide view. |
| `curated` | the state's own curated/portal listing, or manually curated substantive coverage. |
| `connected` | **statewide comprehensive multi-source** coverage. |

A validated tier (limited / curated / connected) requires **all five**: a
connector; a source-validation manifest entry; agreement between the two
(connector id **and** source URL); an `officialHost` on `APPROVED_SOURCE_HOSTS`;
and a valid declared tier. Anything else is `unavailable` with a machine-readable
reason. `connected` additionally requires at least `CONNECTED_MIN_SOURCES` (2)
registered sources — a single-source state that claims `connected` is downgraded
to `limited` with the reason spelled out. `getConnector()` hands out a connector
only for a validated tier, so the sync runner physically cannot sync an
unvalidated state.

**Virginia is `limited`** (owner correction 2): ONE validated source — the
Virginia Tourism Corporation grants page — which is real coverage but not
statewide, and the registry entry says exactly that in its `note`.

Adding a state (the "batches of five" step) therefore means, in this order:

1. write the connector, with `sourceUrl` hard-coded to the official listing;
2. write `<state>.source-validation.test.ts` (opt-in live fetch, ≥1 real record,
   official hosts only, dates parse or null, the status model, deterministic
   re-parse) — this is the test the manifest names;
3. add the manifest entry to `registry.ts` (connector id, source URL, test file,
   date verified, **tier**, honesty note) and the host to
   `APPROVED_SOURCE_HOSTS`;
4. run the unit + integration suites and **one explicit live validation**
   (`bun run validate:live-sources`).

Until step 3 lands, the state reports `unavailable` even with a perfect
connector. That is the point.

## 7. Test determinism (owner guardrail 2026-09-19)

- The DEFAULT suite is fixture-only and deterministic: **zero network**. The
  live source validation is opt-IN — `bun run validate:live-sources` (or
  `STATE_GRANTS_RUN_LIVE_SOURCE_TESTS=1 bun test src/lib/state-grants`). When it
  is not opted in it SKIPS LOUDLY; a skip proves nothing about a state's source.
- The integration suite runs against the real database whenever all four state
  tables exist (or provisions them from the migration files when
  `STATE_GRANTS_TEST_PROVISION_SCHEMA=1`). It writes **only** synthetic state
  codes (`ZZ`, `ZY`, `MD`) and `itest-` source keys, never syncs Virginia, and
  leaves the tables at their 0-row baseline.

## 8. Isolation from the federal product

The state tables, the connectors and the runner are **not** read by `/grants`,
`/api/grants/search`, the Radar funnel, any `grants_*` event, or any pricing
path. No state code may import from the federal grants modules except the shared
freshness helper (`easternDayStart`), and no federal module may import from
`src/lib/state-grants/`. Keep it that way.

## 9. Operations

```
bun run sync:state -- va                        # sync one state (registry-gated)
bun run sync:state -- --all-connected           # every state with a validated source
bun run sync:state -- va --dry-run              # fetch + classify, write NOTHING
bun run sync:state -- --registry                # mirror registry + sources tables
bun run validate:live-sources                   # the opt-in live source gate
bun run test:state-grants:integration           # whole dir, provisioning allowed
bun run db/migrations/run-043.ts                # migration 043 (owner-approved)
bun run db/migrations/run-044.ts                # migration 044 (R1: sources, identity,
                                                #   last_seen_at, normalized fields, statuses)
```

A schedule is **not** wired in parts 1–2. When it is, it belongs in a GitHub
Actions workflow on the repo's existing 4-hour sync pattern (never Vercel cron),
calling `bun run sync:state -- --all-connected` with the same `DATABASE_URL`
secret the other sync workflows use.
