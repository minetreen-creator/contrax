/**
 * GET /api/workspace-export — the REAL handler driven end to end (auth → store →
 * CSV + headers) with an in-memory store and a FROZEN clock: no database, no
 * network, no `mock.module` (bun's mock registry is process-global and leaks across
 * test files). Like src/lib/workspaces-route.test.ts and
 * src/lib/agency-overview-route.test.ts it lives in src/lib on purpose: a `*.test.ts`
 * under src/routes is scanned by the route-tree generator, which warns that it
 * exports no Route.
 *
 * The behavioural pins for the Agency tier's per-client export (phase 3):
 *   * an anonymous caller is a 401 and the store is NEVER touched;
 *   * a missing / non-numeric / non-positive workspace id is a 400 and the store is
 *     never touched (no query is made with an id the caller typed loosely);
 *   * another account's workspace id is a 404 whose body carries NO csv — the store
 *     is asked with the SESSION user id, so the id alone buys nothing;
 *   * two clients of one agency never bleed into each other's file, and the
 *     unfiled (workspace_id IS NULL) rows are in neither;
 *   * the download is a text/csv attachment whose filename is the client's own,
 *     sanitised, date-stamped name from the frozen clock;
 *   * a store failure is a 500, never an empty file that reads as "no data".
 */
import { describe, expect, test } from "bun:test";
import { workspaceExportHandlers, type WorkspaceExportRouteUser } from "~/routes/api/workspace-export";
import type { WorkspaceExportStore } from "~/lib/workspace-export.server";
import type { WorkspaceExportBundle } from "~/lib/workspace-export";

const USER: WorkspaceExportRouteUser = { id: 42 };
const OTHER_USER: WorkspaceExportRouteUser = { id: 43 };
const NOW = new Date("2026-10-20T15:30:00.000Z");

function bundle(
  id: number,
  name: string,
  bids: WorkspaceExportBundle["bids"] = [],
  contacts: WorkspaceExportBundle["contacts"] = [],
): WorkspaceExportBundle {
  return { workspace: { id, name }, bids, contacts };
}

const bid = (title: string) => ({
  title,
  agency: "GSA",
  location: null,
  due_date: "2026-11-02",
  pursuit_status: "evaluating",
  next_action: null,
  follow_up_date: null,
  saved_at: "2026-10-19T09:00:00.000Z",
  source_url: null,
  contact_name: null,
});

const contact = (name: string) => ({
  name,
  organization: "Acme Federal Services",
  role: "",
  email: `${name.toLowerCase()}@acme.example`,
  phone: "",
  notes: "",
  created_at: "2026-09-30T12:00:00.000Z",
  last_activity_at: null,
});

/**
 * A store keyed by `userId:workspaceId`, recording exactly what it was asked for —
 * so "the store was never called" and "it was called with the SESSION user" are
 * both assertions, not assumptions.
 */
function fakeStore(byKey: Record<string, WorkspaceExportBundle>) {
  const calls: Array<{ userId: number; workspaceId: number }> = [];
  const store: WorkspaceExportStore = {
    async load(userId, workspaceId) {
      calls.push({ userId, workspaceId });
      return byKey[`${userId}:${workspaceId}`] ?? null;
    },
  };
  return { store, calls };
}

/** A store that fails the way a missing migration or a dead connection would. */
const failingStore: WorkspaceExportStore = {
  async load() {
    throw new Error('relation "crm_contacts" does not exist');
  },
};

function route(store: WorkspaceExportStore, user: WorkspaceExportRouteUser | null = USER) {
  return workspaceExportHandlers({ authenticate: async () => user, store, now: () => NOW });
}

const URL_FOR = (query: string) => `https://contrax.test/api/workspace-export${query}`;

function get(store: WorkspaceExportStore, id: number | string, user = USER) {
  return route(store, user).GET({ request: new Request(URL_FOR(`?workspace=${id}`)) });
}

describe("GET /api/workspace-export — who may download", () => {
  test("ANONYMOUS IS 401 and the store is never asked for anything", async () => {
    const fake = fakeStore({ "42:7": bundle(7, "Acme Janitorial", [bid("Bid A")]) });
    const response = await route(fake.store, null).GET({ request: new Request(URL_FOR("?workspace=7")) });
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: string }).error).toBe("Not authenticated");
    expect(fake.calls).toEqual([]);
  });

  for (const query of ["", "?workspace=", "?workspace=abc", "?workspace=0", "?workspace=-3", "?workspace=7.5", "?workspace=1e3"]) {
    test(`a missing or invalid workspace id ("${query}") is a 400 and the store is untouched`, async () => {
      const fake = fakeStore({ "42:7": bundle(7, "Acme Janitorial", [bid("Bid A")]) });
      const response = await route(fake.store).GET({ request: new Request(URL_FOR(query)) });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe("Invalid workspace id");
      expect(fake.calls).toEqual([]);
    });
  }
});

