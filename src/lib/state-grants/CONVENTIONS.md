# State Grants connector conventions

Part 1 of the owner's state-grants rollout (order 2026-09-18). This document is
the contract every future state connector must honour. It is short on purpose:
the rules that matter are the ones that keep the product honest.

## The shape of everything

```
fetch()    → the RAW source payload (HTML string, JSON object, …)
parse()    → SourceGrantRecord[]        normalised, UNCLASSIFIED, faithful
classify() → open | forecast | closed   + which date is which
dedupe()   → one record per (state, external_id)
store      → ONE statement: changed rows + the run row, or nothing
```

`StateGrantConnector` in `connector.ts` is the interface; `virginia.ts` is the
reference implementation. `sync.server.ts` is the only thing that ever drives a
connector in production, and `store.server.ts` is the only thing that ever
writes to the three tables.

## 1. No fabrication — ever

Every field is the source's own value or nothing:

| situation | what you store |
| --- | --- |
| source publishes no summary / eligibility / award | `NOT_SPECIFIED` ("Not specified") |
| source publishes no date | `null` — never an estimate you computed |
| source publishes a date you cannot parse exactly | `null` (+ keep the raw label text in `raw`) |
| source gives no per-record link | the listing page (`sourceUrl`) |
| source gives no per-record updated stamp | `sourceUpdatedAt: null` |

Never interpolate a date, never roll a deadline forward to "next cycle", never
convert "Spring 2026" into a day. A missing fact is a missing fact.

## 2. Freshness (the #399 contract, state side)

`classifyStateGrant()` in `connector.ts` is the ONE implementation; a connector
may override `classify` only to be **stricter**. Rules, in order:

1. Source explicitly declares the program **ongoing / year-round / rolling** →
   `open`, `close_date = null` (there is no deadline to expire).
2. Source explicitly marks the cycle **closed** (a past-tense label) → `closed`.
   The source's own words win even if a date looks future.
3. No usable closing date → `forecast`. **Never open.**
4. A published **opening date in the future** → `forecast`, and the announced
   closing date goes to `estimated_close_date` — `close_date` stays `null` so an
   estimate can never masquerade as a deadline.
5. A published closing date that has **not passed** (US Eastern day boundary,
   deadline day inclusive) → `open`, with `close_date` set.
6. Otherwise → `closed`.

Consequences the store enforces: `close_date` is only ever set for open/closed
rows, and no row can carry both `close_date` and `estimated_close_date`.

## 3. Identity, dedupe and amendments

- **external_id** is the source's own identifier for the opportunity — for
  Virginia, the slug of the program's official page path (`/grants/mmlp/` →
  `mmlp`). It is derived, never positional, and must be *stable across runs*,
  because `(state_code, external_id)` is the row's identity.
- A re-published record is the **same** external_id, so an amendment updates the
  same row. `inserted_count` and `updated_count` can never both grow for one
  source id.
- **fingerprint** is a content hash of the normalised record (including the raw
  extracted fields and `source_updated_at`). Same content ⇒ same fingerprint ⇒
  the upsert's `WHERE fingerprint IS DISTINCT FROM EXCLUDED.fingerprint` writes
  nothing: **no no-op rewrites, and `created_at`/`fetched_at` are untouched by a
  re-run.** Changed content ⇒ the row updates in place.
- If a source ever returns the same external_id twice in one payload, `dedupe()`
  keeps the first and reports the collision; the run result carries `collisions`
  so it is visible rather than silent.

## 4. Fail-closed

- A fetch/parse failure throws. The runner then writes **nothing** to the
  opportunity table and records a `state_grant_sync_runs` row with `status =
  'error'`, the stage (`registry` | `fetch` | `parse` | `read` | `write` |
  `timeout`) and the message.
- A page that no longer looks like the expected source (a content marker is
  missing, or it parses to zero blocks) is a **parse failure**, not an empty
  corpus. Silence is never coverage.
- One state's failure never affects another state's rows or run history.
- Records that vanish from a source are left in place: we do not delete, and we
  do not invent a status change for a record the source stopped publishing.
  (Deadline-based statuses still move on their own via `classify` — a stored row
  is re-classified on every run, so a past deadline becomes `closed` naturally.)

## 5. The `unavailable → connected` gate

`registry.ts` derives every state's status on every read:

`connected` requires **all four**: a connector, a source-validation manifest
entry, agreement between the two (connector id **and** source URL), and an
`officialHost` on the approved-host allowlist. Anything else is `unavailable`
with a machine-readable reason, and `getConnector()` refuses to hand out a
connector for a state that is not connected — so the sync runner physically
cannot sync an unvalidated state.

Adding a state (the "batches of five" step) therefore means, in this order:

1. write the connector, with `sourceUrl` hard-coded to the official listing;
2. write `<state>.source-validation.test.ts` (live fetch, ≥1 real record,
   official hosts only, dates parse or null, honesty contract, deterministic
   re-parse) — this is the test the manifest names;
3. add the manifest entry to `registry.ts` (connector id, source URL, test file,
   date verified) and the host to `APPROVED_SOURCE_HOSTS`;
4. run the unit + integration + source-validation suites.

Until step 3 lands, the state reports `unavailable` even with a perfect
connector. That is the point.

## 6. Isolation from the federal product

The state tables, the connectors and the runner are **not** read by `/grants`,
`/api/grants/search`, the Radar funnel, any `grants_*` event, or any pricing
path. No state code may import from the federal grants modules except the shared
freshness helper (`easternDayStart`), and no federal module may import from
`src/lib/state-grants/`. Keep it that way.

## 7. Operations

```
bun run sync:state -- va                 # sync one state (registry-gated)
bun run sync:state -- --all-connected    # every connected state
bun run sync:state -- --registry         # mirror the registry table only
bun run db/migrations/run-043.ts         # apply migration 043 (owner-approved)
```

A schedule is **not** wired in part 1. When it is, it belongs in a GitHub
Actions workflow on the repo's existing 4-hour sync pattern (never Vercel cron),
calling `bun run sync:state -- --all-connected` with the same `DATABASE_URL`
secret the other sync workflows use.
