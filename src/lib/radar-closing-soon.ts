/**
 * Owner 2026-11-02: a Conroe, TX visitor searched landscaping, opened the top
 * result (a Harris County mowing ITB due that same day) and left. Nobody can
 * bid a job that closes today, so radar results put bids closing within
 * CLOSING_SOON_DAYS after the ones there is still time to win. They stay in the
 * list, just at the bottom; every other row keeps its ranking.
 */
export const CLOSING_SOON_DAYS = 2;

/** True when a bid's deadline is within CLOSING_SOON_DAYS of now. PURE. */
export function closesTooSoon(dueDate: string | Date | null | undefined, now: number = Date.now()): boolean {
  if (!dueDate) return false;
  const t = new Date(dueDate).getTime();
  if (Number.isNaN(t)) return false;
  return t - now < CLOSING_SOON_DAYS * 86_400_000;
}

/** Same rows, bids closing too soon moved to the end; order otherwise kept. PURE. */
export function closingSoonLast<T>(rows: readonly T[], due: (row: T) => string | Date | null | undefined, now: number = Date.now()): T[] {
  const open: T[] = [];
  const soon: T[] = [];
  for (const r of rows) (closesTooSoon(due(r), now) ? soon : open).push(r);
  return [...open, ...soon];
}
