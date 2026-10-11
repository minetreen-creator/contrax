/**
 * /api/crm ROUTE HANDLER — END-TO-END, with ZERO database and ZERO network.
 *
 * WHY THIS FILE EXISTS (CRM phase 3c-1 matrix, the two recorded coverage gaps, and
 * the last code item of the CRM build):
 *
 *   GAP (a) — no test invoked the /api/crm route handler at all. The phase-1/2/3a/3b
 *   suites pin the tier ladder (`crm-access.test.ts`), the render states
 *   (`crm-draft-panel-render.test.tsx`), the draft algorithm
 *   (`crm-drafts-run.test.ts`) and the reminder worker
 *   (`crm-reminders.server.test.ts`) — but nothing drove GET/POST /api/crm itself,
 *   so "the contacts read carries no tier gate" and "the write gate is the server's
 *   own 403" were VERIFIED-BY-CONSTRUCTION (source reading) rather than observed.
 *
 *   GAP (b) — no NAMED test pinned the owner's downgrade policy end to end: reads
 *   survive a downgrade, edits are gated server-side, and nothing is deleted. The
 *   two named pins are the `describe("downgrade policy …")` block below
 *   ("READ SURVIVES DOWNGRADE …" / "EDITS ARE GATED AFTER DOWNGRADE …").
 *
 * HOW IT IS DRIVEN — through the route's own injectable seam
 * (`crmRouteHandlers({ authenticate, getAccess, store, reminders, generateDraft,
 * now })`, added in the same commit and defaulting to the REAL collaborators), so
 * this suite exercises the SHIPPED handler code: the origin check, auth, the
 * `access.canEdit` / `relationshipHistory` / `reminders` / `aiDrafts` gates, every
 * branch, the response mapping and both try/catch fail-closed paths. Only the
 * database and the outside world are faked:
 *
 *   * the store is an in-memory `CrmContactsStore` that records every call;
 *   * the entitlement is the REAL `getCrmAccess()` over fake raw columns, and the
 *     trial state is the REAL `computeTrialStatus()` — so a "lapsed Professional" is
 *     the repo's own math on 30-day-old trial columns, not a hand-written stub;
 *   * the reminder lists go through the REAL pure `buildReminderLists()`.
 *
 * NO `mock.module` ANYWHERE — bun's mock registry is process-global and leaks across
 * test files in one run (skill contrax-bun-mock-module-leak). Nothing here touches
 * DATABASE_URL, the network, the clock (a fixed `now` is injected) or Stripe.
 *
 * The route's OWN log lines ("[api/crm] …") appear in the output for the handful of
 * failure-path pins below — that is the shipped code logging, not a warning.
 */
import { describe, expect, test } from "bun:test";
import { getCrmAccess, type CrmAccessDeps } from "./crm-access.server";
import { CRM_DRAFT_PRO_REQUIRED } from "./crm-drafts";
import type { CrmContactFields, CrmContactsStore } from "./crm-contacts.server";
import { buildReminderLists, type CrmReminderPrefsView, type ReminderLists } from "./crm-reminders";
import { computeTrialStatus } from "./trial";

// The route module (createFileRoute + the real collaborators) is imported
// dynamically, exactly as src/lib/pipeline-contacts.test.ts imports
// ~/routes/api/pipeline-workspace: only the factory is used, never the Route.
const { crmRouteHandlers } = await import("~/routes/api/crm");

const ORIGIN = "https://www.contrax.company";
const USER = 7;
const NOW = new Date("2026-10-11T14:00:00.000Z");

/** An account, described by the RAW columns the entitlement ladder reads. */
interface Account {
  /** Trial window start (null = never trialled, or already paid). */
  trialStartedAt?: string | Date | null;
  planTier?: string | null;
  subscriptionStatus?: string | null;
  accessExpiresAt?: string | null;
  fullAccess?: boolean;
  isAdmin?: boolean;
}

/** The ladder's production inputs, verbatim column names. */
function account(over: Account = {}): Account {
  return {
    trialStartedAt: null,
    planTier: null,
    subscriptionStatus: null,
    accessExpiresAt: null,
    fullAccess: false,
    isAdmin: false,
    ...over,
  };
}
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

