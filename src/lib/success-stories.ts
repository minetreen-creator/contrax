/**
 * Share Your Success (owner 2026-11-04: "maybe we should have a Share Your
 * Success page where people share their success stories with Contrax?" → "yes").
 *
 * Customers submit a story at /share-your-story. Nothing is public until the
 * owner approves it on /admin/stories, and the public page /success-stories
 * stays hidden (404) until STORIES_TO_PUBLISH approved stories exist. Each
 * person chooses how they are named; "private" stories are never shown.
 * Stories are only ever what a real customer wrote: no samples, no placeholders.
 *
 * PURE: validation and display rules only.
 */

export const STORY_OUTCOMES = [
  { key: "found", label: "Found bids I would have missed" },
  { key: "bid", label: "Bid on a job I found on Contrax" },
  { key: "won", label: "Won a contract I found on Contrax" },
] as const;
export type StoryOutcome = (typeof STORY_OUTCOMES)[number]["key"];

export const SHARE_LEVELS = [
  { key: "full", label: "My name and business" },
  { key: "first_name", label: "My first name only" },
  { key: "anonymous", label: "No name (just my trade and state)" },
  { key: "private", label: "Don't publish it, just tell Contrax" },
] as const;
export type ShareLevel = (typeof SHARE_LEVELS)[number]["key"];

/** The public page stays hidden until this many approved, shareable stories exist. */
export const STORIES_TO_PUBLISH = 3;

export interface StoryInput {
  name: string;
  business: string | null;
  email: string;
  trade: string;
  state: string | null;
  outcome: StoryOutcome;
  story: string;
  share: ShareLevel;
}

export interface PublishedStory {
  id: number;
  name: string;
  business: string | null;
  trade: string;
  state: string | null;
  outcome: StoryOutcome;
  story: string;
  share: ShareLevel;
  approved_at: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** Form body → a story, or the first problem in plain words. PURE. */
export function validateStory(body: Record<string, unknown>): { ok: true; value: StoryInput } | { ok: false; error: string } {
  const name = clip(body.name, 120);
  const email = clip(body.email, 200).toLowerCase();
  const trade = clip(body.trade, 80);
  const story = typeof body.story === "string" ? body.story.trim().slice(0, 2000) : "";
  const outcome = STORY_OUTCOMES.find((o) => o.key === body.outcome)?.key;
  const share = SHARE_LEVELS.find((s) => s.key === body.share)?.key;
  const state = clip(body.state, 2).toUpperCase();
  if (!name) return { ok: false, error: "Please enter your name." };
  if (!EMAIL.test(email)) return { ok: false, error: "Please enter a valid email address." };
  if (!trade) return { ok: false, error: "Please enter your trade." };
  if (!outcome) return { ok: false, error: "Please choose what happened." };
  if (story.length < 20) return { ok: false, error: "Please tell us a little more (a sentence or two)." };
  if (!share) return { ok: false, error: "Please choose how we may share it." };
  if (share !== "private" && body.consent !== true) return { ok: false, error: "Please confirm Contrax may publish your story." };
  return {
    ok: true,
    value: {
      name,
      business: clip(body.business, 160) || null,
      email,
      trade,
      state: /^[A-Z]{2}$/.test(state) ? state : null,
      outcome,
      story,
      share,
    },
  };
}

/** How a published story is signed, per the person's own choice. PURE. */
export function storyByline(s: Pick<PublishedStory, "name" | "business" | "trade" | "state" | "share">): string {
  const where = [s.trade, s.state].filter(Boolean).join(" · ");
  if (s.share === "full") return [s.business ? `${s.name}, ${s.business}` : s.name, where].filter(Boolean).join(" · ");
  if (s.share === "first_name") return [s.name.split(" ")[0], where].filter(Boolean).join(" · ");
  return `A ${s.trade.toLowerCase()} business${s.state ? ` in ${s.state}` : ""}`;
}

export function outcomeLabel(o: StoryOutcome): string {
  return STORY_OUTCOMES.find((x) => x.key === o)?.label ?? "";
}

/** True once enough approved, shareable stories exist to show the page. PURE. */
export function storiesPageIsLive(publishedCount: number): boolean {
  return publishedCount >= STORIES_TO_PUBLISH;
}
