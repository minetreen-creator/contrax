/**
 * Subcontracts email gate (owner 2026-10-23: a Las Vegas visitor kept coming
 * back to /subcontracts and never had to leave an email). The first few
 * notices and winners stay free; the rest unlock with an email (the same
 * opt-in lead as Radar's /api/radar/lead) or an account. PURE.
 */

/** Notices shown before the gate. */
export const FREE_NOTICES = 3;
/** Recent winners shown before the gate on a state page. */
export const FREE_WINNERS = 3;
/** This browser left an email already (a per-viewer convenience; the lead itself is in the database). */
export const SUBS_UNLOCK_KEY = "contrax_subs_unlocked";

/** The rows to show and how many are behind the gate. */
export function gateSplit<T>(rows: readonly T[], free: number, unlocked: boolean): { shown: T[]; locked: number } {
  if (unlocked || rows.length <= free) return { shown: [...rows], locked: 0 };
  return { shown: rows.slice(0, free), locked: rows.length - free };
}
