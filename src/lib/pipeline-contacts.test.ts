/**
 * PIPELINE CONTACTS / SAVED-BID LINKING — CRM phase 2 (owner handoff 2026-10-10,
 * remaining-work items 1–3).
 *
 * This suite pins three things, all with ZERO database and ZERO network:
 *
 *   1. THE LINK RULES at the route boundary — POST /api/pipeline-workspace's
 *      `crm_contact_id` must accept an owned, non-archived contact; REJECT another
 *      user's contact (404) and an archived one (400); and treat null/absent as an
 *      unlink that requires no contact at all. The route is driven through its
 *      injectable `deps` seam (`pipelineWorkspaceHandler({ store, authenticate })`),
 *      so nothing is mocked process-globally: bun's `mock.module` registry is never
 *      un-registered and leaks across test files in one run (the pathology
 *      documented in src/routes/api/subcontracts/primes.ts and
 *      src/lib/subcontracts/read.test.ts).
 *   2. THE UNTOUCHED VALIDATION — every pre-phase-2 rule (the five pursuit
 *      statuses, the field bounds, the email shape, the strict YYYY-MM-DD
 *      round-trip, the trims) still answers exactly what it answered before, and
 *      answers it BEFORE the store is touched.
 *   3. THE JOIN SHAPE of GET /api/my-pipeline — the linked contact is surfaced
 *      from the LEFT JOIN's `crm_contact_*` columns, an unlinked bid keeps its
 *      nulls, and the query can never leak another user's contact (the join is
 *      keyed on `id AND user_id`, and the row scope is `sm.user_id`): pinned both
 *      on the mapper's output and on the statement's own source text.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CRM_CONTACT_ARCHIVED,
  CRM_CONTACT_INVALID,
  CRM_CONTACT_NOT_FOUND,
  crmContactLink,
  parseCrmContactId,
  type CrmAccessView,
} from "./pipeline-contacts";
import { computeCrmAccess } from "./crm-access.server";
import type {
  OwnedContactLookup,
  PipelineWorkspaceStore,
  SavedBidUpdateInput,
} from "./pipeline-workspace.server";

// ── A fake store: records what the route asked for, never touches a database ──
interface FakeStore extends PipelineWorkspaceStore {
  /** Every `findOwnedContact` call, in order: [userId, contactId]. */
  reads: Array<[number, number]>;
  /** Every update the route attempted, in order. */
  writes: SavedBidUpdateInput[];
}

function fakeStore(options: {
  contact?: OwnedContactLookup | null;
  contactThrows?: boolean;
  updateThrows?: boolean;
  savedBidMissing?: boolean;
} = {}): FakeStore {
  const reads: Array<[number, number]> = [];
  const writes: SavedBidUpdateInput[] = [];
  return {
    reads,
    writes,
    async findOwnedContact(userId, contactId) {
      reads.push([userId, contactId]);
      if (options.contactThrows) throw new Error("contact read exploded");
      return options.contact ?? null;
    },
    async updateSavedBid(input) {
      writes.push(input);
      if (options.updateThrows) throw new Error("update exploded");
      if (options.savedBidMissing) return null;
      // The row a real RETURNING would hand back, including the new link column.
      return {
        bid_id: input.bidId,
        pursuit_status: input.pursuitStatus,
        notes: input.notes,
        next_action: input.nextAction,
        follow_up_date: input.followUpDate,
        contact_name: input.contactName,
        contact_organization: input.contactOrganization,
        contact_role: input.contactRole,
        contact_email: input.contactEmail,
        crm_contact_id: input.crmContactId,
      };
    },
  };
}

const USER = 7;
const ORIGIN = "https://www.contrax.company";

const { pipelineWorkspaceHandler } = await import("~/routes/api/pipeline-workspace");

