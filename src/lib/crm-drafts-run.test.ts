/**
 * CRM AI FOLLOW-UP DRAFTS — the SEAM suite (phase 3b).
 *
 * DETERMINISTIC, NETWORK-FREE and DATABASE-FREE by construction: the algorithm
 * under test (src/lib/crm-drafts-run.ts) imports nothing but the pure rules, and
 * every dependency is INJECTED — an entitlement literal, an in-memory read-only
 * store, a limit literal, a scripted generator, a fixed clock. No `mock.module`
 * anywhere (bun's mock registry is process-global and leaks across files in one run
 * — skill contrax-bun-mock-module-leak).
 *
 * WHAT IS PINNED, in order of how much damage getting it wrong would do:
 *   1. THE PROFESSIONAL GATE IS FIRST AND SERVER-SIDE: a Starter/Basic/unknown
 *      account gets a 403, spends no unit, and reads NOTHING — no contact lookup,
 *      no history, no model call. An UNREADABLE entitlement propagates (fail-closed
 *      — the route turns it into a 500), it is never treated as entitled.
 *   2. OWNERSHIP BEFORE HISTORY: another user's contact id (and an archived one) is
 *      a 404 with NO history read at all, so a forged id can leak nothing.
 *   3. DRAFTS ONLY, STRUCTURALLY: the store interface has read methods only; no
 *      activity is created, no mail is sent, and nothing is persisted. The
 *      production half is pinned to contain no write statement for this feature.
 *   4. THE EXISTING USAGE CAP IS ENFORCED BEFORE GENERATION: over the cap is a 429
 *      with a retry-after and the honest sentence, and NO model call happens.
 *   5. A FAILED OR EMPTY MODEL ANSWER IS A 502, never a partial/blank draft.
 *   6. THE PRODUCTION WIRING IS THE HOUSE MECHANISM: the REAL `getCrmAccess()`, the
 *      pre-existing `checkRateLimit()` (no new table, no migration) and the shared
 *      `callAI()` helper — pinned against the shipped source, the same technique
 *      src/lib/radar-scan-diagnostics.test.ts uses.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CRM_DRAFT_CONTACT_NOT_FOUND,
  CRM_DRAFT_FAILED_MESSAGE,
  CRM_DRAFT_INVALID_MESSAGE,
  CRM_DRAFT_LIMIT_MESSAGE,
  CRM_DRAFT_MAX_PER_DAY,
  CRM_DRAFT_PRO_REQUIRED,
  buildCrmDraftPrompt,
  type CrmDraftActivity,
  type CrmDraftContact,
  type CrmDraftMessages,
} from "./crm-drafts";
import {
  runCrmDraft,
  type CrmDraftDeps,
  type CrmDraftEntitlement,
  type CrmDraftOutcome,
} from "./crm-drafts-run";

const REPO_SRC = join(import.meta.dir, "..");
const SERVER_MODULE = readFileSync(join(REPO_SRC, "lib", "crm-drafts.server.ts"), "utf8");
const RUN_MODULE_RAW = readFileSync(join(REPO_SRC, "lib", "crm-drafts-run.ts"), "utf8");
const CRM_ROUTE = readFileSync(join(REPO_SRC, "routes", "api", "crm.ts"), "utf8");
const CONTACTS_PANEL = readFileSync(join(REPO_SRC, "components", "PipelineContacts.tsx"), "utf8");
/**
 * Removes comments, so a "no write statement" pin cannot be satisfied or broken by
 * prose. (The source-pin tests below read CODE, not documentation.)
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const SERVER_CODE = stripComments(SERVER_MODULE);
const RUN_CODE = stripComments(RUN_MODULE_RAW);
const PANEL_CODE = stripComments(CONTACTS_PANEL);

const CONTACT: CrmDraftContact = {
  id: 41,
  name: "Dana Whitfield",
  organization: "Whitfield Facilities Group",
  role: "Contracting officer",
  notes: "Prefers a call before any site visit.",
};
const ACTIVITY: CrmDraftActivity = {
  kind: "email",
  body: "Sent the capability statement.",
  created_at: "2026-10-01T09:00:00.000Z",
};
const FIXED_NOW = new Date("2026-10-11T12:00:00.000Z");
const DRAFT_TEXT = "Hi Dana,\n\nFollowing up on the janitorial scope.\n\nThanks,\n[your name]";

/** Records every call, so a test can prove a step did NOT happen. */
interface Harness {
  deps: CrmDraftDeps;
  calls: {
    entitlement: number;
    loadContact: Array<[number, number]>;
    listActivities: Array<[number, number]>;
    limit: number[];
    generate: CrmDraftMessages[];
  };
}

