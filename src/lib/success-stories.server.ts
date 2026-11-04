/**
 * Storage for Share Your Success (src/lib/success-stories.ts has the rules).
 * A story is `pending` until the owner approves or rejects it on /admin/stories.
 */
import { sql } from "~/db";
import type { PublishedStory, StoryInput } from "./success-stories";

export async function ensureSuccessStoriesTable(): Promise<void> {
  await sql()`
    CREATE TABLE IF NOT EXISTS success_stories (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      name TEXT NOT NULL,
      business TEXT,
      email TEXT NOT NULL,
      trade TEXT NOT NULL,
      state TEXT,
      outcome TEXT NOT NULL,
      story TEXT NOT NULL,
      share TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      decided_at TIMESTAMPTZ
    )
  `;
}

export async function insertStory(s: StoryInput): Promise<number> {
  await ensureSuccessStoriesTable();
  const rows = (await sql()`
    INSERT INTO success_stories (name, business, email, trade, state, outcome, story, share)
    VALUES (${s.name}, ${s.business}, ${s.email}, ${s.trade}, ${s.state}, ${s.outcome}, ${s.story}, ${s.share})
    RETURNING id
  `) as { id: number }[];
  return Number(rows[0]?.id ?? 0);
}

export interface AdminStoryRow extends StoryInput {
  id: number;
  created_at: string;
  status: "pending" | "approved" | "rejected";
  decided_at: string | null;
}

export async function listStoriesForAdmin(): Promise<AdminStoryRow[]> {
  await ensureSuccessStoriesTable();
  return (await sql()`
    SELECT id, created_at, name, business, email, trade, state, outcome, story, share, status, decided_at
    FROM success_stories ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 200
  `) as AdminStoryRow[];
}

export async function setStoryStatus(id: number, status: "pending" | "approved" | "rejected"): Promise<boolean> {
  await ensureSuccessStoriesTable();
  const rows = (await sql()`
    UPDATE success_stories SET status = ${status}, decided_at = ${status === "pending" ? null : new Date().toISOString()}
    WHERE id = ${id} RETURNING id
  `) as { id: number }[];
  return rows.length > 0;
}

/** Approved stories the person agreed to share, newest first. Emails are never selected. */
export async function listPublishedStories(): Promise<PublishedStory[]> {
  await ensureSuccessStoriesTable();
  return (await sql()`
    SELECT id, name, business, trade, state, outcome, story, share, decided_at AS approved_at
    FROM success_stories
    WHERE status = 'approved' AND share <> 'private'
    ORDER BY decided_at DESC LIMIT 100
  `) as PublishedStory[];
}
