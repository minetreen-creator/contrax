/**
 * Shared ingest date normalization.
 *
 * `toIsoDueDate` was module-private in `src/jobs/runner.ts` until the Ohio Phase 3
 * connector (`src/jobs/sources/oh-dayton.ts`) needed the SAME conversion the runner
 * applies to every other source's `due_date` — reusing it (rather than hand-rolling
 * a second parser) is what keeps one corpus-wide due-date semantic. It was MOVED
 * here verbatim (same 5 lines, same behavior) so the runner and a source module can
 * share ONE definition without a circular import (oh-dayton.ts ← runner.ts).
 *
 * SEMANTICS (unchanged): `new Date(value)` — the runtime's own parse — then
 * `.toISOString()`. Anything the runtime cannot parse → `null` (never guessed,
 * never defaulted to "today"). A null due_date is a legitimate value: rows the
 * source itself leaves open-ended are inserted with NULL, not dropped.
 *
 * TIMEZONE NOTE (Ohio Phase 3 spec R17, option (a) — documented decision):
 * a source like the City of Dayton writes wall-clock LOCAL times with no zone
 * suffix ("10/6/2026 10:00 AM" + "(Dayton Local Time)"). `new Date()` reads those
 * as the RUNTIME's local time, so under the sync environment (UTC) a Dayton
 * 10:00 AM closing is stored as 10:00Z — up to 4 h off the true instant on EDT.
 * That is the deliberate, corpus-consistent choice (every other source behaves
 * the same way; `pennbid.ts` has the identical latent pattern) and is accepted
 * for a boundary error on "closing soon" ordering only. The alternative — a
 * per-source DST-aware zone conversion — would make this one source disagree with
 * the rest of the corpus, so it is NOT done here; see the connector header.
 */
export function toIsoDueDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
