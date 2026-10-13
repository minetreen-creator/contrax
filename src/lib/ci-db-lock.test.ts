import { describe, expect, test } from "bun:test";
import { acquireLock, type LockStore } from "./ci-db-lock";

/** In-memory store with the same semantics as the ci_locks table. */
function memoryStore() {
  const locks = new Map<string, { holder: string; at: Date }>();
  const store: LockStore = {
    clearStale: async (name, olderThan) => {
      const l = locks.get(name);
      if (l && l.at < olderThan) locks.delete(name);
    },
    tryTake: async (name, holder, at) => {
      if (locks.has(name)) return false;
      locks.set(name, { holder, at });
      return true;
    },
    release: async (name, holder) => {
      if (locks.get(name)?.holder === holder) locks.delete(name);
    },
  };
  return { store, locks };
}

function clock(startMs = Date.parse("2026-10-13T02:00:00Z")) {
  let t = startMs;
  return { now: () => new Date(t), sleep: async (ms: number) => void (t += ms) };
}

describe("CI database lock (owner 2026-10-13)", () => {
  test("a free lock is taken at once", async () => {
    const { store, locks } = memoryStore();
    const c = clock();
    await acquireLock(store, "state-grants", "run-1", c);
    expect(locks.get("state-grants")?.holder).toBe("run-1");
  });

  test("a second run waits until the first releases", async () => {
    const { store, locks } = memoryStore();
    const c = clock();
    await acquireLock(store, "state-grants", "run-1", c);
    let released = false;
    const sleep = async (ms: number) => {
      await c.sleep(ms);
      if (!released) {
        released = true;
        await store.release("state-grants", "run-1");
      }
    };
    await acquireLock(store, "state-grants", "run-2", { now: c.now, sleep });
    expect(locks.get("state-grants")?.holder).toBe("run-2");
  });

  test("a lock left by a dead run is cleared once it is stale", async () => {
    const { store, locks } = memoryStore();
    const c = clock();
    await acquireLock(store, "state-grants", "dead-run", c);
    await acquireLock(store, "state-grants", "run-2", { ...c, staleMs: 60_000, pollMs: 30_000 });
    expect(locks.get("state-grants")?.holder).toBe("run-2");
  });

  test("gives up with a clear error after the timeout", async () => {
    const { store } = memoryStore();
    const c = clock();
    await acquireLock(store, "state-grants", "run-1", c);
    await expect(
      acquireLock(store, "state-grants", "run-2", { ...c, staleMs: 60 * 60_000, pollMs: 60_000, timeoutMs: 5 * 60_000 }),
    ).rejects.toThrow("still held by another run");
  });

  test("release only frees the holder's own lock", async () => {
    const { store, locks } = memoryStore();
    await acquireLock(store, "state-grants", "run-1", clock());
    await store.release("state-grants", "someone-else");
    expect(locks.get("state-grants")?.holder).toBe("run-1");
  });
});
