import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { dateOnly } from "~/lib/brief-source";
import {
  CRM_CONTACT_ARCHIVED,
  CRM_CONTACT_NOT_FOUND,
  parseCrmContactId,
} from "~/lib/pipeline-contacts";
import {
  neonPipelineWorkspaceStore,
  type PipelineWorkspaceStore,
} from "~/lib/pipeline-workspace.server";

/**
 * POST /api/pipeline-workspace — save one saved bid's pipeline details
 * (pursuit status, next action, follow-up date, notes, the free-text contact
 * block) AND, since CRM phase 2, the CRM contact linked to it.
 *
 * BODY (unchanged except for the last line)
 *   { bid_id, pursuit_status, notes, next_action, follow_up_date,
 *     contact_name, contact_organization, contact_role, contact_email,
 *     crm_contact_id? }   ← NEW: a positive int, or null/absent to unlink
 *
 * EVERY pre-phase-2 validation and trim rule is unchanged, byte for byte: the
 * five pursuit statuses, the string/300-char (5000 for notes) field bounds, the
 * contact-email shape, the strict YYYY-MM-DD round-trip date check, and the
 * owner-scoped `user_id + bid_id + status = 'saved'` UPDATE.
 *
 * THE LINK (new): when `crm_contact_id` is a positive int the route resolves it
 * FIRST and returns a specific error rather than letting the UPDATE hit the
 * composite FK — 404 `CRM_CONTACT_NOT_FOUND` when the contact is not the caller's
 * (or does not exist), 400 `CRM_CONTACT_ARCHIVED` when it is theirs but archived.
 * `null`/absent unlinks (`crm_contact_id = NULL`) and requires no contact at all.
 * The FK is the backstop, never the error path.
 *
 * INJECTABLE ON PURPOSE — the `deps` seam exists so a unit test can prove those
 * rules (owned accepted / other-user's rejected / archived rejected / null =
 * unlink) and the untouched field validation without a database and WITHOUT
 * `mock.module`: bun's mock registry is never un-registered and leaks across test
 * files in one run (the pathology documented in src/routes/api/subcontracts/primes.ts).
 * The defaults are the real auth + the real Neon store, so production behaviour is
 * exactly what it was.
 */
const statuses = ["evaluating", "preparing", "submitted", "won", "lost"] as const;
const fields = ["notes", "next_action", "contact_name", "contact_organization", "contact_role", "contact_email"] as const;

/** What the handler needs from the outside — both default to the real thing. */
export interface PipelineWorkspaceDeps {
  store?: PipelineWorkspaceStore;
  authenticate?: (request: Request) => Promise<{ id: number } | null>;
}

export function pipelineWorkspaceHandler(deps: PipelineWorkspaceDeps = {}) {
  const store = deps.store ?? neonPipelineWorkspaceStore;
  const authenticate = deps.authenticate ?? getUserFromRequest;
  return async function handler({ request }: { request: Request }) {
    const user = await authenticate(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid request" }, { status: 400 });
    const bidId = body.bid_id;
    if (!Number.isSafeInteger(bidId) || bidId <= 0 || !statuses.includes(body.pursuit_status)) {
      return Response.json({ error: "Invalid bid or pursuit status" }, { status: 400 });
    }
    for (const key of fields) {
      if (typeof body[key] !== "string" || body[key].length > (key === "notes" ? 5000 : 300)) {
        return Response.json({ error: `Invalid ${key}` }, { status: 400 });
      }
    }
    if (body.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contact_email)) {
      return Response.json({ error: "Invalid contact email" }, { status: 400 });
    }
    const date = body.follow_up_date;
    if (date !== null && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) {
      return Response.json({ error: "Invalid follow-up date" }, { status: 400 });
    }
    // CRM phase 2 — the optional contact link. Shape first (a bad value never
    // reaches a query), then ownership, then archive state.
    const link = parseCrmContactId(body.crm_contact_id);
    if (!link.ok) return Response.json({ error: link.error }, { status: 400 });
    try {
      if (link.value !== null) {
        const contact = await store.findOwnedContact(user.id, link.value);
        if (!contact) return Response.json({ error: CRM_CONTACT_NOT_FOUND }, { status: 404 });
        if (contact.archived) return Response.json({ error: CRM_CONTACT_ARCHIVED }, { status: 400 });
      }
      const row = await store.updateSavedBid({
        userId: user.id,
        bidId,
        pursuitStatus: body.pursuit_status,
        notes: body.notes.trim(),
        nextAction: body.next_action.trim(),
        followUpDate: date,
        contactName: body.contact_name.trim(),
        contactOrganization: body.contact_organization.trim(),
        contactRole: body.contact_role.trim(),
        contactEmail: body.contact_email.trim(),
        crmContactId: link.value,
      });
      if (!row) return Response.json({ error: "Saved bid not found" }, { status: 404 });
      return Response.json({ data: { ...row, bid_id: Number(row.bid_id), follow_up_date: dateOnly(row.follow_up_date) } });
    } catch (error) {
      console.error("[api/pipeline-workspace] update failed", error);
      return Response.json({ error: "Could not save bid details" }, { status: 500 });
    }
  };
}

export const handler = pipelineWorkspaceHandler();

export const Route = createFileRoute("/api/pipeline-workspace")({
  server: { handlers: { POST: handler } },
});
