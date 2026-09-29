import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { dateOnly } from "~/lib/brief-source";
import { validDate } from "~/lib/contract-payments";

type LaborInput = {
  id: number | null; worker_name: string; job_name: string; work_date: string;
  hours_hundredths: number; hourly_rate_cents: number; reviewed: boolean;
  notes: string; archived: boolean;
};

function parse(value: unknown): LaborInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.id !== null && (!Number.isSafeInteger(v.id) || (v.id as number) <= 0)) return null;
  if (typeof v.worker_name !== "string" || !v.worker_name.trim() || v.worker_name.length > 200) return null;
  if (typeof v.job_name !== "string" || !v.job_name.trim() || v.job_name.length > 200) return null;
  if (!validDate(v.work_date) || v.work_date === null) return null;
  if (!Number.isInteger(v.hours_hundredths) || (v.hours_hundredths as number) < 0 || (v.hours_hundredths as number) > 2400) return null;
  if (!Number.isSafeInteger(v.hourly_rate_cents) || (v.hourly_rate_cents as number) < 0 || (v.hourly_rate_cents as number) > 1_000_000_00) return null;
  if (typeof v.reviewed !== "boolean" || typeof v.archived !== "boolean") return null;
  if (typeof v.notes !== "string" || v.notes.length > 3000) return null;
  return v as LaborInput;
}

function serialize(row: any) {
  return { ...row, id: Number(row.id), work_date: dateOnly(row.work_date), archived: !!row.archived_at };
}

async function get({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const rows = await sql()`SELECT id, worker_name, job_name, work_date, hours_hundredths,
      hourly_rate_cents, reviewed, notes, archived_at FROM contract_labor_entries
      WHERE user_id = ${user.id} AND archived_at IS NULL ORDER BY work_date DESC LIMIT 250`;
    return Response.json({ data: rows.map(serialize) });
  } catch (error) {
    console.error("[api/contract-labor] list failed", error);
    return Response.json({ error: "Could not load labor entries" }, { status: 500 });
  }
}

async function post({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const input = parse(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "Invalid labor entry" }, { status: 400 });
  if (input.archived && input.id === null) return Response.json({ error: "Labor entry not found" }, { status: 404 });
  const { id, worker_name, job_name, work_date, hours_hundredths, hourly_rate_cents, reviewed, notes, archived } = input;
  try {
    const rows = id === null
      ? await sql()`INSERT INTO contract_labor_entries (user_id, worker_name, job_name, work_date,
          hours_hundredths, hourly_rate_cents, reviewed, notes)
          VALUES (${user.id}, ${worker_name.trim()}, ${job_name.trim()}, ${work_date},
            ${hours_hundredths}, ${hourly_rate_cents}, ${reviewed}, ${notes.trim()}) RETURNING *`
      : await sql()`UPDATE contract_labor_entries SET worker_name = ${worker_name.trim()},
          job_name = ${job_name.trim()}, work_date = ${work_date}, hours_hundredths = ${hours_hundredths},
          hourly_rate_cents = ${hourly_rate_cents}, reviewed = ${reviewed}, notes = ${notes.trim()},
          archived_at = ${archived ? new Date().toISOString() : null}, updated_at = NOW()
          WHERE id = ${id} AND user_id = ${user.id} AND archived_at IS NULL RETURNING *`;
    if (!rows.length) return Response.json({ error: "Labor entry not found" }, { status: 404 });
    return Response.json({ data: serialize(rows[0]) });
  } catch (error) {
    console.error("[api/contract-labor] save failed", error);
    return Response.json({ error: "Could not save labor entry" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/contract-labor")({ server: { handlers: { GET: get, POST: post } } });
