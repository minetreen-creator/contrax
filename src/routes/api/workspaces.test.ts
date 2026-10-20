/**
 * /api/workspaces — the REAL handlers driven end to end (auth → entitlement ladder →
 * branch → status code) with an in-memory store, no database and no `mock.module`
 * (bun's mock registry is process-global and leaks across test files in one run — the
 * pathology documented in src/routes/api/subcontracts/primes.ts). Same shape as the
 * CRM route tests.
 *
 * This is where the brief's behavioural pins live:
 *   * a non-Agency account cannot create a workspace (403, and the store is never
 *     asked to write);
 *   * the hard cap of 10 answers 409 with the plan's own limit;
 *   * DOWNGRADE READ-SURVIVE / EDIT-GATE — a downgraded account still GETs every
 *     workspace it created, but create/rename/settings are refused; switching (a read
 *     context, not an edit) still works;
 *   * everything is owner-scoped: an id the store does not return for this owner is a
 *     404, never a silent success.
 */
import { describe, expect, test } from "bun:test";
import { workspaceRouteHandlers, type WorkspaceRouteUser } from "./workspaces";
import type { WorkspaceAccess } from "~/lib/workspaces";
import type { WorkspaceRow, WorkspaceStore } from "~/lib/workspaces.server";

const USER: WorkspaceRouteUser = { id: 42 };

const AGENCY: WorkspaceAccess = { canCreate: true, limit: 10 };
const DOWNGRADED: WorkspaceAccess = { canCreate: false, limit: 0 };

/** An in-memory store that records every call, so "did it even try to write?" is pinned. */
function fakeStore(seed: WorkspaceRow[] = []) {
  const rows = [...seed];
  const calls: string[] = [];
  let active: number | null = null;
  let nextId = 100;
  const store: WorkspaceStore = {
    async list(userId) {
      calls.push(`list:${userId}`);
      return rows;
    },
    async create(userId, limit, input) {
      calls.push(`create:${userId}:${limit}:${input.name}`);
      if (limit <= 0 || rows.length >= limit) return null;
      const id = nextId++;
      rows.push({ id, name: input.name, profileId: null, states: input.states, trades: input.trades, created_at: null });
      return id;
    },
    async rename(userId, id, name) {
      calls.push(`rename:${userId}:${id}:${name}`);
      const row = rows.find((r) => r.id === id);
      if (!row) return null;
      row.name = name;
      return id;
    },
    async updateSettings(userId, id, states, trades) {
      calls.push(`settings:${userId}:${id}`);
      const row = rows.find((r) => r.id === id);
      if (!row) return null;
      row.states = states;
      row.trades = trades;
      return id;
    },
    async setActive(userId, id) {
      calls.push(`switch:${userId}:${String(id)}`);
      if (id === null) {
        active = null;
        return true;
      }
      if (!rows.some((r) => r.id === id)) return false;
      active = id;
      return true;
    },
    async getActiveWorkspaceId() {
      return active;
    },
  };
  return { store, calls, rows, getActive: () => active };
}

function handlers(access: WorkspaceAccess, store: WorkspaceStore) {
  return workspaceRouteHandlers({
    authenticate: async () => USER,
    getAccess: async () => access,
    store,
  });
}

