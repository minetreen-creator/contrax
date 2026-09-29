import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { dateOnly } from "~/lib/brief-source";
import { parsePaymentInput } from "~/lib/contract-payments";
import { getOperationsSubscription } from "~/lib/contractor-operations-billing.server";

function serialize(row: any) {
  return {
    ...row,
    id: Number(row.id),
    amount_cents: Number(row.amount_cents),
    invoice_due_date: dateOnly(row.invoice_due_date),
    follow_up_date: dateOnly(row.follow_up_date),
    archived: !!row.archived_at,
  };
}

async function get({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await getOperationsSubscription(user.id)).subscribed) return Response.json({ error: "Contrax Payments subscription required" }, { status: 403 });
  try {
    const rows = await sql()`
      SELECT id, customer_name, job_name, invoice_number, amount_cents,
             invoice_due_date, purchase_order_number, status, invoice_attached,
             po_confirmed, supporting_docs_ready, next_action, follow_up_date, notes,
             archived_at, created_at, updated_at
      FROM contract_payments WHERE user_id = ${user.id} AND archived_at IS NULL
      ORDER BY follow_up_date ASC NULLS LAST, updated_at DESC LIMIT 250
    `;
    return Response.json({ data: rows.map(serialize) });
  } catch (error) {
    console.error("[api/contract-payments] list failed", error);
    return Response.json({ error: "Could not load payments" }, { status: 500 });
  }
}

async function post({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await getOperationsSubscription(user.id)).subscribed) return Response.json({ error: "Contrax Payments subscription required" }, { status: 403 });
  const input = parsePaymentInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "Invalid payment details" }, { status: 400 });
  if (input.archived && input.id === null) return Response.json({ error: "Payment record not found" }, { status: 404 });
  const { id, customer_name, job_name, invoice_number, amount_cents, invoice_due_date,
    purchase_order_number, status, invoice_attached, po_confirmed, supporting_docs_ready,
    next_action, follow_up_date, notes, archived } = input;
  try {
    const rows = id === null
      ? await sql()`
          INSERT INTO contract_payments (user_id, customer_name, job_name, invoice_number,
            amount_cents, invoice_due_date, purchase_order_number, status, invoice_attached,
            po_confirmed, supporting_docs_ready, next_action, follow_up_date, notes)
          VALUES (${user.id}, ${customer_name.trim()}, ${job_name.trim()}, ${invoice_number.trim()},
            ${amount_cents}, ${invoice_due_date}, ${purchase_order_number.trim()}, ${status},
            ${invoice_attached}, ${po_confirmed}, ${supporting_docs_ready}, ${next_action.trim()},
            ${follow_up_date}, ${notes.trim()}) RETURNING *
        `
      : await sql()`
          UPDATE contract_payments SET customer_name = ${customer_name.trim()}, job_name = ${job_name.trim()},
            invoice_number = ${invoice_number.trim()}, amount_cents = ${amount_cents},
            invoice_due_date = ${invoice_due_date}, purchase_order_number = ${purchase_order_number.trim()},
            status = ${status}, invoice_attached = ${invoice_attached}, po_confirmed = ${po_confirmed},
            supporting_docs_ready = ${supporting_docs_ready}, next_action = ${next_action.trim()},
            follow_up_date = ${follow_up_date}, notes = ${notes.trim()},
            archived_at = ${archived ? new Date().toISOString() : null}, updated_at = NOW()
          WHERE id = ${id} AND user_id = ${user.id} AND archived_at IS NULL RETURNING *
        `;
    if (!rows.length) return Response.json({ error: "Payment record not found" }, { status: 404 });
    return Response.json({ data: serialize(rows[0]) });
  } catch (error) {
    console.error("[api/contract-payments] save failed", error);
    return Response.json({ error: "Could not save payment details" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/contract-payments")({
  server: { handlers: { GET: get, POST: post } },
});