describe("GET /api/workspace-export — the client can only ever be the caller's own", () => {
  test("ANOTHER ACCOUNT'S workspace id is a 404 carrying no csv at all", async () => {
    // 99 is a workspace that exists — but it belongs to user 43.
    const fake = fakeStore({ "43:99": bundle(99, "Someone Else LLC", [bid("Their secret bid")]) });
    const response = await get(fake.store, 99, USER);
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toContain("Their secret bid");
    expect(body).not.toContain("Record type");
    expect(JSON.parse(body)).toEqual({ error: "Workspace not found" });
    // It WAS asked — with the SESSION user (42) and the target id, which is the
    // double pin. The store cannot return client 99's rows for user 42.
    expect(fake.calls).toEqual([{ userId: 42, workspaceId: 99 }]);
  });

  test("the SAME id read by its real owner returns that owner's rows (the 404 above is ownership, not absence)", async () => {
    const fake = fakeStore({ "43:99": bundle(99, "Someone Else LLC", [bid("Their own bid")]) });
    const response = await get(fake.store, 99, OTHER_USER);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Their own bid");
    expect(fake.calls).toEqual([{ userId: 43, workspaceId: 99 }]);
  });

  test("an id that does not exist is the same 404 — no client is enumerable", async () => {
    const fake = fakeStore({});
    const response = await get(fake.store, 12345);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe(JSON.stringify({ error: "Workspace not found" }));
  });

  test("TWO CLIENTS NEVER BLEED — each client's file holds only that client's rows", async () => {
    const fake = fakeStore({
      "42:1": bundle(1, "Acme Janitorial", [bid("Acme bid")], [contact("Dana")]),
      "42:2": bundle(2, "Bright HVAC", [bid("Bright bid")], [contact("Kai")]),
    });
    const blue = await (await get(fake.store, 1)).text();
    const orange = await (await get(fake.store, 2)).text();
    expect(blue).toContain("Acme bid");
    expect(blue).toContain("Dana");
    expect(blue).not.toContain("Bright bid");
    expect(blue).not.toContain("Kai");
    expect(orange).toContain("Bright bid");
    expect(orange).toContain("Kai");
    expect(orange).not.toContain("Acme bid");
    expect(orange).not.toContain("Dana");
    // Exactly one read per request, each pinned to (session user, that client).
    expect(fake.calls).toEqual([
      { userId: 42, workspaceId: 1 },
      { userId: 42, workspaceId: 2 },
    ]);
  });

  test("a DOWNGRADED account still exports (phase 1: reads survive a downgrade)", async () => {
    // The handler has no entitlement seam at all — entitlement lives in
    // /api/workspaces (edits only), so an export never consults it.
    const fake = fakeStore({ "42:7": bundle(7, "Acme Janitorial", [bid("Bid A")]) });
    const response = await get(fake.store, 7);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Bid A");
  });
});

describe("GET /api/workspace-export — the download itself", () => {
  test("is a text/csv attachment named after the client and the (frozen) date", async () => {
    const fake = fakeStore({ "42:7": bundle(7, "Acme Janitorial", [bid("Bid A")]) });
    const response = await get(fake.store, 7);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="acme-janitorial-pipeline-2026-10-20.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("a hostile workspace name cannot inject a header (the filename stays a slug)", async () => {
    const fake = fakeStore({ "42:7": bundle(7, 'Acme"\r\nX-Evil: 1', [bid("Bid A")]) });
    const headers = (await get(fake.store, 7)).headers;
    expect(headers.get("content-disposition")).toBe('attachment; filename="acme-x-evil-1-pipeline-2026-10-20.csv"');
    expect(headers.get("x-evil")).toBeNull();
  });

  test("the body is the client's CSV: header row, CRLF, header-only for an empty client", async () => {
    const full = await (await get(fakeStore({ "42:7": bundle(7, "Acme", [bid("Bid A")]) }).store, 7)).text();
    expect(full.startsWith("Record type,Bid title,Agency,")).toBe(true);
    expect(full.endsWith("\r\n")).toBe(true);
    expect(full).toContain("Bid A");

    const empty = await (await get(fakeStore({ "42:8": bundle(8, "Quiet Client") }).store, 8)).text();
    expect(empty.split("\r\n")).toHaveLength(2); // header + the trailing terminator
    expect(empty).toContain("Record type");
  });
});

describe("GET /api/workspace-export — honest failure", () => {
  test("a store failure is a 500 with a plain message, NEVER an empty file", async () => {
    const response = await get(failingStore, 7);
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toBeNull();
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: "Could not export this client" });
    expect(body).not.toContain("Record type");
  });
});