function harness(options: {
  /** `null` = the entitlement read throws (unreadable). */
  access?: { tier: string; aiDrafts: boolean } | null;
  /** Contacts that exist, keyed `userId:contactId` — everything else is absent. */
  contacts?: Record<string, CrmDraftContact>;
  activities?: CrmDraftActivity[];
  allowed?: boolean;
  retryAfterSec?: number | null;
  answer?: string | (() => Promise<string>);
} = {}): Harness {
  const calls: Harness["calls"] = {
    entitlement: 0,
    loadContact: [],
    listActivities: [],
    limit: [],
    generate: [],
  };
  const contacts = options.contacts ?? { "7:41": CONTACT };
  const deps: CrmDraftDeps = {
    entitlement: {
      async check(): Promise<CrmDraftEntitlement> {
        calls.entitlement += 1;
        if (options.access === null) throw new Error("trial table unreadable");
        return { access: options.access ?? { tier: "professional", aiDrafts: true } };
      },
    },
    store: {
      // READ-ONLY by construction: there is no write method to call, which is how
      // "drafts only — never auto-send" is enforced rather than remembered.
      async loadContact(userId, contactId) {
        calls.loadContact.push([userId, contactId]);
        return contacts[`${userId}:${contactId}`] ?? null;
      },
      async listActivities(userId, contactId) {
        calls.listActivities.push([userId, contactId]);
        return options.activities ?? [ACTIVITY];
      },
    },
    limit: {
      async check(userId) {
        calls.limit.push(userId);
        return { allowed: options.allowed ?? true, retryAfterSec: options.retryAfterSec ?? null };
      },
    },
    generate: {
      async generate(messages) {
        calls.generate.push(messages);
        const answer = options.answer ?? DRAFT_TEXT;
        return typeof answer === "function" ? answer() : answer;
      },
    },
    now: () => FIXED_NOW,
  };
  return { deps, calls };
}

function request(contactId: unknown = 41, instructions?: unknown) {
  return { user: { id: 7, is_admin: false }, contactId, instructions };
}

