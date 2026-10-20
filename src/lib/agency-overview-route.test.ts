/**
 * GET /api/agency-overview — the REAL handler driven end to end (auth → store →
 * payload) with an in-memory store and a FROZEN clock: no database, no network, no
 * `mock.module` (bun's mock registry is process-global and leaks across test files).
 * Like src/lib/workspaces-route.test.ts it lives in src/lib on purpose: a `*.test.ts`
 * under src/routes is scanned by the route-tree generator, which warns that it
 * exports no Route.
 *
 * The behavioural pins for the Agency tier's cross-client dashboard:
 *   * an anonymous caller is a 401 and the store is never touched;
 *   * the rollup is asked for THE AUTHENTICATED user's workspaces only — there is no
 *     parameter a request can use to read another account (or another account's
 *     client) — and each client's row carries only its own counts;
 *   * a DOWNGRADED account still reads (phase 1's "reads survive a downgrade");
 *   * the 7-day window handed to the store comes from the clock, not from the client;
 *   * all ten workspaces the cap allows render, and a store failure is an honest 500.
 */
import { describe, expect, test } from "bun:test";
import { agencyOverviewHandlers, type AgencyOverviewRouteUser } from "~/routes/api/agency-overview";
import type { AgencyOverviewWindow, WorkspaceStats } from "~/lib/agency-overview";
import type { AgencyOverviewStore } from "~/lib/agency-overview.server";

const USER: AgencyOverviewRouteUser = { id: 42 };
const OTHER_USER: AgencyOverviewRouteUser = { id: 43 };
const NOW = new Date("2026-10-20T15:30:00.000Z");

function stats(overrides: Partial<WorkspaceStats> & { id: number; name: string }): WorkspaceStats {
  return {
    states: [],
    trades: [],
    savedBids: 0,
    dueInWindow: 0,
    overdue: 0,
    byPursuit: {},
    lastSavedAt: null,
    contacts: 0,
    lastCrmActivityAt: null,
    ...overrides,
  };
}

/** A store keyed by owner, recording exactly which user and window it was asked for. */
function fakeStore(byUser: Record<number, WorkspaceStats[]>) {
  const calls: Array<{ userId: number; window: AgencyOverviewWindow }> = [];
  const store: AgencyOverviewStore = {
    async rollup(userId, window) {
      calls.push({ userId, window });
      return byUser[userId] ?? [];
    },
  };
  return { store, calls };
}

/** A store that fails the way a missing migration or a dead connection would. */
const failingStore: AgencyOverviewStore = {
  async rollup() {
    throw new Error("relation \"workspaces\" does not exist");
  },
};

function route(store: AgencyOverviewStore, user: AgencyOverviewRouteUser | null = USER) {
  return agencyOverviewHandlers({ authenticate: async () => user, store, now: () => NOW });
}

function get(received = route(fakeStore({}).store)) {
  return received.GET({ request: new Request("https://contrax.test/api/agency-overview") });
}

describe("GET /api/agency-overview — who may read", () => {
  test("ANONYMOUS IS 401 and the store is never asked for anything", async () => {
    const fake = fakeStore({ 42: [stats({ id: 1, name: "Acme Janitorial", savedBids: 2 })] });
    const response = await route(fake.store, null).GET({
      request: new Request("https://contrax.test/api/agency-overview"),
    });
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: string }).error).toBe("Not authenticated");
    expect(fake.calls).toEqual([]);
  });

  test("A DOWNGRADED account still reads its clients (phase 1: reads survive a downgrade)", async () => {
    // Entitlement is not consulted at all on this read path — the handler has no
    // access seam to fall back on, so a downgraded Agency account sees exactly the
    // same payload as an active one. Entitlement lives in /api/workspaces only.
    const fake = fakeStore({ 42: [stats({ id: 1, name: "Acme Janitorial", savedBids: 3, overdue: 1 })] });
    const response = await get(route(fake.store));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { workspaces: WorkspaceStats[] };
    expect(payload.workspaces).toHaveLength(1);
    expect(payload.workspaces[0]!.name).toBe("Acme Janitorial");
  });
});