/**
 * A paying Professional: checkout clears `trial_started_at`, so the entitlement is
 * `subscription_status = 'active'` + `plan_tier = 'professional'` (rev-flagged
 * policy: active subscription ⇒ entitled ⇒ Professional).
 */
const PAYING_PROFESSIONAL = account({ planTier: "professional", subscriptionStatus: "active" });
/** A paying Starter — canEdit, 100 contacts, no Professional reads. */
const PAYING_STARTER = account({ planTier: "starter", subscriptionStatus: "active" });
/**
 * A LAPSED Professional — the downgrade case. 30-day-old trial columns: the real
 * `computeTrialStatus()` reports `expired`, so the real ladder drops it to basic
 * while every row it already stored stays exactly where it is.
 */
const LAPSED_PROFESSIONAL = account({ trialStartedAt: daysAgo(30), planTier: "professional" });
/** Selected a plan at signup, never started the trial, never paid ⇒ no entitlement. */
const NEVER_ENTITLED = account({ planTier: "starter" });

/** The rows a downgraded account already owns (data that must survive). */
const PRESERVED_CONTACTS: Array<Record<string, unknown>> = [
  {
    id: 11,
    name: "Dana Reyes",
    organization: "Acme Federal",
    role: "Contracting Officer",
    email: "dana@acme.test",
    phone: "555-0100",
    notes: "Ring her before the Q&A closes.",
    created_at: "2026-09-20T12:00:00.000Z",
    updated_at: "2026-10-09T12:00:00.000Z",
  },
  {
    id: 12,
    name: "Sam Okafor",
    organization: "Northstar Group",
    role: "Teaming lead",
    email: "",
    phone: "",
    notes: "",
    created_at: "2026-09-21T12:00:00.000Z",
    updated_at: "2026-10-01T12:00:00.000Z",
  },
];

/** What GET /api/crm returns for those rows — the shipped `contactRow` mapping. */
const PRESERVED_CONTACTS_JSON = PRESERVED_CONTACTS.map((r) => ({
  id: Number(r.id),
  name: String(r.name ?? ""),
  organization: String(r.organization ?? ""),
  role: String(r.role ?? ""),
  email: String(r.email ?? ""),
  phone: String(r.phone ?? ""),
  notes: String(r.notes ?? ""),
  created_at: String(r.created_at),
  updated_at: String(r.updated_at),
}));

const CONTACT_ACTIVITIES: Array<Record<string, unknown>> = [
  { id: 31, contact_id: 11, kind: "call", body: "Left a voicemail about the site visit.", created_at: "2026-10-08T15:00:00.000Z" },
];

// ── The in-memory store (the only thing faked for the data layer) ─────────────
interface FakeCrmStore extends CrmContactsStore {
  contactReads: number[];
  activityReads: Array<[number, number]>;
  updates: Array<{ userId: number; id: number; fields: CrmContactFields }>;
  creates: Array<{ userId: number; limit: number; fields: CrmContactFields }>;
  archives: Array<{ userId: number; id: number }>;
  activityWrites: Array<{ userId: number; contactId: number; kind: string; body: string }>;
  /** True once ANY store method has been called. */
  touched(): boolean;
}
function fakeStore(
  options: {
    contacts?: Array<Record<string, unknown>>;
    activities?: Array<Record<string, unknown>>;
    updateResult?: number | null;
    createResult?: number | null;
    archiveResult?: number | null;
    activityResult?: number | null;
    readThrows?: boolean;
  } = {},
): FakeCrmStore {
  const contactReads: number[] = [];
  const activityReads: Array<[number, number]> = [];
  const updates: FakeCrmStore["updates"] = [];
  const creates: FakeCrmStore["creates"] = [];
  const archives: FakeCrmStore["archives"] = [];
  const activityWrites: FakeCrmStore["activityWrites"] = [];
  return {
    contactReads,
    activityReads,
    updates,
    creates,
    archives,
    activityWrites,
    touched() {
      return (
        contactReads.length + activityReads.length + updates.length + creates.length +
        archives.length + activityWrites.length > 0
      );
    },
    async listContacts(userId) {
      contactReads.push(userId);
      if (options.readThrows) throw new Error("contacts read exploded");
      return options.contacts ?? PRESERVED_CONTACTS;
    },
    async listActivities(userId, contactId) {
      activityReads.push([userId, contactId]);
      return options.activities ?? CONTACT_ACTIVITIES;
    },
    async updateContact(userId, id, fields) {
      updates.push({ userId, id, fields });
      return options.updateResult === undefined ? id : options.updateResult;
    },
    async createContact(userId, limit, fields) {
      creates.push({ userId, limit, fields });
      return options.createResult === undefined ? 99 : options.createResult;
    },
    async archiveContact(userId, id) {
      archives.push({ userId, id });
      return options.archiveResult === undefined ? id : options.archiveResult;
    },
    async addActivity(userId, contactId, kind, body) {
      activityWrites.push({ userId, contactId, kind, body });
      return options.activityResult === undefined ? 41 : options.activityResult;
    },
  };
}

