/**
 * Course completions + live bids for /learn/construction (owner 2026-10-07).
 * The table is created lazily (additive). Certificates are addressed by a random
 * token, never the serial id, so they can't be enumerated.
 */
import { randomBytes } from "node:crypto";
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import type { CompletionInput } from "~/lib/course-construction";

export async function ensureCourseTable(): Promise<void> {
  await sql()`CREATE TABLE IF NOT EXISTS course_completions (
    id SERIAL PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    course TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    state TEXT,
    visitor_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (course, email)
  )`;
}

/** Record a completion (one per email per course; a repeat keeps the first certificate). */
export async function recordCompletion(course: string, c: CompletionInput, visitorId: string | null): Promise<string> {
  await ensureCourseTable();
  const token = randomBytes(12).toString("hex");
  const rows = (await sql()`
    INSERT INTO course_completions (token, course, name, email, state, visitor_id)
    VALUES (${token}, ${course}, ${c.name}, ${c.email}, ${c.state || null}, ${visitorId})
    ON CONFLICT (course, email) DO UPDATE SET name = EXCLUDED.name
    RETURNING token`) as { token: string }[];
  return rows[0].token;
}

export async function getCompletion(token: string): Promise<{ name: string; course: string; created_at: string } | null> {
  if (!/^[a-f0-9]{24}$/.test(token)) return null;
  await ensureCourseTable();
  const rows = (await sql()`SELECT name, course, created_at FROM course_completions WHERE token = ${token}`) as Record<string, unknown>[];
  if (!rows.length) return null;
  const d = rows[0].created_at;
  return { name: String(rows[0].name), course: String(rows[0].course), created_at: d instanceof Date ? d.toISOString() : String(d) };
}

export async function countCompletions(course: string): Promise<number> {
  await ensureCourseTable();
  const r = (await sql()`SELECT COUNT(*)::int AS n FROM course_completions WHERE course = ${course}`) as { n: number }[];
  return r[0]?.n ?? 0;
}

export interface CourseBid {
  id: number;
  title: string;
  agency: string;
  due_date: string | null;
  set_aside: string | null;
}

const toBid = (r: Record<string, unknown>): CourseBid => ({
  id: Number(r.id),
  title: String(r.title ?? ""),
  agency: String(r.agency ?? ""),
  due_date: r.due_date ? new Date(r.due_date as string).toISOString() : null,
  set_aside: r.set_aside ? String(r.set_aside) : null,
});

/**
 * Real open construction bids for the lessons: the state's open count, a few
 * practice bids, set-aside ones, and open-enrollment agreements. Nothing is
 * shown that the bids table doesn't hold.
 */
export async function courseLiveBids(state: string): Promise<{
  state: string;
  total: number;
  practice: CourseBid[];
  setAside: CourseBid[];
  openEnrollment: CourseBid[];
}> {
  const s = sql();
  const construction = s`(category ILIKE '%construction%' OR naics_code ~ '^23')`;
  const open = s`due_date > NOW() + INTERVAL '2 days' AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}`;
  const [count, practice, setAside, openEnrollment] = await Promise.all([
    s`SELECT COUNT(*)::int AS n FROM bids WHERE normalized_state = ${state} AND ${construction} AND ${open}`,
    s`SELECT id, title, agency, due_date, set_aside FROM bids
      WHERE normalized_state = ${state} AND ${construction} AND ${open}
        AND due_date < NOW() + INTERVAL '90 days' AND title NOT ILIKE '%open enrollment%'
      ORDER BY due_date ASC LIMIT 3`,
    s`SELECT id, title, agency, due_date, set_aside FROM bids
      WHERE normalized_state = ${state} AND ${construction} AND ${open}
        AND set_aside IS NOT NULL AND set_aside <> '' AND set_aside !~* '^(none|n/?a|no set aside used)'
      ORDER BY due_date ASC LIMIT 3`,
    s`SELECT id, title, agency, due_date, set_aside FROM bids
      WHERE normalized_state = ${state} AND ${construction} AND ${open}
        AND (title ILIKE '%open enrollment%' OR title ~* '\\mOE\\M')
      ORDER BY due_date ASC LIMIT 3`,
  ]);
  return {
    state,
    total: Number((count as { n: number }[])[0]?.n ?? 0),
    practice: (practice as Record<string, unknown>[]).map(toBid),
    setAside: (setAside as Record<string, unknown>[]).map(toBid),
    openEnrollment: (openEnrollment as Record<string, unknown>[]).map(toBid),
  };
}
