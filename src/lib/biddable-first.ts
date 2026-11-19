/**
 * Order a list of open bids so a visitor first sees work there is still time to bid
 * (owner 2026-11-19: state pages opened on bids due the same day). Bids with at least
 * `minDays` left come first, then the ones closing sooner, then any with no date.
 * The order inside each group is kept, so a list sorted soonest-first stays that way.
 */
export const BIDDABLE_MIN_DAYS = 7;

export function biddableFirst<T extends { due_date?: string | null }>(rows: T[], now: Date = new Date(), minDays: number = BIDDABLE_MIN_DAYS): T[] {
  const cutoff = now.getTime() + minDays * 86_400_000;
  const roomy: T[] = [];
  const soon: T[] = [];
  const undated: T[] = [];
  for (const r of rows) {
    const t = r.due_date ? new Date(r.due_date).getTime() : NaN;
    if (!Number.isFinite(t)) undated.push(r);
    else if (t >= cutoff) roomy.push(r);
    else soon.push(r);
  }
  return [...roomy, ...soon, ...undated];
}