// ── The reminder seam (real pure builder over these rows) ─────────────────────
const PREFS: CrmReminderPrefsView = { opt_in: true, timezone: "America/New_York", stored: true };
const REMINDER_SOURCES = [
  { saved_match_id: 1, bid_id: 501, title: "Roof repair", follow_up_date: "2026-10-01", next_action: "Ask for the amendment" },
  { saved_match_id: 2, bid_id: 502, title: "Site survey", follow_up_date: "2026-10-20", next_action: "Chase the CO" },
];
interface FakeReminderDeps {
  loadPrefs: (userId: number) => Promise<CrmReminderPrefsView>;
  loadLists: (userId: number, timezone: string, now: Date) => Promise<ReminderLists>;
  savePrefs: (userId: number, input: { optIn: boolean; timezone: string }) => Promise<CrmReminderPrefsView>;
}
function fakeReminders(options: { prefs?: CrmReminderPrefsView | null; throws?: boolean } = {}) {
  const calls: { prefs: number[]; lists: Array<{ userId: number; timezone: string; now: Date }>; saves: Array<{ userId: number; input: { optIn: boolean; timezone: string } }> } = {
    prefs: [],
    lists: [],
    saves: [],
  };
  const deps: FakeReminderDeps = {
    async loadPrefs(userId) {
      calls.prefs.push(userId);
      if (options.throws) throw new Error("user_crm_prefs is not there");
      return options.prefs ?? PREFS;
    },
    async loadLists(userId, timezone, now) {
      calls.lists.push({ userId, timezone, now });
      return buildReminderLists(REMINDER_SOURCES, timezone, now);
    },
    async savePrefs(userId, input) {
      calls.saves.push({ userId, input });
      return { opt_in: input.optIn, timezone: input.timezone, stored: true };
    },
  };
  return { deps, calls };
}

// ── Handler construction ──────────────────────────────────────────────────────
interface BuildOptions {
  store: CrmContactsStore;
  account?: Account;
  authenticate?: (request: Request) => Promise<{ id: number; is_admin?: boolean } | null>;
  /** Overrides the ladder wiring (used for the unreadable-entitlement pin). */
  getAccess?: (user: { id: number; is_admin?: boolean }) => Promise<never>;
  reminders?: FakeReminderDeps | CrmRouteDepsReminders;
  generateDraft?: (user: unknown, body: unknown) => Promise<unknown>;
  now?: () => Date;
  authThrows?: boolean;
}
type CrmRouteDepsReminders = NonNullable<Parameters<typeof crmRouteHandlers>[0]["reminders"]>;

function buildRoute(options: BuildOptions) {
  const acct = options.account ?? account();
  // The REAL trial computation over the raw columns, then the REAL ladder.
  const trial = computeTrialStatus(
    acct.trialStartedAt,
    acct.planTier,
    acct.subscriptionStatus,
    acct.accessExpiresAt,
    acct.fullAccess,
  );
  const accessDeps: CrmAccessDeps = {
    async loadTrial() {
      return trial;
    },
    async loadSubscriptionStatus() {
      return acct.subscriptionStatus ?? null;
    },
  };
  return crmRouteHandlers({
    authenticate:
      options.authenticate ??
      (async () => {
        if (options.authThrows) throw new Error("session read exploded");
        return { id: USER, is_admin: acct.isAdmin ?? false };
      }),
    getAccess:
      options.getAccess ??
      ((user: { id: number; is_admin?: boolean }) => getCrmAccess(user, accessDeps)),
    store: options.store,
    ...(options.reminders ? { reminders: options.reminders as CrmRouteDepsReminders } : {}),
    ...(options.generateDraft
      ? { generateDraft: options.generateDraft as never }
      : {}),
    now: options.now ?? (() => NOW),
  });
}

