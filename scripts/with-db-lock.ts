/**
 * Run a command while holding a CI lock in the shared database (owner 2026-10-13).
 *
 *   bun run scripts/with-db-lock.ts <lock-name> -- <command> [args...]
 *
 * Without DATABASE_URL the command just runs (nothing shared to protect). The
 * lock is released however the command ends; the command's exit code is kept.
 * See src/lib/ci-db-lock.ts for why.
 */
import { acquireLock, type LockStore } from "~/lib/ci-db-lock";

const args = process.argv.slice(2);
const sep = args.indexOf("--");
const name = args[0];
const cmd = sep >= 0 ? args.slice(sep + 1) : [];
if (!name || sep !== 1 || cmd.length === 0) {
  console.error("usage: bun run scripts/with-db-lock.ts <lock-name> -- <command> [args...]");
  process.exit(2);
}

const run = async () => {
  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit", stdin: "inherit" });
  return await proc.exited;
};

if (!process.env.DATABASE_URL) {
  process.exit(await run());
}

const { sql } = await import("~/db");
const db = sql();
await db`CREATE TABLE IF NOT EXISTS ci_locks (name TEXT PRIMARY KEY, holder TEXT NOT NULL, acquired_at TIMESTAMPTZ NOT NULL)`;
const store: LockStore = {
  clearStale: async (n, olderThan) => {
    await db`DELETE FROM ci_locks WHERE name = ${n} AND acquired_at < ${olderThan.toISOString()}`;
  },
  tryTake: async (n, holder, at) => {
    const rows = (await db`
      INSERT INTO ci_locks (name, holder, acquired_at) VALUES (${n}, ${holder}, ${at.toISOString()})
      ON CONFLICT (name) DO NOTHING RETURNING holder`) as unknown[];
    return rows.length > 0;
  },
  release: async (n, holder) => {
    await db`DELETE FROM ci_locks WHERE name = ${n} AND holder = ${holder}`;
  },
};

const holder = `${process.env.GITHUB_RUN_ID ?? "local"}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}-${process.pid}`;
await acquireLock(store, name, holder, { log: (s) => console.log(s) });
let code = 1;
try {
  code = await run();
} finally {
  await store.release(name, holder).catch((e) => console.error(`[ci-lock] ${name}: release failed (it expires on its own):`, e));
}
process.exit(code);