describe("GET /api/agency-overview — scoping", () => {
  test("asks for the AUTHENTICATED user's workspaces only, and returns nothing of another account's", async () => {
    const fake = fakeStore({
      42: [stats({ id: 1, name: "Acme Janitorial", savedBids: 2 })],
      43: [stats({ id: 99, name: "Someone Else LLC", savedBids: 8 })],
    });
    const response = await get(route(fake.store, USER));
    const payload = (await response.json()) as { workspaces: WorkspaceStats[] };
    // The one and only store call is keyed by the session user.
    expect(fake.calls).toEqual([{ userId: 42, window: { today: "2026-10-20", weekEnd: "2026-10-27" } }]);
    expect(payload.workspaces.map((w) => w.id)).toEqual([1]);
    expect(payload.workspaces.some((w) => w.id === 99)).toBe(false);
  });

  test("EACH CLIENT'S ROW CARRIES ONLY ITS OWN COUNTS — two clients of one agency never bleed into each other", async () => {
    const fake = fakeStore({
      42: [
        stats({ id: 1, name: "Acme Janitorial", savedBids: 4, dueInWindow: 2, overdue: 0, contacts: 7 }),
        stats({ id: 2, name: "Bright HVAC", savedBids: 6, dueInWindow: 0, overdue: 3, contacts: 2 }),
      ],
    });
    const payload = (await (await get(route(fake.store))).json()) as {
      workspaces: WorkspaceStats[];
      totals: Record<string, number>;
    };
    const byName = new Map(payload.workspaces.map((w) => [w.name, w]));
    expect(byName.get("Acme Janitorial")).toMatchObject({ savedBids: 4, dueInWindow: 2, overdue: 0, contacts: 7 });
    expect(byName.get("Bright HVAC")).toMatchObject({ savedBids: 6, dueInWindow: 0, overdue: 3, contacts: 2 });
    expect(payload.totals).toMatchObject({ workspaces: 2, savedBids: 10, dueInWindow: 2, overdue: 3, contacts: 9 });
  });

  test("the 7-day window comes from the server clock, never from the request", async () => {
    const fake = fakeStore({ 42: [] });
    // A request that tries to move the window is simply ignored: the handler reads no
    // query parameter for dates (the only input is the session).
    await route(fake.store).GET({
      request: new Request("https://contrax.test/api/agency-overview?today=1999-01-01&weekEnd=2099-12-31"),
    });
    expect(fake.calls[0]!.window).toEqual({ today: "2026-10-20", weekEnd: "2026-10-27" });
  });

  test("all ten workspaces the phase-1 cap allows are rolled up, attention-first", async () => {
    const ten = Array.from({ length: 10 }, (_, i) =>
      stats({ id: i + 1, name: `Client ${String(i + 1).padStart(2, "0")}`, savedBids: i, overdue: i === 9 ? 2 : 0 }),
    );
    const payload = (await (await get(route(fakeStore({ 42: ten }).store))).json()) as {
      workspaces: WorkspaceStats[];
      totals: Record<string, number>;
    };
    expect(payload.workspaces).toHaveLength(10);
    expect(payload.workspaces[0]!.name).toBe("Client 10"); // the one with overdue work
    expect(payload.totals.savedBids).toBe(45);
  });
});

describe("GET /api/agency-overview — honest failure", () => {
  test("a store failure is a 500 with a plain message, never an empty 'all clear' dashboard", async () => {
    const response = await get(route(failingStore));
    expect(response.status).toBe(500);
    const payload = (await response.json()) as { error: string; workspaces?: unknown };
    expect(payload.error).toBe("Could not load your client overview");
    expect(payload.workspaces).toBeUndefined();
  });

  test("an account with no clients gets an empty but well-formed dashboard", async () => {
    const response = await get(route(fakeStore({}).store));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { workspaces: unknown[]; totals: Record<string, number> };
    expect(payload.workspaces).toEqual([]);
    expect(payload.totals).toEqual({ workspaces: 0, savedBids: 0, dueInWindow: 0, overdue: 0, contacts: 0, advancing: 0 });
  });
});

describe("the OTHER account is never reachable", () => {
  test("the same handler asked as a different session reads that session's clients, not user 42's", async () => {
    const fake = fakeStore({
      42: [stats({ id: 1, name: "Acme Janitorial" })],
      43: [stats({ id: 99, name: "Someone Else LLC" })],
    });
    const payload = (await (await get(route(fake.store, OTHER_USER))).json()) as { workspaces: WorkspaceStats[] };
    expect(fake.calls[0]!.userId).toBe(43);
    expect(payload.workspaces.map((w) => w.name)).toEqual(["Someone Else LLC"]);
  });
});