type Handlers = ReturnType<typeof buildRoute>;
const get = (handlers: Handlers, query = "") =>
  handlers.GET({ request: new Request(`${ORIGIN}/api/crm${query}`) });
const post = (
  handlers: Handlers,
  body: unknown,
  options: { origin?: string | null } = {},
) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers.origin = origin;
  return handlers.POST({
    request: new Request(`${ORIGIN}/api/crm`, { method: "POST", headers, body: JSON.stringify(body) }),
  });
};

const PROFESSIONAL_ACCESS = {
  tier: "professional",
  canEdit: true,
  relationshipHistory: true,
  reminders: true,
  aiDrafts: true,
  contactLimit: 1000,
};
const STARTER_ACCESS = {
  tier: "starter",
  canEdit: true,
  relationshipHistory: false,
  reminders: false,
  aiDrafts: false,
  contactLimit: 100,
};
const BASIC_ACCESS = {
  tier: "basic",
  canEdit: false,
  relationshipHistory: false,
  reminders: false,
  aiDrafts: false,
  contactLimit: 0,
};

/** A valid saveContact body (deliberately padded, so the trims are observable). */
function contactBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: "saveContact",
    name: "  Dana Reyes  ",
    organization: "  Acme Federal  ",
    role: "  Contracting Officer  ",
    email: "dana@acme.test",
    phone: "  555-0100  ",
    notes: "  Ring her before the Q&A closes.  ",
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe("GET /api/crm — the SHIPPED handler, end to end (fake store, real ladder)", () => {
  test("an entitled Professional reads THEIR OWN contacts: 200, their rows, private no-store", async () => {
    const store = fakeStore();
    const res = await get(buildRoute({ store, account: PAYING_PROFESSIONAL }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.access).toEqual(PROFESSIONAL_ACCESS);
    expect(body.contacts).toEqual(PRESERVED_CONTACTS_JSON);
    // Owner-scoped: the store was asked for the CALLER's id and nothing else.
    expect(store.contactReads).toEqual([USER]);
  });

  test("a paying Starter reads its own contacts: canEdit true, the 100-contact cap", async () => {
    const store = fakeStore();
    const res = await get(buildRoute({ store, account: PAYING_STARTER }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.access).toEqual(STARTER_ACCESS);
    expect(body.contacts).toEqual(PRESERVED_CONTACTS_JSON);
  });

  test("the contacts read is NOT tier-gated: an account with no entitlement still reads its own rows as Basic", async () => {
    const store = fakeStore();
    const res = await get(buildRoute({ store, account: NEVER_ENTITLED }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // The tier decides what may happen NEXT (canEdit/limits) — never which rows exist.
    expect(body.access).toEqual(BASIC_ACCESS);
    expect(body.contacts).toEqual(PRESERVED_CONTACTS_JSON);
  });

  test("an anonymous GET is 401 and the store is never touched", async () => {
    const store = fakeStore();
    const handlers = buildRoute({ store, account: PAYING_PROFESSIONAL, authenticate: async () => null });
    const res = await get(handlers);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not authenticated" });
    expect(store.touched()).toBe(false);
  });

  test("the Professional-only read (relationship history) is GATED server-side for a Starter — 403, no activity read", async () => {
    const store = fakeStore();
    const res = await get(buildRoute({ store, account: PAYING_STARTER }), "?resource=history&contactId=11");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Professional plan required" });
    expect(store.activityReads).toEqual([]);
  });

  test("history for a Professional returns their own activities; a bad contactId is a 400 with no read", async () => {
    const store = fakeStore();
    const handlers = buildRoute({ store, account: PAYING_PROFESSIONAL });
    const ok = await get(handlers, "?resource=history&contactId=11");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      activities: [
        { id: 31, contact_id: 11, kind: "call", body: "Left a voicemail about the site visit.", created_at: "2026-10-08T15:00:00.000Z" },
      ],
    });
    expect(store.activityReads).toEqual([[USER, 11]]);

    for (const bad of ["0", "-1", "abc", ""]) {
      const res = await get(handlers, `?resource=history&contactId=${bad}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid contactId" });
    }
    expect(store.activityReads).toEqual([[USER, 11]]);
  });

  test("the reminders resource is refused for a Starter (403) — the panel is not merely hidden in the client", async () => {
    const store = fakeStore();
    const reminders = fakeReminders();
    const res = await get(buildRoute({ store, account: PAYING_STARTER, reminders: reminders.deps }), "?resource=reminders");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Professional plan required" });
    expect(reminders.calls.prefs).toEqual([]);
    expect(reminders.calls.lists).toEqual([]);
  });

  test("reminders for a Professional: the user's OWN prefs + both lists, classified by the real pure builder in their zone", async () => {
    const store = fakeStore();
    const reminders = fakeReminders();
    const res = await get(buildRoute({ store, account: PAYING_PROFESSIONAL, reminders: reminders.deps }), "?resource=reminders");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.access).toEqual(PROFESSIONAL_ACCESS);
    expect(body.prefs).toEqual(PREFS);
    // Read through the REAL builder: "2026-10-01" is overdue and "2026-10-20" upcoming
    // on the user's local day (injected clock), never on the server's.
    expect((body.overdue as unknown[]).length).toBe(1);
    expect((body.upcoming as unknown[]).length).toBe(1);
    expect(reminders.calls.prefs).toEqual([USER]);
    expect(reminders.calls.lists).toEqual([{ userId: USER, timezone: "America/New_York", now: NOW }]);
  });

  test("an un-migrated database answers 'Reminders unavailable' (500) without taking the other reads down", async () => {
    const store = fakeStore();
    const reminders = fakeReminders({ throws: true });
    const handlers = buildRoute({ store, account: PAYING_PROFESSIONAL, reminders: reminders.deps });
    const res = await get(handlers, "?resource=reminders");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Reminders unavailable" });
    // Migration 060's own try/catch is scoped: the contacts read still works.
    const contacts = await get(handlers);
    expect(contacts.status).toBe(200);
  });

  test("an unknown resource is 400 — never a silent fallback to contacts", async () => {
    const store = fakeStore();
    const res = await get(buildRoute({ store, account: PAYING_PROFESSIONAL }), "?resource=whatever");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown resource" });
    expect(store.touched()).toBe(false);
  });

  test("a store failure or an unreadable entitlement is a 500 — never a partial read", async () => {
    const exploding = fakeStore({ readThrows: true });
    const failed = await get(buildRoute({ store: exploding, account: PAYING_PROFESSIONAL }));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "CRM unavailable" });

    // Entitlement is read FIRST and fails CLOSED (fail-closed is not applied at the
    // ladder layer: the route turns a thrown read into a 500, never into "entitled").
    const store = fakeStore();
    const unreadable = buildRoute({
      store,
      account: PAYING_PROFESSIONAL,
      getAccess: async () => {
        throw new Error("users read exploded");
      },
    });
    const res = await get(unreadable);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "CRM unavailable" });
    expect(store.touched()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe("POST /api/crm — the SHIPPED handler, end to end (fake store, real ladder)", () => {
  test("the origin check runs FIRST: no Origin and a foreign Origin are both 403, before auth and before the store", async () => {
    const store = fakeStore();
    let authCalls = 0;
    const handlers = buildRoute({
      store,
      account: PAYING_PROFESSIONAL,
      authenticate: async () => {
        authCalls += 1;
        return { id: USER };
      },
    });
    for (const origin of [null, "https://evil.example"]) {
      const res = await post(handlers, contactBody(), { origin });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Forbidden" });
    }
    expect(authCalls).toBe(0);
    expect(store.touched()).toBe(false);
  });

  test("an anonymous same-origin POST is 401 and the store is never touched", async () => {
    const store = fakeStore();
    const handlers = buildRoute({ store, account: PAYING_PROFESSIONAL, authenticate: async () => null });
    const res = await post(handlers, contactBody());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not authenticated" });
    expect(store.touched()).toBe(false);
  });

  test("a Starter saves a contact: 201, the capped create's id, the trimmed fields, the tier's own limit", async () => {
    const store = fakeStore();
    const res = await post(buildRoute({ store, account: PAYING_STARTER }), contactBody());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 99 });
    expect(store.creates).toEqual([
      {
        userId: USER,
        limit: 100, // the LADDER's limit for Starter — never a client value
        fields: {
          name: "Dana Reyes",
          organization: "Acme Federal",
          role: "Contracting Officer",
          email: "dana@acme.test",
          phone: "555-0100",
          notes: "Ring her before the Q&A closes.",
        },
      },
    ]);
  });

  test("the cap's NULL (migration 059's crm_create_contact) is the route's 409, quoting the tier's limit", async () => {
    const store = fakeStore({ createResult: null });
    const res = await post(buildRoute({ store, account: PAYING_STARTER }), contactBody());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "contact_limit",
      message: "Your plan allows 100 contacts.",
    });
  });

  test("editing a contact that is not the caller's is the store's own 404 — never a write to someone else's row", async () => {
    const store = fakeStore({ updateResult: null });
    const res = await post(buildRoute({ store, account: PAYING_PROFESSIONAL }), contactBody({ id: 4242 }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Contact not found" });
    // The ownership predicate is the store's (`user_id = userId`); the route passes
    // the caller's own id and the requested row id, nothing else.
    expect(store.updates.map((u) => [u.userId, u.id])).toEqual([[USER, 4242]]);
  });

  test("editing an owned contact returns its id; archiving and logging an activity reach the store", async () => {
    const store = fakeStore();
    const handlers = buildRoute({ store, account: PAYING_PROFESSIONAL });
    const edited = await post(handlers, contactBody({ id: 11 }));
    expect(edited.status).toBe(200);
    expect(await edited.json()).toEqual({ id: 11 });

    const archived = await post(handlers, { action: "archiveContact", id: 11 });
    expect(archived.status).toBe(200);
    expect(await archived.json()).toEqual({ success: true });
    expect(store.archives).toEqual([{ userId: USER, id: 11 }]);

    const activity = await post(handlers, { action: "addActivity", contactId: 11, kind: "call", body: "  Left a voicemail.  " });
    expect(activity.status).toBe(201);
    expect(await activity.json()).toEqual({ id: 41 });
    expect(store.activityWrites).toEqual([
      { userId: USER, contactId: 11, kind: "call", body: "Left a voicemail." },
    ]);
  });

  test("logging an activity needs Professional (403 for Starter); an unknown kind or empty note is a 400 with no write", async () => {
    const store = fakeStore();
    const starter = await post(buildRoute({ store, account: PAYING_STARTER }), {
      action: "addActivity",
      contactId: 11,
      kind: "call",
      body: "nope",
    });
    expect(starter.status).toBe(403);
    expect(await starter.json()).toEqual({ error: "Professional plan required" });

    const pro = buildRoute({ store, account: PAYING_PROFESSIONAL });
    for (const bad of [
      { action: "addActivity", contactId: 11, kind: "text", body: "nope" },
      { action: "addActivity", contactId: 0, kind: "call", body: "nope" },
      { action: "addActivity", contactId: 11, kind: "call", body: "   " },
    ]) {
      const res = await post(pro, bad);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid activity" });
    }
    expect(store.activityWrites).toEqual([]);
  });

  test("the pre-existing 400s are unchanged: invalid contact / invalid email / unknown action", async () => {
    const store = fakeStore();
    const handlers = buildRoute({ store, account: PAYING_STARTER });
    const noName = await post(handlers, contactBody({ name: "   " }));
    expect(noName.status).toBe(400);
    expect(await noName.json()).toEqual({ error: "Invalid contact" });

    const badEmail = await post(handlers, contactBody({ email: "not-an-email" }));
    expect(badEmail.status).toBe(400);
    expect(await badEmail.json()).toEqual({ error: "Invalid contact email" });

    const unknown = await post(handlers, { action: "deleteEverything" });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "Unknown action" });
    expect(store.touched()).toBe(false);
  });

  test("the draft branch is resolved BEFORE the Starter gate: a Basic account's generateDraft reaches the draft dep", async () => {
    const store = fakeStore();
    const calls: unknown[] = [];
    const handlers = buildRoute({
      store,
      account: NEVER_ENTITLED, // canEdit === false
      generateDraft: async (user, body) => {
        calls.push([user, body]);
        return { ok: false, status: 403, error: CRM_DRAFT_PRO_REQUIRED };
      },
    });
    const res = await post(handlers, { action: "generateDraft", contactId: 11, instructions: "short" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: CRM_DRAFT_PRO_REQUIRED });
    // …and it reached the generator rather than the Starter gate's 403 sentence.
    expect(calls).toEqual([[{ id: USER, is_admin: false }, { action: "generateDraft", contactId: 11, instructions: "short" }]]);

    // A saveContact on the same account never touches the draft path.
    const save = await post(handlers, contactBody());
    expect(save.status).toBe(403);
    expect(await save.json()).toEqual({ error: "Starter plan required" });
    expect(calls.length).toBe(1);
    expect(store.touched()).toBe(false);
  });

  test("the draft outcome → response mapping: 200 + no-store, the outcome's own status/error + retry-after, and a thrown generator as a fail-closed 500", async () => {
    const store = fakeStore();
    const ok = await post(
      buildRoute({
        store,
        account: PAYING_PROFESSIONAL,
        generateDraft: async () => ({
          ok: true,
          status: 200,
          draft: { text: "Hi Dana,", contactId: 11, generatedAt: "2026-10-11T14:00:00.000Z" },
        }),
      }),
      { action: "generateDraft", contactId: 11 },
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(await ok.json()).toEqual({
      draft: { text: "Hi Dana,", contactId: 11, generatedAt: "2026-10-11T14:00:00.000Z" },
    });

    const limited = await post(
      buildRoute({
        store,
        account: PAYING_PROFESSIONAL,
        generateDraft: async () => ({ ok: false, status: 429, error: "Daily limit reached", retryAfterSec: 7200 }),
      }),
      { action: "generateDraft", contactId: 11 },
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("7200");
    expect(await limited.json()).toEqual({ error: "Daily limit reached" });

    // Nothing is ever drafted when the generator fails — a 500, never a partial draft.
    const exploded = await post(
      buildRoute({
        store,
        account: PAYING_PROFESSIONAL,
        generateDraft: async () => {
          throw new Error("model exploded");
        },
      }),
      { action: "generateDraft", contactId: 11 },
    );
    expect(exploded.status).toBe(500);
    expect(await exploded.json()).toEqual({ error: "Could not generate a draft. Please try again." });
    expect(store.touched()).toBe(false);
  });

  test("saveReminderPrefs uses the Professional gate (not canEdit): 403 for Starter, the 400s, and the write for a Professional", async () => {
    const store = fakeStore();
    const reminders = fakeReminders();
    const body = { action: "saveReminderPrefs", opt_in: true, timezone: "America/New_York" };

    const starter = await post(buildRoute({ store, account: PAYING_STARTER, reminders: reminders.deps }), body);
    expect(starter.status).toBe(403);
    expect(await starter.json()).toEqual({ error: "Professional plan required" });
    expect(reminders.calls.saves).toEqual([]);

    const pro = buildRoute({ store, account: PAYING_PROFESSIONAL, reminders: reminders.deps });
    const notBoolean = await post(pro, { ...body, opt_in: "true" });
    expect(notBoolean.status).toBe(400);
    expect(await notBoolean.json()).toEqual({ error: "Invalid reminder preference" });
    const badZone = await post(pro, { ...body, timezone: "Mars/Olympus" });
    expect(badZone.status).toBe(400);
    expect(await badZone.json()).toEqual({ error: "Invalid timezone" });

    const saved = await post(pro, body);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ prefs: { opt_in: true, timezone: "America/New_York", stored: true } });
    expect(reminders.calls.saves).toEqual([{ userId: USER, input: { optIn: true, timezone: "America/New_York" } }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// THE OWNER'S DOWNGRADE POLICY, PINNED BY NAME.
// Ratified tier table: a lapsed Professional keeps its data, keeps READING it, and
// loses only the ability to write (and the Professional-only reads). Nothing in the
// CRM deletes on a tier change — the read is keyed to user_id, never to a tier.
// ═══════════════════════════════════════════════════════════════════════════════
describe("downgrade policy — READ SURVIVES DOWNGRADE, EDITS ARE GATED AFTER DOWNGRADE", () => {
  test("READ SURVIVES DOWNGRADE — a lapsed Professional still reads its preserved contacts through GET /api/crm", async () => {
    // 30-day-old trial columns + a stored 'professional' plan_tier: the REAL ladder
    // says basic (expired outranks the stored tier), and the REAL handler still
    // returns every row the account owns.
    const store = fakeStore();
    const res = await get(buildRoute({ store, account: LAPSED_PROFESSIONAL }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.access).toEqual(BASIC_ACCESS);
    expect(body.contacts).toEqual(PRESERVED_CONTACTS_JSON);
    expect(store.contactReads).toEqual([USER]);
  });

  test("EDITS ARE GATED AFTER DOWNGRADE — every write is refused 403 by the server and NOTHING is written", async () => {
    const store = fakeStore();
    const reminders = fakeReminders();
    const handlers = buildRoute({ store, account: LAPSED_PROFESSIONAL, reminders: reminders.deps });

    const save = await post(handlers, contactBody());
    expect(save.status).toBe(403);
    expect(await save.json()).toEqual({ error: "Starter plan required" });

    for (const action of [
      { action: "archiveContact", id: 11 },
      { action: "addActivity", contactId: 11, kind: "call", body: "hi" },
      { action: "saveReminderPrefs", opt_in: true, timezone: "America/New_York" },
      { action: "generateDraft", contactId: 11 },
    ]) {
      const res = await post(handlers, action);
      expect(res.status).toBe(403);
    }
    // The edited row is STILL THERE: no gate, and no failed write, touched a row.
    expect(store.touched()).toBe(false);
    expect(reminders.calls.saves).toEqual([]);
    const after = await get(handlers);
    expect(((await after.json()) as Record<string, unknown>).contacts).toEqual(PRESERVED_CONTACTS_JSON);
  });

  test("the Professional-ONLY reads stay gated after the downgrade, while the rows they read are preserved", async () => {
    const store = fakeStore();
    const reminders = fakeReminders();
    const handlers = buildRoute({ store, account: LAPSED_PROFESSIONAL, reminders: reminders.deps });

    // The relationship history of a contact the account still owns: 403 by policy
    // (it is a Professional feature), NOT a 404 — the rows were never deleted.
    const history = await get(handlers, "?resource=history&contactId=11");
    expect(history.status).toBe(403);
    expect(await history.json()).toEqual({ error: "Professional plan required" });
    const reminderRead = await get(handlers, "?resource=reminders");
    expect(reminderRead.status).toBe(403);
    expect(store.activityReads).toEqual([]);
    expect(reminders.calls.prefs).toEqual([]);

    // …and the contact the history belongs to is still listed, un-archived.
    const contacts = await get(handlers);
    expect(((await contacts.json()) as Record<string, unknown>).contacts).toEqual(PRESERVED_CONTACTS_JSON);
  });

  test("a downgrade deletes nothing: the store hands back EVERY preserved row, keyed to the caller's own id", async () => {
    const store = fakeStore({ contacts: PRESERVED_CONTACTS });
    const handlers = buildRoute({ store, account: LAPSED_PROFESSIONAL });
    // Read twice — the downgraded read is repeatable and never a one-shot recovery.
    for (let i = 0; i < 2; i++) {
      const res = await get(handlers);
      expect(res.status).toBe(200);
      expect(((await res.json()) as Record<string, unknown>).contacts).toEqual(PRESERVED_CONTACTS_JSON);
    }
    // Every read asked for the caller's own user id; no read is scoped to a tier, and
    // no store method that could remove a row was reached.
    expect(store.contactReads).toEqual([USER, USER]);
    expect(store.archives).toEqual([]);
    expect(store.updates).toEqual([]);
    expect(store.creates).toEqual([]);
    expect(store.activityWrites).toEqual([]);
  });
});