function post(body: unknown, url = "https://contrax.test/api/workspaces"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ONE_ROW: WorkspaceRow = {
  id: 1,
  name: "Acme Janitorial",
  profileId: 9,
  states: ["VA"],
  trades: ["Janitorial"],
  created_at: null,
};

describe("POST /api/workspaces — who can create", () => {
  test("NON-AGENCY CANNOT CREATE: 403 and the store is never asked to write", async () => {
    const fake = fakeStore();
    const response = await handlers(DOWNGRADED, fake.store).POST({
      request: post({ action: "create", name: "Client A" }),
    });
    expect(response.status).toBe(403);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toBe("agency_plan_required");
    expect(fake.calls).toEqual([]);
  });

  test("an unauthenticated caller is a 401, before any entitlement read", async () => {
    const response = await workspaceRouteHandlers({
      authenticate: async () => null,
      getAccess: async () => AGENCY,
      store: fakeStore().store,
    }).POST({ request: post({ action: "create", name: "Client A" }) });
    expect(response.status).toBe(401);
  });

  test("AGENCY creates: 201, states/trades passed through as given", async () => {
    const fake = fakeStore();
    const response = await handlers(AGENCY, fake.store).POST({
      request: post({ action: "create", name: "  Client A  ", states: ["va"], trades: ["Janitorial"] }),
    });
    expect(response.status).toBe(201);
    expect(fake.calls).toEqual(["create:42:10:Client A"]);
    expect(fake.rows[0]).toMatchObject({ name: "Client A", states: ["VA"], trades: ["Janitorial"] });
  });

  test("CAP OF 10: the 10th is allowed, the 11th is a 409 naming the plan's limit", async () => {
    const full = Array.from({ length: 9 }, (_, i) => ({
      id: i + 1,
      name: `Client ${i + 1}`,
      profileId: null,
      states: [],
      trades: [],
      created_at: null,
    }));
    const fake = fakeStore(full);
    const route = handlers(AGENCY, fake.store);

    const tenth = await route.POST({ request: post({ action: "create", name: "Client 10" }) });
    expect(tenth.status).toBe(201);
    expect(fake.rows).toHaveLength(10);

    const eleventh = await route.POST({ request: post({ action: "create", name: "Client 11" }) });
    expect(eleventh.status).toBe(409);
    const payload = (await eleventh.json()) as { error: string; message: string };
    expect(payload.error).toBe("workspace_limit");
    expect(payload.message).toBe("Your plan allows 10 client workspaces.");
    expect(fake.rows).toHaveLength(10);
  });

  test("malformed input is a 400 and writes nothing (states are never silently dropped)", async () => {
    const fake = fakeStore();
    const route = handlers(AGENCY, fake.store);
    for (const body of [
      { action: "create", name: "" },
      { action: "create", name: "Client A", states: ["Virginia"] },
      { action: "create", name: "Client A", trades: ["   "] },
      { action: "create", name: "Client A", states: "VA" },
    ]) {
      const response = await route.POST({ request: post(body) });
      expect({ body, status: response.status }).toEqual({ body, status: 400 });
    }
    expect(fake.calls).toEqual([]);
  });
});

describe("GET /api/workspaces — reads survive a downgrade", () => {
  test("a DOWNGRADED account still reads every workspace it has, and is told it cannot create", async () => {
    const fake = fakeStore([ONE_ROW]);
    const response = await handlers(DOWNGRADED, fake.store).GET({
      request: new Request("https://contrax.test/api/workspaces"),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: WorkspaceRow[];
      activeWorkspaceId: number | null;
      canCreate: boolean;
      limit: number;
    };
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]!.name).toBe("Acme Janitorial");
    expect(payload.canCreate).toBe(false);
    expect(payload.limit).toBe(0);
  });

  test("an Agency account is told the cap and which client is active", async () => {
    const fake = fakeStore([ONE_ROW]);
    await fake.store.setActive(USER.id, 1);
    const response = await handlers(AGENCY, fake.store).GET({
      request: new Request("https://contrax.test/api/workspaces"),
    });
    const payload = (await response.json()) as { activeWorkspaceId: number | null; limit: number };
    expect(payload.activeWorkspaceId).toBe(1);
    expect(payload.limit).toBe(10);
  });
});

describe("edits are gated by entitlement, reads are not", () => {
  test("DOWNGRADED: rename and settings are 403 and never reach the store", async () => {
    const fake = fakeStore([ONE_ROW]);
    const route = handlers(DOWNGRADED, fake.store);
    for (const body of [
      { action: "rename", id: 1, name: "Renamed" },
      { action: "settings", id: 1, states: ["MD"], trades: [] },
    ]) {
      const response = await route.POST({ request: post(body) });
      expect({ body, status: response.status }).toEqual({ body, status: 403 });
    }
    expect(fake.calls).toEqual([]);
  });

  test("DOWNGRADED: switching (a read context, not an edit) still works", async () => {
    const fake = fakeStore([ONE_ROW]);
    const response = await handlers(DOWNGRADED, fake.store).POST({
      request: post({ action: "switch", id: 1 }),
    });
    expect(response.status).toBe(200);
    expect(fake.getActive()).toBe(1);
  });

  test("AGENCY: rename / settings / switch hit the store, and a foreign id is a 404", async () => {
    const fake = fakeStore([ONE_ROW]);
    const route = handlers(AGENCY, fake.store);
    expect((await route.POST({ request: post({ action: "rename", id: 1, name: "Acme 2" }) })).status).toBe(200);
    expect(
      (await route.POST({ request: post({ action: "settings", id: 1, states: ["MD", "dc"], trades: ["HVAC"] }) }))
        .status,
    ).toBe(200);
    expect(fake.rows[0]).toMatchObject({ name: "Acme 2", states: ["MD", "DC"], trades: ["HVAC"] });
    // An id this account does not own is a 404 — never a silent success.
    expect((await route.POST({ request: post({ action: "rename", id: 999, name: "Hijack" }) })).status).toBe(404);
    expect((await route.POST({ request: post({ action: "switch", id: 999 }) })).status).toBe(404);
    // Switching back to the account's own context is allowed and explicit.
    expect((await route.POST({ request: post({ action: "switch", id: null }) })).status).toBe(200);
    expect(fake.getActive()).toBeNull();
  });

  test("an unknown action is a 400", async () => {
    const response = await handlers(AGENCY, fakeStore().store).POST({
      request: post({ action: "deleteEverything" }),
    });
    expect(response.status).toBe(400);
  });
});