describe("the Professional gate (aiDrafts) comes first", () => {
  test("a Professional account gets a draft, built from its own history", async () => {
    const h = harness();
    const outcome = await runCrmDraft(h.deps, request(41, "Ask about bonding."));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.status).toBe(200);
    expect(outcome.draft).toEqual({
      text: DRAFT_TEXT,
      contactId: 41,
      generatedAt: "2026-10-11T12:00:00.000Z",
    });
    // The model got EXACTLY the pure builder's messages — not a re-implementation.
    expect(h.calls.generate).toEqual([
      buildCrmDraftPrompt({ contact: CONTACT, activities: [ACTIVITY], instructions: "Ask about bonding." }),
    ]);
    expect(h.calls.loadContact).toEqual([[7, 41]]);
    expect(h.calls.listActivities).toEqual([[7, 41]]);
    expect(h.calls.limit).toEqual([7]);
  });

  test("an admin's internal bypass still arrives through the entitlement seam", async () => {
    const h = harness({ access: { tier: "professional", aiDrafts: true }, contacts: { "3:41": CONTACT } });
    const outcome = await runCrmDraft(h.deps, { user: { id: 3, is_admin: true }, contactId: 41 });
    expect(outcome.ok).toBe(true);
    expect(h.calls.loadContact).toEqual([[3, 41]]);
  });

  test("Starter (canEdit, no aiDrafts) is refused with the house 403 — and reads nothing", async () => {
    const h = harness({ access: { tier: "starter", aiDrafts: false } });
    const outcome = await runCrmDraft(h.deps, request());
    expect(outcome).toEqual({ ok: false, status: 403, error: CRM_DRAFT_PRO_REQUIRED });
    expect(h.calls.loadContact).toEqual([]);
    expect(h.calls.listActivities).toEqual([]);
    expect(h.calls.limit).toEqual([]);
    expect(h.calls.generate).toEqual([]);
  });

  test("a Basic account is refused too (no canEdit shortcut here)", async () => {
    const h = harness({ access: { tier: "basic", aiDrafts: false } });
    const outcome = await runCrmDraft(h.deps, request());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(403);
  });

  test("an entitlement object that resolves without an access reads is NOT entitled", async () => {
    const h = harness();
    h.deps.entitlement.check = async () => ({ access: undefined }) as unknown as CrmDraftEntitlement;
    const outcome = await runCrmDraft(h.deps, request());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(403);
  });

  test("an UNREADABLE entitlement propagates — fail-closed, never a draft", async () => {
    const h = harness({ access: null });
    await expect(runCrmDraft(h.deps, request())).rejects.toThrow("trial table unreadable");
    expect(h.calls.generate).toEqual([]);
    expect(h.calls.loadContact).toEqual([]);
  });

  test("an unreadable entitlement reaches the route as a 500, not a 403 (source pin)", () => {
    // The route wraps the whole draft branch: the seam's throw becomes an honest
    // 500 with no draft, which is what FAIL-CLOSED means at the HTTP boundary.
    expect(CRM_ROUTE).toContain("Could not generate a draft. Please try again.");
    expect(CRM_ROUTE).toContain("status: 500");
  });
});

describe("the request shape", () => {
  test("only a positive integer contact id is accepted", async () => {
    for (const bad of [0, -3, 2.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2, "41", null, undefined, {}, []]) {
      const h = harness();
      // The literal object (NOT the helper's default) so `undefined` is really sent.
      const outcome = await runCrmDraft(h.deps, { user: { id: 7, is_admin: false }, contactId: bad });
      expect({ input: bad, outcome }).toEqual({
        input: bad,
        outcome: { ok: false, status: 400, error: CRM_DRAFT_INVALID_MESSAGE },
      });
      expect(h.calls.loadContact).toEqual([]);
      expect(h.calls.generate).toEqual([]);
    }
  });

  test("an unacceptable instruction is a 400 — never silently dropped", async () => {
    for (const bad of [7, { text: "hi" }, ["hi"], "x".repeat(501)]) {
      const h = harness();
      const outcome = await runCrmDraft(h.deps, request(41, bad));
      expect({ input: bad, outcome }).toEqual({
        input: bad,
        outcome: { ok: false, status: 400, error: CRM_DRAFT_INVALID_MESSAGE },
      });
      expect(h.calls.generate).toEqual([]);
    }
  });

  test("an absent instruction is a valid request with no instruction block", async () => {
    const h = harness();
    const outcome = await runCrmDraft(h.deps, request(41));
    expect(outcome.ok).toBe(true);
    expect(h.calls.generate[0]!.user).not.toContain("WHAT THE SENDER WANTS");
  });
});

