import { createFileRoute } from "@tanstack/react-router";
import { sanitizeLogString } from "~/lib/ai";
import { getUserFromRequest } from "~/lib/api-auth";
import { getCrmAccess, type CrmAccess } from "~/lib/crm-access.server";
import { neonCrmContactsStore, type CrmContactsStore } from "~/lib/crm-contacts.server";
import { generateCrmDraft } from "~/lib/crm-drafts.server";
import { isValidTimezone, type ReminderLists, type CrmReminderPrefsView } from "~/lib/crm-reminders";
import {
  loadCrmReminderPrefs,
  loadReminderLists,
  saveCrmReminderPrefs,
} from "~/lib/crm-reminders.server";
import type { CrmDraftOutcome } from "~/lib/crm-drafts-run";
import { resolveActiveWorkspaceId } from "~/lib/workspaces.server";

/**
 * GET/POST /api/crm — the CRM (contacts + activity history) backend, phase 1 of
 * the owner's 3-phase CRM build (owner handoff 2026-10-10), plus the phase-3a
 * reminder READ/WRITE surface and the phase-3b AI follow-up DRAFT action.
 *
 * GET  ?resource=contacts (default)
 *        → { access, contacts } for the authenticated user, newest-updated first.
 *          Reading is auth-only: a downgraded account KEEPS its own data
 *          (`canEdit`/`contactLimit` only gate writes and new contacts).
 * GET  ?resource=history&contactId=<id>
 *        → { activities } — 403 unless the tier includes relationshipHistory
 *          (Professional), 400 for a non-positive contactId.
 * GET  ?resource=reminders
 *        → { access, prefs, overdue, upcoming } — 403 unless the tier includes
 *          reminders (Professional). PHASE 3a, owner handoff item 4. `prefs` is the
 *          user's own opt-in + timezone (absent row = not opted in, UTC); the lists
 *          are the user's saved-bid follow-up dates classified against their LOCAL
 *          day. Both come from src/lib/crm-reminders.ts — the same pure functions
 *          the scheduled worker uses, so the panel and the email can never disagree
 *          about which day a follow-up falls on. The Pipeline panel derives its own
 *          lists from the follow-up dates it already holds (so an in-page edit shows
 *          immediately); this resource is the complete server-side read.
 * POST { action: "saveContact" | "archiveContact" | "addActivity" | "saveReminderPrefs", … }
 *        → see each branch below. Origin-checked (the request's own origin must
 *          match the Origin header), then auth, then `access.canEdit`
 *          (`saveReminderPrefs` requires the Professional `reminders` flag instead:
 *          preferring an email is not editing a contact).
 * POST { action: "generateDraft", contactId, instructions? }
 *        → PHASE 3b (owner handoff item 5). Returns { draft: { text, contactId,
 *          generatedAt } } — TEXT for the caller's editor; nothing is written and
 *          nothing is sent. Gated on the Professional `aiDrafts` flag (NOT
 *          `canEdit`), so its branch is resolved BEFORE the Starter gate below; the
 *          whole decision lives in src/lib/crm-drafts-run.ts and its production
 *          adapters (real `getCrmAccess()`, owner-scoped reads, the existing
 *          per-user daily `rate_limits` cap, the shared `callAI` helper). A failed
 *          entitlement read is a 500 here, never a draft (fail-closed).
 *
 * Entitlement comes from src/lib/crm-access.server.ts ONLY — no column read here
 * is an entitlement, and nothing in this route reads a pricing or Stripe path.
 *
 * THE SQL IS NOT HERE ANY MORE. The six statements this route used to inline
 * (contacts list, activity list, contact update, capped contact create, archive
 * add-activity) now live in src/lib/crm-contacts.server.ts, and the phase-3a
 * reminder helpers and the phase-3b draft generator are reached through the same
 * `crmRouteHandlers(deps)` seam — so a unit test can drive these handlers END TO
 * END (auth → entitlement ladder → branch → response) with an in-memory store, no
 * database and no `mock.module`. Every `deps` default is the real collaborator, so
 * production behaviour is unchanged. See src/lib/crm-route.test.ts.
 *
 * MIGRATION 060 CAVEAT: the `reminders` branches read/write `user_crm_prefs` and
 * `crm_reminder_deliveries`, which migration 060 adds. They are wrapped in their
 * OWN try/catch so a database without it answers "Reminders unavailable" on that
 * resource instead of taking the contacts/history reads down with them.
 */
