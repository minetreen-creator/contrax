import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { getCrmAccess } from "~/lib/crm-access.server";
import { sql } from "~/db";

/**
 * GET/POST /api/crm — the CRM (contacts + activity history) backend, phase 1 of
 * the owner's 3-phase CRM build (owner handoff 2026-10-10). No UI, no reminder
 * worker and no AI-draft endpoint live here yet (phases 2 and 3).
 *
 * GET  ?resource=contacts (default)
 *        → { access, contacts } for the authenticated user, newest-updated first.
 *          Reading is auth-only: a downgraded account KEEPS its own data
 *          (`canEdit`/`contactLimit` only gate writes and new contacts).
 * GET  ?resource=history&contactId=<id>
 *        → { activities } — 403 unless the tier includes relationshipHistory
 *          (Professional), 400 for a non-positive contactId.
 * POST { action: "saveContact" | "archiveContact" | "addActivity", … }
 *        → see each branch below. Origin-checked (the request's own origin must
 *          match the Origin header), then auth, then `access.canEdit`.
 *
 * Entitlement comes from src/lib/crm-access.server.ts ONLY — no column read here
 * is an entitlement, and nothing in this route reads a pricing or Stripe path.
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

async function get({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") ?? "contacts";
  try {
    const access = await getCrmAccess(user);
    if (resource === "contacts") {
      const rows = (await sql()`
        SELECT id, name, organization, role, email, phone, notes, created_at, updated_at
        FROM crm_contacts
        WHERE user_id = ${user.id} AND archived_at IS NULL
        ORDER BY updated_at DESC, id DESC
        LIMIT 1000
      `) as Array<Record<string, unknown>>;
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
      const rows = (await sql()`
        SELECT id, contact_id, kind, body, created_at
        FROM crm_activities
        WHERE user_id = ${user.id} AND contact_id = ${contactId}
        ORDER BY created_at DESC, id DESC
        LIMIT 200
      `) as Array<Record<string, unknown>>;
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
    return Response.json({ error: "Unknown resource" }, { status: 400 });
  } catch (error) {
    console.error("[api/crm] read failed", error);
    return Response.json({ error: "CRM unavailable" }, { status: 500 });
  }
}

async function post({ request }: { request: Request }) {
  // Same-origin only: a POST from another site would carry a different Origin.
  // (A non-browser caller that sends no Origin at all is rejected too — this
  // endpoint has no server-to-server consumer in phase 1.)
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const access = await getCrmAccess(user);
    if (!access.canEdit) {
      return Response.json({ error: "Starter plan required" }, { status: 403 });
    }
    const body = await plainBody(request);
    if (!body) return Response.json({ error: "Invalid request" }, { status: 400 });
    const action = body.action;

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
        const rows = (await sql()`
          UPDATE crm_contacts SET
            name = ${name}, organization = ${organization}, role = ${role},
            email = ${email}, phone = ${phone}, notes = ${notes}, updated_at = NOW()
          WHERE id = ${id} AND user_id = ${user.id} AND archived_at IS NULL
          RETURNING id
        `) as Array<{ id: number }>;
        if (!rows.length) return Response.json({ error: "Contact not found" }, { status: 404 });
        return Response.json({ id: Number(rows[0]!.id) });
      }
      // Creation goes through the migration-059 function so the per-account cap is
      // enforced atomically (a NULL return means the cap was hit).
      const rows = (await sql()`
        SELECT crm_create_contact(
          ${user.id}, ${access.contactLimit}, ${name}, ${organization},
          ${role}, ${email}, ${phone}, ${notes}
        ) AS id
      `) as Array<{ id: number | null }>;
      const id = rows[0]?.id ?? null;
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
      const rows = (await sql()`
        UPDATE crm_contacts SET archived_at = NOW(), updated_at = NOW()
        WHERE id = ${id} AND user_id = ${user.id} AND archived_at IS NULL
        RETURNING id
      `) as Array<{ id: number }>;
      if (!rows.length) return Response.json({ error: "Contact not found" }, { status: 404 });
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
      const rows = (await sql()`
        INSERT INTO crm_activities (user_id, contact_id, kind, body)
        SELECT ${user.id}, id, ${kind}, ${text}
        FROM crm_contacts
        WHERE id = ${contactId} AND user_id = ${user.id} AND archived_at IS NULL
        RETURNING id
      `) as Array<{ id: number }>;
      if (!rows.length) return Response.json({ error: "Contact not found" }, { status: 404 });
      return Response.json({ id: Number(rows[0]!.id) }, { status: 201 });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[api/crm] write failed", error);
    return Response.json({ error: "Could not save CRM data" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/crm")({
  server: { handlers: { GET: get, POST: post } },
});