describe("ownership: no cross-user read, ever", () => {
  test("another user's contact id is a 404 and no history is loaded for it", async () => {
    // The store only knows user 7's contact 41 (the default fixture); user 8 asks
    // for the same id and gets nothing, because the read is scoped by owner.
    const h = harness();
    const outcome = await runCrmDraft(h.deps, { user: { id: 8, is_admin: false }, contactId: 41 });
    expect(outcome).toEqual({ ok: false, status: 404, error: CRM_DRAFT_CONTACT_NOT_FOUND });
    expect(h.calls.loadContact).toEqual([[8, 41]]);
    expect(h.calls.listActivities).toEqual([]);
    expect(h.calls.generate).toEqual([]);
  });

  test("a foreign id is asked for as THIS user's contact (the scope is in the call)", async () => {
    const h = harness({ contacts: { "7:41": CONTACT } });
    await runCrmDraft(h.deps, request(99));
    expect(h.calls.loadContact).toEqual([[7, 99]]);
  });

  test("an archived contact is simply absent → 404 (the SQL excludes it)", async () => {
    const h = harness({ contacts: {} });
    const outcome = await runCrmDraft(h.deps, request(41));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(404);
    expect(CRM_DRAFT_CONTACT_NOT_FOUND).toBe("That contact was not found in your contacts.");
  });

  test("ownership is decided BEFORE the usage cap is spent", async () => {
    const h = harness({ contacts: {} });
    await runCrmDraft(h.deps, request(41));
    expect(h.calls.limit).toEqual([]);
  });

  test("the production store scopes BOTH reads by the caller (source pin)", () => {
    // Non-vacuous: the owner predicate is the access control, on both queries.
    const ownerScopes = SERVER_CODE.match(/user_id = \$\{userId\}/g) ?? [];
    expect(ownerScopes.length).toBe(2);
    expect(SERVER_CODE).toContain("archived_at IS NULL");
    expect(SERVER_CODE).toContain("WHERE id = ${contactId} AND user_id = ${userId}");
  });
});

describe("the existing usage cap", () => {
  test("at the cap it is a 429 with a retry-after, the honest sentence, and no model call", async () => {
    const h = harness({ allowed: false, retryAfterSec: 3600 });
    const outcome = await runCrmDraft(h.deps, request());
    expect(outcome).toEqual({
      ok: false,
      status: 429,
      error: CRM_DRAFT_LIMIT_MESSAGE,
      retryAfterSec: 3600,
    });
    expect(outcome.ok).toBe(false);
    expect(h.calls.generate).toEqual([]);
    // The cap is checked server-side, for THIS user, after ownership.
    expect(h.calls.limit).toEqual([7]);
    expect(h.calls.loadContact).toEqual([[7, 41]]);
  });

  test("a missing retry-after still yields a usable one (the route always sends a hint)", async () => {
    const h = harness({ allowed: false, retryAfterSec: null });
    const outcome = await runCrmDraft(h.deps, request());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(429);
    expect(outcome.retryAfterSec).toBeGreaterThan(0);
  });

  test("the history read happens only for an entitled, owned, within-cap request", async () => {
    const h = harness();
    await runCrmDraft(h.deps, request(41));
    expect(h.calls.listActivities).toEqual([[7, 41]]);
  });

  test("the cap is the pre-existing rate-limit table — no new table, no migration (source pin)", () => {
    expect(SERVER_MODULE).toContain('CRM_DRAFT_LIMIT_SCOPE = "crm_draft"');
    expect(SERVER_MODULE).toContain("checkRateLimit");
    expect(SERVER_MODULE).toContain("limit: CRM_DRAFT_MAX_PER_DAY");
    expect(SERVER_MODULE).toContain("scope: CRM_DRAFT_LIMIT_SCOPE");
    expect(SERVER_MODULE).not.toContain("CREATE TABLE");
    // And the cap is the same order of magnitude as the AI-brief daily cap (20/24h).
    expect(CRM_DRAFT_MAX_PER_DAY).toBe(20);
  });
});