const ACTIVITY_KINDS = ["note", "call", "meeting", "email"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A positive, safe integer — the id shape every CRM table uses. */
function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
/** A positive, safe integer parsed from an untrusted query string. */
function positiveIntParam(value: string | null): number | null {
  if (value === null || !/^[0-9]{1,15}$/.test(value)) return null;
  return positiveInt(Number(value));
}
/**
 * Trims and bounds one optional text field. Returns null when the value is not a
 * string, is over `max` characters after trimming, or is empty while `required`.
 * Absent (undefined/null) optional fields become '' so the column's DEFAULT-less
 * NOT NULL shape is always satisfied.
 */
function boundedText(value: unknown, max: number, required = false): string | null {
  if (value === undefined || value === null) return required ? null : "";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (required && trimmed.length === 0) return null;
  if (trimmed.length > max) return null;
  return trimmed;
}
/** The JSON body as a plain object, or null when it is anything else. */
async function plainBody(request: Request): Promise<Record<string, unknown> | null> {
  const parsed = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}
/** Column mapping for a contact row (one place, so both read paths agree). */
function contactRow(r: Record<string, unknown>) {
  return {
    id: Number(r.id),
    name: String(r.name ?? ""),
    organization: String(r.organization ?? ""),
    role: String(r.role ?? ""),
    email: String(r.email ?? ""),
    phone: String(r.phone ?? ""),
    notes: String(r.notes ?? ""),
    created_at: r.created_at ? String(r.created_at) : null,
    updated_at: r.updated_at ? String(r.updated_at) : null,
  };
}

/** The authenticated caller, as much of it as the CRM needs (AuthUser is assignable). */
export type CrmRouteUser = { id: number; is_admin?: boolean };

/** The phase-3a reminder reads/writes, behind their own seam (migration 060 tables). */
export interface CrmRouteReminderDeps {
  loadPrefs(userId: number): Promise<CrmReminderPrefsView>;
  loadLists(userId: number, timezone: string, now: Date): Promise<ReminderLists>;
  savePrefs(
    userId: number,
    input: { optIn: boolean; timezone: string },
  ): Promise<CrmReminderPrefsView>;
}

/**
 * INJECTABLE ON PURPOSE — the `deps` seam exists so a unit test can drive the REAL
 * GET/POST handler end to end (auth → entitlement ladder → branch → response) with
 * an in-memory store, no database and no `mock.module`: bun's mock registry is never
 * un-registered and leaks across test files in one run (the pathology documented in
 * src/routes/api/subcontracts/primes.ts). Same pattern as
 * `pipelineWorkspaceHandler({ store, authenticate })` in
 * src/routes/api/pipeline-workspace.ts. Every default below is the real thing, so
 * production behaviour is exactly what it was.
 */
export interface CrmRouteDeps {
  authenticate?: (request: Request) => Promise<CrmRouteUser | null>;
  /** Entitlement is src/lib/crm-access.server.ts ONLY — never re-implemented here. */
  getAccess?: (user: CrmRouteUser) => Promise<CrmAccess>;
  /** The phase-1/2 contact + activity SQL (src/lib/crm-contacts.server.ts). */
  store?: CrmContactsStore;
  reminders?: CrmRouteReminderDeps;
  generateDraft?: (
    user: CrmRouteUser,
    body: { contactId?: unknown; instructions?: unknown },
  ) => Promise<CrmDraftOutcome>;
  /** Injectable clock (the reminder lists are classified against the user's local day). */
  now?: () => Date;
  /**
   * The caller's ACTIVE client workspace (Agency tier, migration 068), or null. It
   * scopes contact reads/writes to one client; null (every Starter/Professional
   * account, and every Agency account viewing its own context) is unscoped, exactly
   * as before this feature. Fail-soft by default: an unknown workspace reads
   * unscoped rather than breaking the CRM.
   */
  getActiveWorkspaceId?: (userId: number) => Promise<number | null>;
}

/** The same dependencies with production defaults filled in. */
interface CrmRouteDepsResolved {
  authenticate: (request: Request) => Promise<CrmRouteUser | null>;
  getAccess: (user: CrmRouteUser) => Promise<CrmAccess>;
  store: CrmContactsStore;
  reminders: CrmRouteReminderDeps;
  generateDraft: (
    user: CrmRouteUser,
    body: { contactId?: unknown; instructions?: unknown },
  ) => Promise<CrmDraftOutcome>;
  now: () => Date;
  getActiveWorkspaceId: (userId: number) => Promise<number | null>;
}

/**
 * Builds the endpoint's two handlers around `deps`. What it returns is what
 * TanStack Start's `server.handlers` calls; the exported `Route` uses the default
 * (production) set and a test passes its own.
 */
export function crmRouteHandlers(deps: CrmRouteDeps = {}) {
  const resolved: CrmRouteDepsResolved = {
    authenticate: deps.authenticate ?? getUserFromRequest,
    getAccess: deps.getAccess ?? getCrmAccess,
    store: deps.store ?? neonCrmContactsStore,
    reminders: {
      loadPrefs: loadCrmReminderPrefs,
      loadLists: loadReminderLists,
      savePrefs: saveCrmReminderPrefs,
      ...deps.reminders,
    },
    generateDraft: deps.generateDraft ?? generateCrmDraft,
    now: deps.now ?? (() => new Date()),
    getActiveWorkspaceId: deps.getActiveWorkspaceId ?? resolveActiveWorkspaceId,
  };
  return {
    GET: ({ request }: { request: Request }) => get(resolved, { request }),
    POST: ({ request }: { request: Request }) => post(resolved, { request }),
  };
}

async function get(deps: CrmRouteDepsResolved, { request }: { request: Request }) {
  const user = await deps.authenticate(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") ?? "contacts";
  try {
    const access = await deps.getAccess(user);
    if (resource === "contacts") {
      // Owner-scoped in the store (`user_id = userId`); NO tier check — a
      // downgraded account KEEPS its own data. The active client workspace scopes
      // which rows belong to THIS context (Agency tier); null = the account's own.
      const rows = await deps.store.listContacts(user.id, await deps.getActiveWorkspaceId(user.id));
      return Response.json(
        { access, contacts: rows.map(contactRow) },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (resource === "history") {
      if (!access.relationshipHistory) {
        return Response.json({ error: "Professional plan required" }, { status: 403 });
      }
      const contactId = positiveIntParam(url.searchParams.get("contactId"));
      if (contactId === null) {
        return Response.json({ error: "Invalid contactId" }, { status: 400 });
      }
      const rows = await deps.store.listActivities(user.id, contactId);
      return Response.json(
        {
          activities: rows.map((r) => ({
            id: Number(r.id),
            contact_id: Number(r.contact_id),
            kind: String(r.kind ?? ""),
            body: String(r.body ?? ""),
            created_at: r.created_at ? String(r.created_at) : null,
          })),
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (resource === "reminders") {
      // Professional only (owner tier table: reminders are a Professional feature).
      // A downgraded account is NOT emailed and does NOT see the panel — the gate is
      // here, server-side, not in the client.
      if (!access.reminders) {
        return Response.json({ error: "Professional plan required" }, { status: 403 });
      }
      // Its OWN try/catch: these two tables arrive with migration 060, and an
      // un-migrated database must not break the contacts/history reads above.
      try {
        const prefs = await deps.reminders.loadPrefs(user.id);
        const lists = await deps.reminders.loadLists(user.id, prefs.timezone, deps.now());
        return Response.json(
          { access, prefs, overdue: lists.overdue, upcoming: lists.upcoming },
          { headers: { "Cache-Control": "private, no-store" } },
        );
      } catch (error) {
        console.error("[api/crm] reminders read failed", error);
        return Response.json({ error: "Reminders unavailable" }, { status: 500 });
      }
    }
    return Response.json({ error: "Unknown resource" }, { status: 400 });
  } catch (error) {
    console.error("[api/crm] read failed", error);
    return Response.json({ error: "CRM unavailable" }, { status: 500 });
  }
}

async function post(deps: CrmRouteDepsResolved, { request }: { request: Request }) {
  // Same-origin only: a POST from another site would carry a different Origin.
  // (A non-browser caller that sends no Origin at all is rejected too — this
  // endpoint has no server-to-server consumer in phase 1.)
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const user = await deps.authenticate(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const access = await deps.getAccess(user);
    // The caller's ACTIVE client workspace (Agency tier, migration 068), or null for
    // the account's own context. Every contact write below is scoped to it, so an
    // Agency account can never edit one client's contact from another client's view.
    const workspaceId = await deps.getActiveWorkspaceId(user.id);
    const body = await plainBody(request);
    const action = body?.action;

    // PHASE 3b — AI follow-up drafts. This branch is gated on the Professional
    // `aiDrafts` flag, NOT on `canEdit` (Starter), so it is resolved BEFORE the
    // Starter gate below: that gate would otherwise answer a Starter account
    // attempting a draft with a 403 naming the wrong plan. Nothing about the
    // existing actions changes — an unparseable body still falls through to the
    // Starter gate exactly as before.
    if (action === "generateDraft") {
      try {
        const outcome = await deps.generateDraft(user, body ?? {});
        if (outcome.ok) {
          return Response.json(
            { draft: outcome.draft },
            { headers: { "Cache-Control": "private, no-store" } },
          );
        }
        // `detail` is diagnostics for the log only — never part of the response.
        if (outcome.detail) {
          console.error("[api/crm]", JSON.stringify({
            event: "draft_failed",
            user_id: user.id,
            status: outcome.status,
            error: sanitizeLogString(outcome.detail),
          }));
        }
        const init: ResponseInit = { status: outcome.status };
        if (outcome.retryAfterSec) {
          init.headers = { "retry-after": String(outcome.retryAfterSec) };
        }
        return Response.json({ error: outcome.error }, init);
      } catch (error) {
        // Fail-closed: an unreadable entitlement, contact or history means NO
        // draft — a 500, never a partial one.
        console.error("[api/crm] draft generation failed", sanitizeLogString(error));
        return Response.json({ error: "Could not generate a draft. Please try again." }, { status: 500 });
      }
    }

    if (!access.canEdit) {
      return Response.json({ error: "Starter plan required" }, { status: 403 });
    }
    if (!body) return Response.json({ error: "Invalid request" }, { status: 400 });

    if (action === "saveContact") {
      const name = boundedText(body.name, 200, true);
      const organization = boundedText(body.organization, 200);
      const role = boundedText(body.role, 200);
      const phone = boundedText(body.phone, 60);
      const email = boundedText(body.email, 254);
      const notes = boundedText(body.notes, 5000);
      if (
        name === null ||
        organization === null ||
        role === null ||
        phone === null ||
        email === null ||
        notes === null
      ) {
        return Response.json({ error: "Invalid contact" }, { status: 400 });
      }
      if (email && !EMAIL_RE.test(email)) {
        return Response.json({ error: "Invalid contact email" }, { status: 400 });
      }
      const rawId = body.id;
      if (rawId !== undefined && rawId !== null) {
        const id = positiveInt(rawId);
        if (id === null) return Response.json({ error: "Invalid contact id" }, { status: 400 });
        const updated = await deps.store.updateContact(
          user.id,
          id,
          {
            name,
            organization,
            role,
            email,
            phone,
            notes,
          },
          workspaceId,
        );
        if (updated === null) return Response.json({ error: "Contact not found" }, { status: 404 });
        return Response.json({ id: updated });
      }
      // Creation goes through the migration-059 function so the per-account cap is
      // enforced atomically (a NULL return means the cap was hit).
      const id = await deps.store.createContact(
        user.id,
        access.contactLimit,
        {
          name,
          organization,
          role,
          email,
          phone,
          notes,
        },
        workspaceId,
      );
      if (id === null) {
        return Response.json(
          {
            error: "contact_limit",
            message: `Your plan allows ${access.contactLimit} contacts.`,
          },
          { status: 409 },
        );
      }
      return Response.json({ id: Number(id) }, { status: 201 });
    }

    if (action === "archiveContact") {
      const id = positiveInt(body.id);
      if (id === null) return Response.json({ error: "Invalid contact id" }, { status: 400 });
      const archived = await deps.store.archiveContact(user.id, id, workspaceId);
      if (archived === null) return Response.json({ error: "Contact not found" }, { status: 404 });
      return Response.json({ success: true });
    }

    if (action === "addActivity") {
      if (!access.relationshipHistory) {
        return Response.json({ error: "Professional plan required" }, { status: 403 });
      }
      const contactId = positiveInt(body.contactId);
      const kind = body.kind;
      if (
        contactId === null ||
        typeof kind !== "string" ||
        !(ACTIVITY_KINDS as readonly string[]).includes(kind)
      ) {
        return Response.json({ error: "Invalid activity" }, { status: 400 });
      }
      const text = boundedText(body.body, 5000, true);
      if (text === null) return Response.json({ error: "Invalid activity" }, { status: 400 });
      // The INSERT…SELECT is the ownership check: a contact that is not the
      // caller's (or is archived) yields no row, hence 404.
      const activityId = await deps.store.addActivity(user.id, contactId, kind, text);
      if (activityId === null) return Response.json({ error: "Contact not found" }, { status: 404 });
      return Response.json({ id: activityId }, { status: 201 });
    }

    if (action === "saveReminderPrefs") {
      // The Professional gate, not `canEdit`: choosing to receive a reminder email
      // is not editing a contact. A non-Professional account is refused here, so a
      // forged request can never opt an unentitled account in (and the worker's own
      // recheck would refuse anyway).
      if (!access.reminders) {
        return Response.json({ error: "Professional plan required" }, { status: 403 });
      }
      // `opt_in` must be a real boolean. Nothing is coerced: a missing/false value
      // turns reminders OFF, which is the safe direction; only a literal `true` opts
      // in, and nothing here ever defaults a user INTO consent.
      if (typeof body.opt_in !== "boolean") {
        return Response.json({ error: "Invalid reminder preference" }, { status: 400 });
      }
      // An IANA zone the runtime can resolve, or nothing. Never guessed and never
      // silently mapped (see isValidTimezone).
      if (!isValidTimezone(body.timezone)) {
        return Response.json({ error: "Invalid timezone" }, { status: 400 });
      }
      try {
        const prefs = await deps.reminders.savePrefs(user.id, {
          // `=== true` after the guard above: the only accepted opt-in is a literal
          // boolean true, and anything else has already been refused with a 400.
          optIn: body.opt_in === true,
          timezone: String(body.timezone).trim(),
        });
        return Response.json({ prefs });
      } catch (error) {
        console.error("[api/crm] reminder prefs write failed", error);
        return Response.json({ error: "Could not save reminder settings" }, { status: 500 });
      }
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[api/crm] write failed", error);
    return Response.json({ error: "Could not save CRM data" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/crm")({
  // The production handler set: same two functions, wired to the real auth, the
  // real `getCrmAccess()`, the real Neon store, the real reminder helpers and the
  // real draft generator. Nothing about their behaviour changed — only how they
  // get their collaborators (see `CrmRouteDeps`).
  server: { handlers: crmRouteHandlers() },
});
