/**
 * One-at-a-time lock for CI suites that write fixed test rows to the shared
 * database (owner 2026-10-13). The state grants real-DB suite writes synthetic
 * states ZZ/ZY and `itest-` sources and deletes them in its hooks, so two Build
 * Check runs at once delete each other's rows and both fail (every overlapping
 * pair failed on 2026-10-13; every run alone passed). A row in `ci_locks` is the
 * lock: it works over the serverless HTTP driver, where a session advisory lock
 * would not last between queries. A lock older than `staleMs` is from a run that
 * died, and is cleared.
 *
 * PURE: the store is injected (scripts/with-db-lock.ts gives it the database).
 */
export interface LockStore {
  /** Remove the lock if it was taken before `olderThan`. */
  clearStale(name: string, olderThan: Date): Promise<void>;
  /** Take the lock if free; true when this holder now has it. */
  tryTake(name: string, holder: string, at: Date): Promise<boolean>;
  /** Release the lock if this holder has it. */
  release(name: string, holder: string): Promise<void>;
}

export interface LockOptions {
  /** A lock held longer than this is from a dead run (default 20 minutes). */
  staleMs?: number;
  /** Time between attempts (default 10 seconds). */
  pollMs?: number;
  /** Give up after this long (default 25 minutes). */
  timeoutMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (s: string) => void;
}

export async function acquireLock(store: LockStore, name: string, holder: string, opts: LockOptions = {}): Promise<void> {
  const staleMs = opts.staleMs ?? 20 * 60_000;
  const pollMs = opts.pollMs ?? 10_000;
  const timeoutMs = opts.timeoutMs ?? 25 * 60_000;
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const start = now().getTime();
  let waited = false;
  for (;;) {
    const t = now();
    await store.clearStale(name, new Date(t.getTime() - staleMs));
    if (await store.tryTake(name, holder, t)) {
      if (waited) opts.log?.(`[ci-lock] ${name}: acquired after ${Math.round((t.getTime() - start) / 1000)}s`);
      return;
    }
    if (t.getTime() - start >= timeoutMs) throw new Error(`[ci-lock] ${name}: still held by another run after ${Math.round(timeoutMs / 60_000)} minutes`);
    if (!waited) opts.log?.(`[ci-lock] ${name}: another CI run holds it; waiting`);
    waited = true;
    await sleep(pollMs);
  }
}