/** Calls POST /api/pipeline-workspace on a handler built around `store`. */
async function post(
  store: PipelineWorkspaceStore,
  body: unknown,
  options: { user?: { id: number } | null } = {},
) {
  const handler = pipelineWorkspaceHandler({
    store,
    authenticate: async () => (options.user === undefined ? { id: USER } : options.user),
  });
  return handler({
    request: new Request(`${ORIGIN}/api/pipeline-workspace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}

/** A body that passes every shipped validation rule (values deliberately padded). */
function validBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bid_id: 42,
    pursuit_status: "evaluating",
    notes: "  Ring the CO on Tuesday.  ",
    next_action: "  Call Dana  ",
    follow_up_date: "2026-11-03",
    contact_name: "  Dana Reyes  ",
    contact_organization: "  Acme Federal  ",
    contact_role: "  Contracting Officer  ",
    // NOT padded on purpose: the shipped route validates the email UNTRIMMED
    // (only the accepted value is trimmed, in the UPDATE). See the pin below.
    contact_email: "dana@acme.test",
    ...over,
  };
}

describe("parseCrmContactId — the link's shape, before any query", () => {
  test("absent, null and the empty-select value all mean UNLINK (no contact required)", () => {
    for (const raw of [undefined, null, ""]) {
      expect(parseCrmContactId(raw)).toEqual({ ok: true, value: null });
    }
  });
  test("a positive safe integer is the contact id", () => {
    expect(parseCrmContactId(1)).toEqual({ ok: true, value: 1 });
    expect(parseCrmContactId(987654)).toEqual({ ok: true, value: 987654 });
  });
  test("anything else is a hard 400 — never a silent coerce", () => {
    // 0 and negatives are not ids; a float, a numeric STRING and junk are not ids
    // either, and none of them may be rounded, parsed or ignored.
    for (const raw of [0, -1, 1.5, "5", "abc", true, [], {}, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      const parsed = parseCrmContactId(raw);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toBe(CRM_CONTACT_INVALID);
    }
  });
});

describe("crmContactLink — the /api/my-pipeline join shape", () => {
  test("a linked bid surfaces the contact's id, name and organization", () => {
    expect(
      crmContactLink({
        bid_id: 42,
        crm_contact_id: 5,
        crm_contact_name: "Dana Reyes",
        crm_contact_organization: "Acme Federal",
      }),
    ).toEqual({ id: 5, name: "Dana Reyes", organization: "Acme Federal" });
  });
  test("an UNLINKED bid has no contact — a null id is never turned into a person", () => {
    // The LEFT JOIN hands back NULL for every crm_contact_* column; the mapper must
    // not fall back to the pre-existing contact_name block (migration-059 rule).
    expect(
      crmContactLink({
        bid_id: 43,
        crm_contact_id: null,
        crm_contact_name: null,
        crm_contact_organization: null,
        contact_name: "Free text contact that must NOT become a CRM link",
      }),
    ).toBeNull();
  });
  test("a missing id column (an environment without migration 059) is treated as unlinked", () => {
    expect(crmContactLink({ bid_id: 44 })).toBeNull();
    expect(crmContactLink({ bid_id: 44, crm_contact_id: undefined })).toBeNull();
  });
  test("a blank organization is an empty string, never a fabricated value", () => {
    expect(crmContactLink({ crm_contact_id: 9, crm_contact_name: "Solo", crm_contact_organization: null })).toEqual({
      id: 9,
      name: "Solo",
      organization: "",
    });
  });
});

describe("POST /api/pipeline-workspace — the linked contact", () => {
  test("an owned, non-archived contact is accepted and written with the fields that own it", async () => {
    const store = fakeStore({ contact: { id: 5, archived: false } });
    const res = await post(store, validBody({ crm_contact_id: 5 }));
    expect(res.status).toBe(200);
    // The ownership read is scoped to the caller.
    expect(store.reads).toEqual([[USER, 5]]);
    expect(store.writes).toHaveLength(1);
    const write = store.writes[0]!;
    expect(write.crmContactId).toBe(5);
    expect(write.userId).toBe(USER);
    expect(write.bidId).toBe(42);
    // Every shipped trim is still applied — byte for byte.
    expect(write.notes).toBe("Ring the CO on Tuesday.");
    expect(write.nextAction).toBe("Call Dana");
    expect(write.contactName).toBe("Dana Reyes");
    expect(write.contactOrganization).toBe("Acme Federal");
    expect(write.contactRole).toBe("Contracting Officer");
    expect(write.contactEmail).toBe("dana@acme.test");
    expect(write.followUpDate).toBe("2026-11-03");
    expect(write.pursuitStatus).toBe("evaluating");
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.crm_contact_id).toBe(5);
    expect(body.data.bid_id).toBe(42);
  });

  test("another user's contact is REJECTED (404) and nothing is written", async () => {
    // The store returns null exactly as the owner-scoped SELECT would for a row
    // that exists but belongs to someone else.
    const store = fakeStore({ contact: null });
    const res = await post(store, validBody({ crm_contact_id: 5 }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: CRM_CONTACT_NOT_FOUND });
    expect(store.writes).toHaveLength(0);
  });

  test("an archived contact is REJECTED (400) with its own message, not the FK's", async () => {
    const store = fakeStore({ contact: { id: 5, archived: true } });
    const res = await post(store, validBody({ crm_contact_id: 5 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: CRM_CONTACT_ARCHIVED });
    expect(store.writes).toHaveLength(0);
    // The two failures are distinguishable, which the composite FK alone cannot do.
    expect(CRM_CONTACT_ARCHIVED).not.toBe(CRM_CONTACT_NOT_FOUND);
  });

  test("null unlinks — no contact is read, and the write carries NULL", async () => {
    const store = fakeStore();
    const res = await post(store, validBody({ crm_contact_id: null }));
    expect(res.status).toBe(200);
    expect(store.reads).toHaveLength(0);
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]!.crmContactId).toBeNull();
  });

  test("an ABSENT crm_contact_id unlinks too (the pre-phase-2 client shape)", async () => {
    const store = fakeStore();
    const res = await post(store, validBody());
    expect(res.status).toBe(200);
    expect(store.reads).toHaveLength(0);
    expect(store.writes[0]!.crmContactId).toBeNull();
    expect(((await res.json()) as { data: Record<string, unknown> }).data.crm_contact_id).toBeNull();
  });

  test("a malformed crm_contact_id is a 400 that never reaches the store", async () => {
    for (const bad of ["abc", 0, -3, 2.5]) {
      const store = fakeStore({ contact: { id: 5, archived: false } });
      const res = await post(store, validBody({ crm_contact_id: bad }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: CRM_CONTACT_INVALID });
      expect(store.reads).toHaveLength(0);
      expect(store.writes).toHaveLength(0);
    }
  });

  test("unauthenticated → 401, and the store is never touched", async () => {
    const store = fakeStore({ contact: { id: 5, archived: false } });
    const res = await post(store, validBody({ crm_contact_id: 5 }), { user: null });
    expect(res.status).toBe(401);
    expect(store.reads).toHaveLength(0);
    expect(store.writes).toHaveLength(0);
  });

  test("a saved bid that is not the caller's (or is not saved) still 404s", async () => {
    const store = fakeStore({ contact: { id: 5, archived: false }, savedBidMissing: true });
    const res = await post(store, validBody({ crm_contact_id: 5 }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Saved bid not found" });
  });

  test("a store failure is a 500 with the shipped message, never a false success", async () => {
    const contactStore = fakeStore({ contactThrows: true });
    const contactRes = await post(contactStore, validBody({ crm_contact_id: 5 }));
    expect(contactRes.status).toBe(500);
    expect(await contactRes.json()).toEqual({ error: "Could not save bid details" });

    const updateStore = fakeStore({ updateThrows: true });
    const updateRes = await post(updateStore, validBody());
    expect(updateRes.status).toBe(500);
    expect(await updateRes.json()).toEqual({ error: "Could not save bid details" });
  });
});

describe("POST /api/pipeline-workspace — the pre-phase-2 validation is untouched", () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["an unknown pursuit status", { pursuit_status: "negotiating" }, "Invalid bid or pursuit status"],
    ["a non-integer bid id", { bid_id: "42" }, "Invalid bid or pursuit status"],
    ["a zero bid id", { bid_id: 0 }, "Invalid bid or pursuit status"],
    ["a missing notes field", { notes: undefined }, "Invalid notes"],
    ["notes over 5,000 characters", { notes: "x".repeat(5001) }, "Invalid notes"],
    ["a next_action over 300 characters", { next_action: "x".repeat(301) }, "Invalid next_action"],
    ["a contact_name that is not a string", { contact_name: 12 }, "Invalid contact_name"],
    ["a malformed contact email", { contact_email: "dana(at)acme.test" }, "Invalid contact email"],
    ["a follow-up date that is not a real calendar day", { follow_up_date: "2026-02-30" }, "Invalid follow-up date"],
    ["a follow-up date in the wrong shape", { follow_up_date: "03/11/2026" }, "Invalid follow-up date"],
  ];
  for (const [label, over, expected] of cases) {
    test(`${label} → 400 "${expected}" before the store is touched`, async () => {
      const store = fakeStore({ contact: { id: 5, archived: false } });
      const res = await post(store, validBody({ ...over, crm_contact_id: 5 }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: expected });
      expect(store.reads).toHaveLength(0);
      expect(store.writes).toHaveLength(0);
    });
  }
  test("an empty follow_up_date (null) is still accepted", async () => {
    const store = fakeStore();
    const res = await post(store, validBody({ follow_up_date: null }));
    expect(res.status).toBe(200);
    expect(store.writes[0]!.followUpDate).toBeNull();
  });
  test("the SHIPPED untrimmed-email rule is untouched: a padded email is still rejected", async () => {
    // The route validates `body.contact_email` before the UPDATE trims it, so a
    // padded address fails the shape check exactly as it did before phase 2. Pin it
    // so nobody "improves" this while adding the contact link.
    const store = fakeStore();
    const res = await post(store, validBody({ contact_email: "  dana@acme.test  " }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid contact email" });
    expect(store.writes).toHaveLength(0);
  });
  test("a non-object body is a 400", async () => {
    const store = fakeStore();
    const res = await post(store, [1, 2, 3]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
  });
});

// ── The my-pipeline statement itself: the source text is the pin ─────────────
describe("GET /api/my-pipeline — the join cannot leak another user's contact", () => {
  const source = readFileSync(new URL("../routes/api/my-pipeline.ts", import.meta.url), "utf8");
  /** The statement text, whitespace-normalised (comments dropped by the regex keys). */
  const flat = source.replace(/\s+/g, " ");

  test("the linked contact comes from a LEFT JOIN, so unlinked bids still return", () => {
    expect(flat).toContain("LEFT JOIN crm_contacts c ON c.id = sm.crm_contact_id AND c.user_id = sm.user_id");
  });
  test("the join is keyed on the contact's id AND its owner — never the bare id", () => {
    // Bare `c.id = sm.crm_contact_id` would surface another user's contact if a row
    // were ever mis-keyed; the composite key makes that impossible in the query.
    expect(flat).toContain("c.user_id = sm.user_id");
  });
  test("every row is still scoped to the caller's own saved matches", () => {
    expect(flat).toContain("WHERE sm.user_id = ${user.id} AND sm.status = 'saved'");
  });
  test("the contact's name/organization are selected with the crm_contact_ prefix", () => {
    expect(flat).toContain("c.name AS crm_contact_name, c.organization AS crm_contact_organization");
    expect(flat).toContain("sm.crm_contact_id,");
  });
  test("the response maps the link through the shared mapper (one wire shape)", () => {
    expect(flat).toContain("crm_contact: crmContactLink(r)");
  });
  test("the pre-phase-2 fields are still selected, unchanged", () => {
    for (const fragment of [
      "sm.pursuit_status, sm.next_action, sm.follow_up_date",
      "sm.contact_name, sm.contact_organization, sm.contact_role, sm.contact_email",
      "b.title, b.agency, b.estimated_value, b.due_date, b.location",
    ]) {
      expect(flat).toContain(fragment);
    }
  });
});

// ── The client view must keep matching the server's access payload ───────────
describe("the client's access view cannot drift from the phase-1 payload", () => {
  test("computeCrmAccess()'s keys are exactly the CrmAccessView keys", () => {
    const access = computeCrmAccess(
      { active: true, expired: false, planTier: "professional", fullAccess: false },
      "active",
    );
    const serverKeys = Object.keys(access).sort();
    // Type-level pin in one direction: the real payload must satisfy the view the
    // UI reads. A phase-3 change to crm-access.server.ts that adds or renames a key
    // fails HERE instead of silently rendering a stale gate.
    const view: CrmAccessView = access;
    expect(Object.keys(view).sort()).toEqual(serverKeys);
    expect(serverKeys).toEqual([
      "aiDrafts",
      "canEdit",
      "contactLimit",
      "relationshipHistory",
      "reminders",
      "tier",
    ]);
  });
  test("the access view carries the real numbers a contacts panel shows", () => {
    const pro = computeCrmAccess(
      { active: true, expired: false, planTier: "professional", fullAccess: false },
      "active",
    );
    const view: CrmAccessView = pro;
    expect(view.contactLimit).toBe(1000);
    expect(view.canEdit).toBe(true);
    const basic = computeCrmAccess(
      { active: false, expired: false, planTier: "basic", fullAccess: false },
      null,
    );
    const basicView: CrmAccessView = basic;
    expect(basicView.canEdit).toBe(false);
    expect(basicView.contactLimit).toBe(0);
  });
});