describe("failures never become fake drafts", () => {
  test("a model error is a 502 with honest copy and a log-only detail", async () => {
    const h = harness({ answer: () => Promise.reject(new Error("OpenAI API error (429): rate limited")) });
    const outcome = await runCrmDraft(h.deps, request());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(502);
    expect(outcome.error).toBe(CRM_DRAFT_FAILED_MESSAGE);
    expect(outcome.detail).toContain("OpenAI API error");
    // The detail is NOT part of the client-facing body — the route only logs it.
    expect(JSON.stringify({ error: outcome.error })).not.toContain("OpenAI");
  });

  test("an empty or whitespace-only answer is NOT a draft", async () => {
    for (const answer of ["", "   \n ", "```\n\n```"]) {
      const h = harness({ answer });
      const outcome = await runCrmDraft(h.deps, request());
      expect({ answer, status: outcome.ok ? "ok" : outcome.status }).toEqual({ answer, status: 502 });
    }
  });

  test("model packaging is stripped before the editor sees it", async () => {
    const h = harness({ answer: "```\nHi Dana,\n\nFollowing up.\n```" });
    const outcome = await runCrmDraft(h.deps, request());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.draft.text).toBe("Hi Dana,\n\nFollowing up.");
  });

  test("a store read failure propagates — the route answers 500, never a blank draft", async () => {
    const h = harness();
    h.deps.store.listActivities = async () => {
      throw new Error("crm_activities unavailable");
    };
    await expect(runCrmDraft(h.deps, request())).rejects.toThrow("crm_activities unavailable");
  });
});

describe("drafts only — never sent, never written (pins on the shipped source)", () => {
  test("the production half contains no write statement for this feature", () => {
    for (const write of ["INSERT INTO", "UPDATE ", "DELETE FROM", "resend", "sendEmail", "sendMail"]) {
      expect({ write, present: SERVER_CODE.includes(write) }).toEqual({ write, present: false });
    }
  });

  test("the store interface is read-only — exactly two read methods, no write method", () => {
    const start = RUN_CODE.indexOf("export interface CrmDraftStore");
    const end = RUN_CODE.indexOf("export interface CrmDraftLimitChecker");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const iface = RUN_CODE.slice(start, end);
    const methods = [...iface.matchAll(/^ {2}(\w+)\(/gm)].map((m) => m[1]);
    // Adding saveContact/addActivity/send to the store fails here.
    expect(methods).toEqual(["loadContact", "listActivities"]);
  });

  test("the algorithm never imports a mail transport or a database driver", () => {
    for (const forbidden of ["~/db", "~/lib/email", "resend", "@tanstack"]) {
      expect({ forbidden, present: RUN_CODE.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  test("the production adapters are the house mechanism, not new ones", () => {
    expect(SERVER_CODE).toContain('import { getCrmAccess } from "~/lib/crm-access.server"');
    expect(SERVER_CODE).toContain('import { callAI } from "~/lib/ai"');
    expect(SERVER_CODE).toContain('import { checkRateLimit } from "~/lib/rate-limit"');
    expect(SERVER_CODE).toContain("const access = await getCrmAccess(user)");
    expect(SERVER_CODE).toContain("return callAI(");
  });

  test("the route resolves generateDraft BEFORE the Starter canEdit gate", () => {
    const draftBranch = CRM_ROUTE.indexOf('action === "generateDraft"');
    const starterGate = CRM_ROUTE.indexOf("!access.canEdit");
    expect(draftBranch).toBeGreaterThan(-1);
    expect(starterGate).toBeGreaterThan(-1);
    // A Starter account attempting a draft must NOT be told "Starter plan required".
    expect(draftBranch).toBeLessThan(starterGate);
    expect(CRM_ROUTE).toContain("retry-after");
  });

  test("the panel offers the action per contact and never a send control", () => {
    expect(CONTACTS_PANEL).toContain("CRM_DRAFT_ACTION_LABEL");
    // The SEND path does not exist in the shipped UI: no send button, no "sent" claim.
    expect(PANEL_CODE).not.toContain("Send ");
    expect(PANEL_CODE).not.toContain("Sent");
    expect(PANEL_CODE).not.toContain("auto-send");
  });
});
